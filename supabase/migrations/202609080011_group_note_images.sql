-- Rich text stays in the existing Markdown body contract. Images use private
-- object paths, never durable signed URLs, with server-bound uploader consent.
alter table public.group_notes
  add column image_path text,
  add column image_owner_id uuid references public.profiles(id) on delete set null;
alter table public.group_notes drop constraint group_notes_body_check;
alter table public.group_notes add constraint group_notes_body_check check (
  body = btrim(body) and char_length(body) between 0 and 12000
);
alter table public.group_notes add constraint group_notes_image_shape check (
  (image_path is null) = (image_owner_id is null)
);
create unique index group_notes_image_path_idx on public.group_notes(image_path) where image_path is not null;
create index group_notes_image_owner_idx on public.group_notes(image_owner_id) where image_owner_id is not null;
-- Cleanup checks exact references, never scans an account's entire log/chat.
create index metric_entries_note_media_ref_idx on public.metric_entries(image_path) where image_path is not null;
create index messages_note_media_ref_idx on public.messages(image_path) where image_path is not null;
create index profiles_note_media_ref_idx on public.profiles(avatar_path) where avatar_path is not null;
create index media_assets_note_thumbnail_ref_idx on public.media_assets(thumbnail_path) where thumbnail_path is not null;

-- Private lifecycle metadata, not anonymous data. Reserving a retired path
-- prevents a delayed cleanup retry from deleting a newly attached object.
-- Account deletion removes its metadata. Group deletion preserves reservations
-- with a null group so an already-dispatched cleanup cannot race path reuse.
create table public.group_note_media_links (
  path text primary key,
  note_id uuid,
  group_id uuid references public.groups(id) on delete set null,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  staged_until timestamptz not null default (now()+interval '15 minutes'),
  retired_at timestamptz,
  retired_by uuid references public.profiles(id) on delete set null,
  cleaned_at timestamptz
);
alter table public.group_note_media_links enable row level security;
revoke all on public.group_note_media_links from public, anon, authenticated;
-- Default-deny for every client role. Only security-definer lifecycle helpers
-- access this table; no authenticated/anonymous policy or table grant exists.
create policy group_note_media_service_only on public.group_note_media_links
  for all to service_role using (true) with check (true);
create index group_note_media_cleanup_idx on public.group_note_media_links(group_id, retired_at, path)
  where retired_at is not null and cleaned_at is null;
create index group_note_media_staging_idx on public.group_note_media_links(group_id,staged_until,path)
  where note_id is null and retired_at is null;
create index group_note_media_owner_pending_idx on public.group_note_media_links(uploader_id,retired_at,path) where cleaned_at is null;
create index group_note_media_owner_staging_idx on public.group_note_media_links(uploader_id,staged_until,path) where note_id is null and retired_at is null;

-- Share the deletion worker's account advisory lock, including the actor and
-- any image uploader, so a manifest/purge cannot miss a concurrent new note.
create or replace function public.assert_group_hub_accounts_writable(p_users uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  for v_user in select distinct item from unnest(p_users) item where item is not null order by item loop
    -- Save RPCs may already hold their note/event row lock. The reset lease is
    -- committed before its purge takes account -> row locks, so fail before
    -- waiting on that account lock to avoid a row -> account inversion.
    if exists(select 1 from public.google_health_account_deletion_guards where user_id=v_user) then
      raise exception 'habhub_account_deleting' using errcode='55000';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text,744218));
    if exists(select 1 from public.google_health_account_deletion_guards where user_id=v_user) then
      raise exception 'habhub_account_deleting' using errcode='55000';
    end if;
  end loop;
end;
$$;
revoke all on function public.assert_group_hub_accounts_writable(uuid[]) from public,anon,authenticated;

create or replace function public.fence_group_hub_account_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_users uuid[];
begin
  v_users:=array[auth.uid(),new.creator_id];
  if tg_op='UPDATE' then v_users:=v_users || array[old.creator_id]; end if;
  if tg_table_name='group_notes' then
    if tg_op='UPDATE' and old.image_path is not null and new.image_owner_id is null
       and (pg_catalog.to_jsonb(new)-array['image_path','image_owner_id'])=(pg_catalog.to_jsonb(old)-array['image_path','image_owner_id'])
       and ((auth.role()='service_role' and new.image_path is null)
         or (new.image_path is not distinct from old.image_path and not exists(select 1 from public.profiles where id=old.image_owner_id))) then
      return new; -- Only the service reset or actual uploader-profile FK cleanup.
    end if;
    v_users:=v_users || array[new.image_owner_id];
    if tg_op='UPDATE' then v_users:=v_users || array[old.image_owner_id]; end if;
  end if;
  perform public.assert_group_hub_accounts_writable(v_users);
  return new;
end;
$$;
revoke all on function public.fence_group_hub_account_deletion() from public,anon,authenticated;
create trigger a00_notes_account_write before insert or update on public.group_notes
for each row execute function public.fence_group_hub_account_deletion();
create trigger a00_schedule_account_write before insert or update on public.group_schedule_items
for each row execute function public.fence_group_hub_account_deletion();

create or replace function public.lock_group_note_media_paths(p_paths text[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_path text;
begin
  -- Lock even a not-yet-registered upload. Sorting the distinct paths avoids
  -- inversion when an asset swaps its main and thumbnail references.
  for v_path in select distinct item from unnest(p_paths) item
    where item ~ '^[0-9a-f-]{36}/account/group-note/' order by item loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('group-note-media:' || v_path,0));
  end loop;
end;
$$;
revoke all on function public.lock_group_note_media_paths(text[]) from public,anon,authenticated;

create or replace function public.stage_group_note_image(p_group_id uuid,p_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_link public.group_note_media_links;
begin
  if auth.uid() is null or not public.is_group_member(p_group_id)
     or not public.media_path_belongs_to(p_path,auth.uid())
     or not starts_with(p_path,auth.uid()::text || '/account/group-note/')
     or char_length(p_path)>240 or p_path ~ '[[:space:]]' or lower(p_path) !~ '\.(jpg|jpeg|png|webp|heic)$' then
    raise exception 'Image upload is not authorized.' using errcode='42501';
  end if;
  perform public.assert_group_hub_accounts_writable(array[auth.uid()]);
  perform public.lock_group_note_media_paths(array[p_path]);
  insert into public.group_note_media_links(path,group_id,uploader_id)
  values(p_path,p_group_id,auth.uid()) on conflict(path) do nothing;
  select * into v_link from public.group_note_media_links where path=p_path for update;
  if v_link.group_id is distinct from p_group_id or v_link.uploader_id<>auth.uid()
     or v_link.note_id is not null or v_link.retired_at is not null then
    raise exception 'group_note_image_already_used' using errcode='22023';
  end if;
  update public.group_note_media_links set staged_until=clock_timestamp()+interval '15 minutes' where path=p_path;
end;
$$;
revoke all on function public.stage_group_note_image(uuid,text) from public,anon,authenticated;
grant execute on function public.stage_group_note_image(uuid,text) to authenticated;

create or replace function public.can_upload_staged_group_note_image(p_path text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.media_path_belongs_to(p_path,auth.uid()) then return false; end if;
  perform public.assert_group_hub_accounts_writable(array[auth.uid()]);
  perform public.lock_group_note_media_paths(array[p_path]);
  return exists(select 1 from public.group_note_media_links where path=p_path and uploader_id=auth.uid()
    and note_id is null and retired_at is null and staged_until>clock_timestamp() and public.is_group_member(group_id));
end;
$$;
revoke all on function public.can_upload_staged_group_note_image(text) from public,anon;
grant execute on function public.can_upload_staged_group_note_image(text) to authenticated;
-- Expired uploads are rejected even if their network response arrives after
-- cleanup. Published note images are immutable; replacement uses a fresh path.
create policy group_note_staged_storage_insert on storage.objects as restrictive for insert to authenticated
with check(bucket_id<>'paceboard-media' or name !~ '^[0-9a-f-]{36}/account/group-note/' or public.can_upload_staged_group_note_image(name));
create policy group_note_staged_storage_update on storage.objects as restrictive for update to authenticated
using(bucket_id<>'paceboard-media' or name !~ '^[0-9a-f-]{36}/account/group-note/' or public.can_upload_staged_group_note_image(name))
with check(bucket_id<>'paceboard-media' or name !~ '^[0-9a-f-]{36}/account/group-note/' or public.can_upload_staged_group_note_image(name));

create or replace function public.enforce_group_note_image_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_link public.group_note_media_links;
begin
  if tg_op='UPDATE' then perform public.lock_group_note_media_paths(array[old.image_path,new.image_path]);
  else perform public.lock_group_note_media_paths(array[new.image_path]); end if;
  if tg_op = 'UPDATE' and new.image_path is not distinct from old.image_path then
    if old.image_owner_id is not null and new.image_owner_id is null
       and not exists(select 1 from public.profiles where id = old.image_owner_id) then
      new.image_path := null; -- Actual uploader-profile FK cleanup, not a client spoof.
    else
      new.image_owner_id := old.image_owner_id;
    end if;
    return new;
  end if;
  if new.image_path is null then new.image_owner_id := null; return new; end if;
  if not public.is_group_member(new.group_id)
     or not (new.creator_id = v_actor or public.is_group_admin(new.group_id))
     or not public.media_path_belongs_to(new.image_path, v_actor)
     or not starts_with(new.image_path, v_actor::text || '/account/group-note/')
     or char_length(new.image_path) > 240 or new.image_path ~ '[[:space:]]'
     or lower(new.image_path) !~ '\.(jpg|jpeg|png|webp|heic)$'
     or not exists(select 1 from storage.objects object
       where object.bucket_id = 'paceboard-media' and object.name = new.image_path) then
    raise exception 'group_note_image_owner_required' using errcode = '42501';
  end if;
  insert into public.group_note_media_links(path,note_id,group_id,uploader_id)
  values(new.image_path,new.id,new.group_id,v_actor) on conflict(path) do nothing;
  select * into v_link from public.group_note_media_links where path = new.image_path for update;
  if (v_link.note_id is not null and v_link.note_id <> new.id) or v_link.group_id is distinct from new.group_id
     or v_link.uploader_id <> v_actor or v_link.retired_at is not null then
    raise exception 'group_note_image_already_used' using errcode = '22023';
  end if;
  if v_link.note_id is null then
    update public.group_note_media_links set note_id=new.id where path=new.image_path;
  end if;
  new.image_owner_id := v_actor;
  return new;
end;
$$;
revoke all on function public.enforce_group_note_image_owner() from public, anon, authenticated;
create trigger a0_group_notes_image_owner before insert or update on public.group_notes
for each row execute function public.enforce_group_note_image_owner();

create or replace function public.retire_group_note_image()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.image_path is not null and (tg_op = 'DELETE' or new.image_path is distinct from old.image_path) then
    perform public.lock_group_note_media_paths(array[old.image_path]);
    update public.group_note_media_links set retired_at = coalesce(retired_at,clock_timestamp()),
      retired_by = case when exists(select 1 from public.profiles where id=auth.uid()) then auth.uid() end
     where path = old.image_path and note_id = old.id;
  end if;
  return null;
end;
$$;
revoke all on function public.retire_group_note_image() from public, anon, authenticated;
create trigger group_notes_retire_image after update or delete on public.group_notes
for each row execute function public.retire_group_note_image();

-- No default/ambiguous overload: existing five-argument clients keep the image
-- when editing text. The new overload updates text + image in one CAS write,
-- hence one revision and one canonical notification/realtime event.
create or replace function public.save_group_note(
  p_note_id uuid, p_group_id uuid, p_title text, p_body text,
  p_expected_revision bigint, p_image_path text
)
returns public.group_notes language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_existing public.group_notes; v_saved public.group_notes;
  v_title text := nullif(btrim(p_title),''); v_body text := btrim(coalesce(p_body,''));
begin
  if v_actor is null or not public.is_group_member(p_group_id) then
    raise exception 'Active group membership required.' using errcode = '42501';
  end if;
  if not public.habhub_has_current_terms_acceptance() then
    raise exception 'Accept the current Terms before sharing a group note.' using errcode = '42501';
  end if;
  if char_length(v_body) > 12000 or (v_body = '' and p_image_path is null) then
    raise exception 'Add text or an image; notes allow up to 12000 characters.' using errcode = '22023';
  end if;
  if char_length(v_title) > 160 then
    raise exception 'A group note title can contain at most 160 characters.' using errcode = '22023';
  end if;
  if not public.habhub_message_content_allowed(concat_ws(' ',v_title,v_body)) then
    raise exception 'This note cannot be shared as written.' using errcode = '22023';
  end if;
  if p_note_id is null then
    if p_expected_revision is not null then
      raise exception 'A new group note cannot have an expected revision.' using errcode = '22023';
    end if;
    insert into public.group_notes(group_id,creator_id,title,body,image_path)
    values(p_group_id,v_actor,v_title,v_body,p_image_path) returning * into v_saved;
  else
    select * into v_existing from public.group_notes where id = p_note_id for update;
    if not found or v_existing.group_id <> p_group_id or not public.is_group_member(v_existing.group_id)
       or (v_existing.creator_id <> v_actor and not public.habhub_message_visible_to_current_user(v_existing.creator_id,null)) then
      raise exception 'Group note not found.' using errcode = 'P0002';
    end if;
    if v_existing.creator_id <> v_actor and not public.is_group_admin(v_existing.group_id) then
      raise exception 'Only the creator or a group administrator can edit this note.' using errcode = '42501';
    end if;
    if p_expected_revision is null or p_expected_revision <> v_existing.revision then
      raise exception 'This group note changed on another device. Refresh and try again.' using errcode = 'P0001';
    end if;
    update public.group_notes set title=v_title,body=v_body,image_path=p_image_path,
      revision=revision+1,updated_at=clock_timestamp() where id=p_note_id returning * into v_saved;
  end if;
  return v_saved;
end;
$$;
revoke all on function public.save_group_note(uuid,uuid,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.save_group_note(uuid,uuid,text,text,bigint,text) to authenticated;

create or replace function public.can_read_group_note_media_object(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(
    select 1 from public.group_notes note
     where note.image_path=object_path and public.media_path_belongs_to(object_path,note.image_owner_id)
       and public.is_group_member(note.group_id)
       and public.habhub_message_visible_to_current_user(note.creator_id,null)
       and public.habhub_message_visible_to_current_user(note.image_owner_id,null)
  )
$$;
revoke all on function public.can_read_group_note_media_object(text) from public,anon,authenticated;

do $read_guard$
declare v_definition text; v_anchor text := 'public.media_path_belongs_to(object_path, auth.uid())';
begin
  select pg_catalog.pg_get_functiondef('public.can_read_media_object(text)'::regprocedure) into v_definition;
  if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor) <> 1 then
    raise exception 'Unexpected media owner read guard';
  end if;
  execute replace(v_definition,v_anchor,'(' || v_anchor || ' or public.can_read_group_note_media_object(object_path))');
end;
$read_guard$;

-- A creator/admin who actually detached an image may clean it up even when its
-- uploader is another member. No caller-supplied path grants deletion authority.
-- Preserve any other supported reference: users can intentionally reuse media.
create or replace function public.can_delete_retired_group_note_media_object(object_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(
    select 1 from public.group_note_media_links link where link.path=object_path and link.retired_at is not null
      and ((public.is_group_member(link.group_id) and link.retired_by=auth.uid()) or link.uploader_id=auth.uid())
  )
  and not exists(select 1 from public.group_notes where image_path=object_path)
  and not exists(select 1 from public.metric_entries where image_path=object_path)
  and not exists(select 1 from public.messages where image_path=object_path)
  and not exists(select 1 from public.profiles where avatar_path=object_path)
  and not exists(select 1 from public.group_challenges where visual_image_path=object_path)
  and not exists(select 1 from public.media_assets where storage_path=object_path or thumbnail_path=object_path)
$$;
revoke all on function public.can_delete_retired_group_note_media_object(text) from public,anon;
grant execute on function public.can_delete_retired_group_note_media_object(text) to authenticated;
-- Do not add a Storage SELECT grant for cleanup: that would re-enable signed
-- URLs after removal. The authenticated cleanup Edge endpoint uses these
-- vetted paths for service-side deletion instead.

-- Serialize newly added cross-surface references against retirement. Existing
-- references may remain and continue to protect the file; delayed new ones
-- cannot attach a retired path after the cleanup worker checked it.
create or replace function public.fence_retired_group_note_attachment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_paths text[]; v_old_paths text[] := array[]::text[]; v_path text; v_retired timestamptz;
begin
  if tg_table_name='metric_entries' or tg_table_name='messages' then
    v_paths:=array[new.image_path]; if tg_op='UPDATE' then v_old_paths:=array[old.image_path]; end if;
  elsif tg_table_name='profiles' then
    v_paths:=array[new.avatar_path]; if tg_op='UPDATE' then v_old_paths:=array[old.avatar_path]; end if;
  elsif tg_table_name='group_challenges' then
    v_paths:=array[new.visual_image_path]; if tg_op='UPDATE' then v_old_paths:=array[old.visual_image_path]; end if;
  elsif tg_table_name='media_assets' then
    v_paths:=array[new.storage_path,new.thumbnail_path];
    if tg_op='UPDATE' then v_old_paths:=array[old.storage_path,old.thumbnail_path]; end if;
  else raise exception 'Unsupported note attachment fence'; end if;
  perform public.lock_group_note_media_paths(v_paths);
  foreach v_path in array v_paths loop
    if v_path is null or coalesce(v_path=any(v_old_paths),false) then continue; end if;
    select retired_at into v_retired from public.group_note_media_links where path=v_path for share;
    if found and v_retired is not null then
      raise exception 'group_note_image_retired' using errcode='22023';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.fence_retired_group_note_attachment() from public,anon,authenticated;
create trigger a1_entries_note_media_fence before insert or update of image_path on public.metric_entries
for each row execute function public.fence_retired_group_note_attachment();
create trigger a1_messages_note_media_fence before insert or update of image_path on public.messages
for each row execute function public.fence_retired_group_note_attachment();
create trigger a1_profiles_note_media_fence before insert or update of avatar_path on public.profiles
for each row execute function public.fence_retired_group_note_attachment();
create trigger a1_challenges_note_media_fence before insert or update of visual_image_path on public.group_challenges
for each row execute function public.fence_retired_group_note_attachment();
create trigger a1_assets_note_media_fence before insert or update of storage_path,thumbnail_path on public.media_assets
for each row execute function public.fence_retired_group_note_attachment();

create or replace function public.list_retired_group_note_media(p_group_id uuid)
returns table(path text) language plpgsql security definer set search_path = '' as $$
declare v_path text;
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then
    raise exception 'Active group membership required.' using errcode='42501';
  end if;
  -- A committed upload whose response/save was lost remains discoverable.
  -- Lease expiry is serialized with Storage insertion and bounded per call.
  for v_path in select candidate.path from (
    select link.path from public.group_note_media_links link
     where link.uploader_id=auth.uid()
       and link.note_id is null and link.retired_at is null and link.staged_until<=clock_timestamp()
     order by link.staged_until,link.path limit 100
  ) candidate order by candidate.path loop
    perform public.lock_group_note_media_paths(array[v_path]);
    update public.group_note_media_links set retired_at=clock_timestamp(),retired_by=auth.uid()
     where group_note_media_links.path=v_path and note_id is null and retired_at is null and staged_until<=clock_timestamp();
  end loop;
  -- Keep a reserved tombstone after successful object cleanup, but stop retries.
  update public.group_note_media_links link set cleaned_at=clock_timestamp()
   where link.path in (select candidate.path from public.group_note_media_links candidate
     where (candidate.group_id=p_group_id or candidate.uploader_id=auth.uid()) and candidate.retired_at is not null and candidate.cleaned_at is null
       and (candidate.retired_by=auth.uid() or candidate.uploader_id=auth.uid())
       and not exists(select 1 from storage.objects object where object.bucket_id='paceboard-media' and object.name=candidate.path)
     order by candidate.retired_at,candidate.path limit 100);
  return query select link.path from public.group_note_media_links link
   where (link.group_id=p_group_id or link.uploader_id=auth.uid()) and link.retired_at is not null and link.cleaned_at is null
     and (link.retired_by=auth.uid() or link.uploader_id=auth.uid())
     and public.can_delete_retired_group_note_media_object(link.path)
   order by link.retired_at,link.path limit 100;
end;
$$;
revoke all on function public.list_retired_group_note_media(uuid) from public,anon,authenticated;
grant execute on function public.list_retired_group_note_media(uuid) to authenticated;

-- A failed/ambiguous upload save can retire only an unclaimed path. The unique
-- registry insert serializes against publication: an already committed or
-- concurrently committing note is never unlinked by client error cleanup.
create or replace function public.retire_unpublished_group_note_image(p_group_id uuid,p_path text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_group_member(p_group_id)
     or not public.media_path_belongs_to(p_path,auth.uid())
     or not starts_with(p_path,auth.uid()::text || '/account/group-note/')
     or char_length(p_path)>240 then
    raise exception 'Image cleanup is not authorized.' using errcode='42501';
  end if;
  perform public.lock_group_note_media_paths(array[p_path]);
  insert into public.group_note_media_links(path,note_id,group_id,uploader_id,retired_at,retired_by)
  select p_path,gen_random_uuid(),p_group_id,auth.uid(),clock_timestamp(),auth.uid()
   where exists(select 1 from storage.objects where bucket_id='paceboard-media' and name=p_path)
  on conflict(path) do nothing;
  update public.group_note_media_links set retired_at=coalesce(retired_at,clock_timestamp()),retired_by=auth.uid()
   where path=p_path and uploader_id=auth.uid() and note_id is null;
end;
$$;
revoke all on function public.retire_unpublished_group_note_image(uuid,text) from public,anon,authenticated;
grant execute on function public.retire_unpublished_group_note_image(uuid,text) to authenticated;

-- Reset removes the caller's uploaded visuals from other creators' retained
-- notes before deleting its account media, while preserving the note/discussion.
do $reset_guard$
declare v_definition text; v_anchor text := '-- Keep media that still backs identity or retained group-visible content.';
begin
  select pg_catalog.pg_get_functiondef('public.reset_account_private_data(uuid,uuid,jsonb,text,integer,timestamp with time zone)'::regprocedure) into v_definition;
  if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor) <> 1 then
    raise exception 'Unexpected account reset media retention definition';
  end if;
  execute replace(v_definition,v_anchor,'update public.group_notes set image_path=null,image_owner_id=null where image_owner_id=p_user_id;' || E'\n\n  ' || v_anchor);
end;
$reset_guard$;

notify pgrst,'reload schema';
