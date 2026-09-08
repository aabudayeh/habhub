-- A photo projection must not grant access to somebody else's media asset.
-- Quarantine pre-existing inconsistent references before installing the strict
-- write guard. Files and legitimate owner-owned shares are never deleted.
update public.photo_updates photo set visibility = 'private'
 where photo.visibility::text <> 'private' and not exists (
   select 1 from public.media_assets asset
    where asset.id = photo.media_asset_id and asset.owner_user_id = photo.owner_user_id
 );

create or replace function public.enforce_photo_media_ownership()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_asset_owner uuid;
begin
  select asset.owner_user_id into v_asset_owner from public.media_assets asset
   where asset.id = new.media_asset_id for share;
  if v_asset_owner is null or v_asset_owner is distinct from new.owner_user_id then
    raise exception 'photo_media_ownership_required' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_photo_media_ownership() from public, anon, authenticated;
create trigger a0_photo_updates_media_ownership before insert or update on public.photo_updates
for each row execute function public.enforce_photo_media_ownership();

drop policy if exists media_authorized_read on public.media_assets;
create policy media_authorized_read on public.media_assets for select to authenticated
using (
  owner_user_id = (select auth.uid()) or exists (
    select 1 from public.photo_updates photo
     where photo.media_asset_id = media_assets.id
       and photo.owner_user_id = media_assets.owner_user_id
       and photo.visibility::text = 'group' and photo.group_id is not null
       and public.is_group_member(photo.group_id)
       and public.habhub_message_visible_to_current_user(photo.owner_user_id, null)
  )
);

-- Harden only the photo branch. Entry, chat, avatar and challenge attachment
-- authorization remains the existing independently checked implementation.
do $patch$
declare v_definition text; v_old text := 'where asset.storage_path = object_path';
begin
  select pg_catalog.pg_get_functiondef('public.can_read_media_object(text)'::regprocedure) into v_definition;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Unexpected media object photo authorization definition';
  end if;
  execute replace(v_definition, v_old, 'where asset.storage_path = object_path and asset.owner_user_id = photo.owner_user_id');
end;
$patch$;

-- Existing clients address photo engagement by a source ID inside a group.
-- Bind that alias to a server row and owner without changing clients' target
-- strings or transferring their comments to whichever matching row is newest.
-- Hashed alias/owner keys are restricted pseudonymous security metadata, not
-- anonymous data: a privileged operator can still link a known source/owner.
-- They survive row/account removal so another account cannot reclaim an old
-- discussion; the same owner may restore its own deleted source identity.
create table public.group_photo_social_identities (
  group_id uuid not null references public.groups(id) on delete cascade,
  source_key text not null check (char_length(source_key) = 64),
  owner_key text check (owner_key is null or char_length(owner_key) = 64),
  photo_id uuid,
  primary key (group_id, source_key),
  check ((owner_key is null) = (photo_id is null))
);
alter table public.group_photo_social_identities enable row level security;
revoke all on table public.group_photo_social_identities from public, anon, authenticated;
comment on table public.group_photo_social_identities is
  'Restricted pseudonymous photo-social alias ownership, not anonymous data. Null bindings reserve ambiguous legacy aliases fail-closed. Contains no image paths, captions, dates or health values.';

create or replace function public.photo_social_identity_key(p_value text)
returns text language sql immutable strict parallel safe set search_path = ''
as $$ select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_value, 'UTF8')), 'hex') $$;
revoke all on function public.photo_social_identity_key(text) from public, anon, authenticated;

insert into public.group_photo_social_identities(group_id, source_key, owner_key, photo_id)
select photo.group_id,
       public.photo_social_identity_key(coalesce(public.group_projection_source_id(photo.client_generated_id), photo.id::text)),
       case when count(*) = 1 then (array_agg(public.photo_social_identity_key(photo.owner_user_id::text)))[1] end,
       case when count(*) = 1 then (array_agg(photo.id))[1] end
  from public.photo_updates photo where photo.group_id is not null
 group by photo.group_id, public.photo_social_identity_key(coalesce(public.group_projection_source_id(photo.client_generated_id), photo.id::text));

create or replace function public.bind_photo_social_identity()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_source_key text; v_owner_key text; v_binding public.group_photo_social_identities%rowtype;
begin
  if new.group_id is null then return new; end if;
  v_source_key := public.photo_social_identity_key(coalesce(public.group_projection_source_id(new.client_generated_id), new.id::text));
  v_owner_key := public.photo_social_identity_key(new.owner_user_id::text);
  if tg_op = 'UPDATE' then
    if new.group_id is not distinct from old.group_id and v_source_key = public.photo_social_identity_key(coalesce(public.group_projection_source_id(old.client_generated_id), old.id::text)) then
      return new;
    end if;
  end if;
  insert into public.group_photo_social_identities(group_id, source_key, owner_key, photo_id)
  values(new.group_id, v_source_key, v_owner_key, new.id)
  on conflict (group_id, source_key) do nothing;
  select * into v_binding from public.group_photo_social_identities binding
   where binding.group_id = new.group_id and binding.source_key = v_source_key for update;
  if v_binding.owner_key = v_owner_key then
    if v_binding.photo_id = new.id then return new; end if;
    if not exists(select 1 from public.photo_updates existing where existing.id = v_binding.photo_id) then
      update public.group_photo_social_identities set photo_id = new.id
       where group_id = new.group_id and source_key = v_source_key;
      return new;
    end if;
  end if;
  raise exception 'photo_social_source_id_reserved' using errcode = '23505';
end;
$$;
revoke all on function public.bind_photo_social_identity() from public, anon, authenticated;
create trigger photo_updates_bind_social_identity after insert or update of group_id, client_generated_id on public.photo_updates
for each row execute function public.bind_photo_social_identity();

create or replace function public.resolve_group_social_photo_id(p_group_id uuid, p_target_id text)
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare v_destination uuid; v_result uuid;
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) or p_target_id is null
     or char_length(p_target_id) not between 1 and 400 then return null; end if;
  v_destination := public.group_projection_destination(p_target_id);
  if v_destination is not null and v_destination <> p_group_id then return null; end if;
  select photo.id into v_result
    from public.group_photo_social_identities binding
    join public.photo_updates photo on photo.id = binding.photo_id and photo.group_id = binding.group_id
    join public.media_assets asset on asset.id = photo.media_asset_id and asset.owner_user_id = photo.owner_user_id
    join public.group_members member on member.group_id = photo.group_id and member.user_id = photo.owner_user_id and member.status = 'active'
   where binding.group_id = p_group_id
     and binding.source_key = public.photo_social_identity_key(public.group_projection_source_id(p_target_id))
     and binding.owner_key = public.photo_social_identity_key(photo.owner_user_id::text)
     and binding.source_key = public.photo_social_identity_key(coalesce(public.group_projection_source_id(photo.client_generated_id), photo.id::text))
     and photo.visibility::text = 'group'
     and public.habhub_message_visible_to_current_user(photo.owner_user_id, null)
     and not exists (
       select 1 from public.metric_privacy_cache_fences fence
       join public.metric_definitions definition on definition.id = fence.metric_id and definition.group_id = fence.group_id
        where fence.group_id = p_group_id and fence.user_id = photo.owner_user_id and definition.slug = 'progress_photo'
          and (photo.account_revision is null or photo.account_revision <= fence.revision)
     );
  return v_result;
end;
$$;
revoke all on function public.resolve_group_social_photo_id(uuid,text) from public, anon, authenticated;

do $patch$
declare v_signature text; v_definition text; v_start integer; v_end integer; v_marker text := '  elsif p_target_type = ''photo_update'' then'; v_replacement text;
begin
  foreach v_signature in array array['public.valid_group_social_target(uuid,text,text)','public.resolve_group_social_notification_target(uuid,text,text)'] loop
    select pg_catalog.pg_get_functiondef(v_signature::regprocedure) into v_definition;
    if (length(v_definition) - length(replace(v_definition, v_marker, ''))) / length(v_marker) <> 1 then
      raise exception 'Unexpected photo social branch: %', v_signature;
    end if;
    v_start := strpos(v_definition, v_marker);
    v_end := v_start + length(v_marker) + strpos(substring(v_definition from v_start + length(v_marker)), '  elsif p_target_type =') - 1;
    if v_end <= v_start + length(v_marker) then raise exception 'Photo branch end missing'; end if;
    if v_signature like '%valid_group_social_target%' then
      v_replacement := E'  elsif p_target_type = ''photo_update'' then\n    return public.resolve_group_social_photo_id(p_group_id, p_target_id) is not null;\n';
    else
      v_replacement := E'  elsif p_target_type = ''photo_update'' then\n    return query select photo.owner_user_id, ''photos''::text, ''photo''::text, photo.local_date\n      from public.photo_updates photo where photo.id = public.resolve_group_social_photo_id(p_group_id, p_target_id);\n';
    end if;
    execute substring(v_definition from 1 for v_start - 1) || v_replacement || substring(v_definition from v_end);
  end loop;
end;
$patch$;

notify pgrst, 'reload schema';
