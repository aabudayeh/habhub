-- A relational reference is not authority over another account's private
-- object. No files/rows are deleted here: legacy invalid references become
-- unreadable until their owner replaces or clears the attachment.
create or replace function public.media_path_belongs_to(p_path text, p_owner uuid)
returns boolean language sql immutable parallel safe set search_path = ''
as $$
  select coalesce(
    p_owner is not null and p_path is not null
    and length(p_path) > 37
    and left(p_path, 37) = p_owner::text || '/'
    and p_path !~ '(^|/)\.{1,2}(/|$)'
    and position(chr(92) in p_path) = 0,
    false
  )
$$;
revoke all on function public.media_path_belongs_to(text, uuid) from public, anon;
grant execute on function public.media_path_belongs_to(text, uuid) to authenticated, service_role;

create or replace function public.enforce_attachment_namespace_ownership()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_owner uuid; v_path text;
begin
  if tg_table_name = 'metric_entries' then
    v_owner := new.user_id; v_path := new.image_path;
  elsif tg_table_name = 'messages' then
    v_owner := new.sender_id; v_path := new.image_path;
  elsif tg_table_name = 'profiles' then
    v_owner := new.id; v_path := new.avatar_path;
  elsif tg_table_name = 'media_assets' then
    v_owner := new.owner_user_id; v_path := new.storage_path;
    if not public.media_path_belongs_to(v_path, v_owner)
       or (new.thumbnail_path is not null and not public.media_path_belongs_to(new.thumbnail_path, v_owner)) then
      raise exception 'attachment_namespace_ownership_required' using errcode = '42501';
    end if;
  else
    raise exception 'Unsupported attachment ownership target' using errcode = '42501';
  end if;
  if v_path is not null and not public.media_path_belongs_to(v_path, v_owner) then
    raise exception 'attachment_namespace_ownership_required' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_attachment_namespace_ownership() from public, anon, authenticated;
create trigger a0_metric_entries_attachment_owner before insert or update on public.metric_entries
for each row execute function public.enforce_attachment_namespace_ownership();
create trigger a0_messages_attachment_owner before insert or update on public.messages
for each row execute function public.enforce_attachment_namespace_ownership();
create trigger a0_profiles_attachment_owner before insert or update on public.profiles
for each row execute function public.enforce_attachment_namespace_ownership();
create trigger a0_media_assets_attachment_owner before insert or update on public.media_assets
for each row execute function public.enforce_attachment_namespace_ownership();

-- Group administrators may upload their OWN challenge visual even when the
-- creator is someone else. Record that intentional uploader server-side.
alter table public.group_challenges add column visual_image_owner_id uuid
  references public.profiles(id) on delete set null;
comment on column public.group_challenges.visual_image_owner_id is
  'Server-bound visual uploader. Legacy non-creator visuals without proven provenance stay unavailable until an authorized editor uploads a replacement. Files remain intact.';

-- Backfill only creator-owned paths. A foreign prefix alone is not proof of
-- historical uploader consent. Preserve timestamps/notification state and the
-- exact pre-migration enabled/disabled state of each user trigger.
do $backfill$
declare v_trigger record; v_states jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('name', tgname, 'mode', tgenabled)), '[]'::jsonb)
    into v_states from pg_catalog.pg_trigger
   where tgrelid = 'public.group_challenges'::regclass and not tgisinternal;
  for v_trigger in select * from jsonb_to_recordset(v_states) as item(name text, mode text) loop
    execute format('alter table public.group_challenges disable trigger %I', v_trigger.name);
  end loop;
  update public.group_challenges challenge
     set visual_image_owner_id = challenge.creator_id
   where public.media_path_belongs_to(challenge.visual_image_path, challenge.creator_id)
     and starts_with(challenge.visual_image_path, challenge.creator_id::text || '/account/challenge/');
  for v_trigger in select * from jsonb_to_recordset(v_states) as item(name text, mode text) loop
    execute format('alter table public.group_challenges %s trigger %I',
      case v_trigger.mode when 'D' then 'disable' when 'R' then 'enable replica'
        when 'A' then 'enable always' else 'enable' end, v_trigger.name);
  end loop;
end;
$backfill$;

create or replace function public.enforce_challenge_visual_uploader()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_caller uuid := auth.uid();
begin
  if tg_op = 'UPDATE' and new.visual_image_path is not distinct from old.visual_image_path then
    if old.visual_image_owner_id is not null and new.visual_image_owner_id is null
       and not exists (select 1 from public.profiles profile where profile.id = old.visual_image_owner_id) then
      -- The auth-user -> profile cascade has actually removed the uploader.
      -- Allow its FK cleanup, remove the identifying path, retain the challenge.
      -- A caller cannot imitate this while the uploader profile still exists.
      new.visual_image_path := null;
    else
      -- Ignore attempts to manufacture provenance without a new authorized image.
      new.visual_image_owner_id := old.visual_image_owner_id;
    end if;
  elsif new.visual_image_path is null then
    new.visual_image_owner_id := null;
  else
    if not public.media_path_belongs_to(new.visual_image_path, v_caller)
       or not starts_with(new.visual_image_path, v_caller::text || '/account/challenge/')
       or not (new.creator_id = v_caller or
         (new.audience <> 'public' and public.is_group_admin(new.group_id))) then
      raise exception 'challenge_visual_uploader_required' using errcode = '42501';
    end if;
    new.visual_image_owner_id := v_caller;
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_challenge_visual_uploader() from public, anon, authenticated;
create trigger a0_group_challenges_visual_owner before insert or update on public.group_challenges
for each row execute function public.enforce_challenge_visual_uploader();

-- Reset keeps the auth/profile row, so its FK cannot perform deletion cleanup.
-- Withdraw only this account's proven uploader bindings before collecting the
-- paths that the reset worker must retain. Other creators' challenges survive.
do $reset_guard$
declare v_definition text;
  v_anchor text := '-- Keep media that still backs identity or retained group-visible content.';
begin
  select pg_catalog.pg_get_functiondef(
    'public.reset_account_private_data(uuid,uuid,jsonb,text,integer,timestamp with time zone)'::regprocedure
  ) into v_definition;
  if (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'Unexpected account reset media retention definition';
  end if;
  execute replace(v_definition, v_anchor,
    'update public.group_challenges challenge set visual_image_path = null, visual_image_owner_id = null'
    || E'\n   where challenge.visual_image_owner_id = p_user_id;\n\n  ' || v_anchor);
end;
$reset_guard$;

-- Preserve the safety, audience, membership and recipient predicates verbatim.
-- Patch only the namespace predicates; fail migration if upstream shape drifts.
do $read_guards$
declare v_definition text; v_old text; v_new text; v_pair record;
begin
  select pg_catalog.pg_get_functiondef('public.can_read_media_object(text)'::regprocedure) into v_definition;
  for v_pair in select * from (values
    ('(storage.foldername(object_path))[1] = auth.uid()::text', 'public.media_path_belongs_to(object_path, auth.uid())'),
    ('where asset.storage_path = object_path and asset.owner_user_id = photo.owner_user_id',
     'where asset.storage_path = object_path and asset.owner_user_id = photo.owner_user_id and public.media_path_belongs_to(object_path, asset.owner_user_id)'),
    ('where entry.image_path = object_path', 'where entry.image_path = object_path and public.media_path_belongs_to(object_path, entry.user_id)'),
    ('where message.image_path = object_path', 'where message.image_path = object_path and public.media_path_belongs_to(object_path, message.sender_id)'),
    ('where profile.avatar_path = object_path', 'where profile.avatar_path = object_path and public.media_path_belongs_to(object_path, profile.id)')
  ) as edits(previous, replacement) loop
    v_old := v_pair.previous; v_new := v_pair.replacement;
    if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
      raise exception 'Unexpected attachment authorization definition';
    end if;
    v_definition := replace(v_definition, v_old, v_new);
  end loop;
  execute v_definition;
  select pg_catalog.pg_get_functiondef('public.can_read_challenge_media_object(text)'::regprocedure) into v_definition;
  v_old := 'where challenge.visual_image_path = object_path';
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Unexpected challenge attachment authorization definition';
  end if;
  execute replace(v_definition, v_old, v_old ||
    ' and public.media_path_belongs_to(object_path, challenge.visual_image_owner_id)' ||
    ' and public.habhub_message_visible_to_current_user(challenge.visual_image_owner_id, null)');
end;
$read_guards$;

drop policy if exists media_authorized_read on public.media_assets;
create policy media_authorized_read on public.media_assets for select to authenticated
using (
  owner_user_id = (select auth.uid()) or (
    public.media_path_belongs_to(storage_path, owner_user_id)
    and (thumbnail_path is null or public.media_path_belongs_to(thumbnail_path, owner_user_id))
    and exists (
      select 1 from public.photo_updates photo
       where photo.media_asset_id = media_assets.id
         and photo.owner_user_id = media_assets.owner_user_id
         and photo.visibility::text = 'group' and photo.group_id is not null
         and public.is_group_member(photo.group_id)
         and public.habhub_message_visible_to_current_user(photo.owner_user_id, null)
    )
  )
);
