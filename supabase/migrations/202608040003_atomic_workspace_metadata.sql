-- Finish the causal publish boundary introduced in 202608040002.
--
-- Account/profile projection and administrator-owned group configuration are
-- committed in one revision-checked transaction. Authenticated clients must
-- also stamp shared values with a current account revision; internal service
-- jobs remain able to perform maintenance with auth.uid() = null.

alter table public.profiles
  add column if not exists account_revision bigint;
alter table public.energy_profiles
  add column if not exists account_revision bigint;
alter table public.groups
  add column if not exists configuration_revision bigint not null default 0
    constraint groups_configuration_revision_nonnegative
    check (configuration_revision >= 0);
alter table public.metric_definitions
  add column if not exists archived_at timestamptz,
  add column if not exists group_configuration_revision bigint not null default 0
    constraint metric_definitions_configuration_revision_nonnegative
    check (group_configuration_revision >= 0);
alter table public.group_members
  add column if not exists role_configuration_revision bigint not null default 0
    constraint group_members_role_configuration_revision_nonnegative
    check (role_configuration_revision >= 0);

create index if not exists metric_definitions_active_group_idx
  on public.metric_definitions (group_id, slug)
  where archived_at is null;

create or replace function public.assert_account_snapshot_revision(
  p_user_id uuid,
  p_expected_revision bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_revision bigint;
begin
  if caller_id is null or caller_id <> p_user_id then
    raise exception 'account_revision_forbidden' using errcode = '42501';
  end if;

  select snapshot.revision
    into current_revision
    from public.user_snapshots snapshot
   where snapshot.user_id = p_user_id
   for update;

  if p_expected_revision is null
     or current_revision is null
     or current_revision <> p_expected_revision then
    raise exception 'stale_group_publish' using errcode = '40001';
  end if;
end;
$$;

create or replace function public.enforce_account_profile_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  owner_id uuid;
  content_changed boolean;
begin
  if caller_id is null then
    return new;
  end if;

  owner_id := case tg_table_name
    when 'profiles' then new.id
    else new.user_id
  end;
  if owner_id <> caller_id or new.account_revision is null then
    raise exception 'account_revision_required' using errcode = '40001';
  end if;

  if tg_op = 'UPDATE' then
    content_changed := case tg_table_name
      when 'profiles' then
        (new.display_name, new.avatar_path, new.timezone)
          is distinct from
        (old.display_name, old.avatar_path, old.timezone)
      else
        (
          new.age,
          new.biological_sex,
          new.height_cm,
          new.weight_kg,
          new.target_weight_kg,
          new.activity_level,
          new.desired_weekly_loss_kg
        ) is distinct from (
          old.age,
          old.biological_sex,
          old.height_cm,
          old.weight_kg,
          old.target_weight_kg,
          old.activity_level,
          old.desired_weekly_loss_kg
        )
    end;
    if content_changed
       and old.account_revision is not null
       and new.account_revision <= old.account_revision then
      raise exception 'stale_group_publish' using errcode = '40001';
    end if;
  end if;

  perform public.assert_account_snapshot_revision(
    owner_id,
    new.account_revision
  );
  return new;
end;
$$;

drop trigger if exists profiles_enforce_account_revision on public.profiles;
create trigger profiles_enforce_account_revision
before update on public.profiles
for each row execute function public.enforce_account_profile_revision();

drop trigger if exists energy_profiles_enforce_account_revision
  on public.energy_profiles;
create trigger energy_profiles_enforce_account_revision
before insert or update on public.energy_profiles
for each row execute function public.enforce_account_profile_revision();

create or replace function public.enforce_group_configuration_fence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_group_id uuid;
  marker text := current_setting('habhub.group_configuration_id', true);
begin
  if tg_table_name = 'groups' then
    target_group_id := new.id;
    if (
      new.name,
      new.template_name,
      new.settings,
      new.owner_id,
      new.configuration_revision
    ) is not distinct from (
      old.name,
      old.template_name,
      old.settings,
      old.owner_id,
      old.configuration_revision
    ) then
      return new;
    end if;
  elsif tg_table_name = 'metric_definitions' then
    if tg_op = 'DELETE' then
      target_group_id := old.group_id;
    elsif tg_op = 'UPDATE' then
      if new.group_id is distinct from old.group_id
         or new.owner_user_id is distinct from old.owner_user_id then
        raise exception 'metric_ownership_immutable' using errcode = '42501';
      end if;
      target_group_id := old.group_id;
    else
      target_group_id := new.group_id;
    end if;
    if target_group_id is null then
      if tg_op = 'DELETE' then
        return old;
      end if;
      return new;
    end if;
    -- Whole-group deletion may cascade through archived definitions.
    if tg_op = 'DELETE'
       and not exists (
         select 1 from public.groups target where target.id = target_group_id
       ) then
      return old;
    end if;
  else
    if new.group_id is distinct from old.group_id
       or new.user_id is distinct from old.user_id
       or new.joined_at is distinct from old.joined_at then
      raise exception 'group_membership_identity_immutable'
        using errcode = '42501';
    end if;
    if new.role is not distinct from old.role
       and new.role_configuration_revision
         is not distinct from old.role_configuration_revision then
      return new;
    end if;
    target_group_id := old.group_id;
  end if;

  if marker is null or marker <> target_group_id::text then
    raise exception 'group_configuration_revision_required'
      using errcode = '40001';
  end if;
  if tg_table_name = 'group_members'
     and new.role_configuration_revision is distinct from (
       select target.configuration_revision
         from public.groups target
        where target.id = target_group_id
     ) then
    raise exception 'stale_group_configuration' using errcode = '40001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists groups_enforce_configuration_fence on public.groups;
create trigger groups_enforce_configuration_fence
before update on public.groups
for each row execute function public.enforce_group_configuration_fence();

drop trigger if exists metric_definitions_enforce_configuration_fence
  on public.metric_definitions;
create trigger metric_definitions_enforce_configuration_fence
before insert or update or delete on public.metric_definitions
for each row execute function public.enforce_group_configuration_fence();

drop trigger if exists group_members_enforce_role_fence
  on public.group_members;
create trigger group_members_enforce_role_fence
before update on public.group_members
for each row execute function public.enforce_group_configuration_fence();

create or replace function public.enforce_group_projection_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  owner_id uuid;
begin
  -- SQL migrations and trusted service-role maintenance do not carry an end
  -- user JWT. All authenticated device writes must use the causal protocol.
  if caller_id is null then
    return new;
  end if;

  if new.account_revision is null then
    raise exception 'account_revision_required' using errcode = '40001';
  end if;

  if tg_op = 'UPDATE'
     and old.account_revision is not null
     and new.account_revision < old.account_revision then
    raise exception 'stale_group_publish' using errcode = '40001';
  end if;

  owner_id := case tg_table_name
    when 'photo_updates' then new.owner_user_id
    else new.user_id
  end;
  perform public.assert_account_snapshot_revision(
    owner_id,
    new.account_revision
  );
  return new;
end;
$$;

-- Direct deletes bypass an INSERT/UPDATE revision trigger. Current clients use
-- the revision-checked deletion RPCs below, so do not leave an unguarded RLS
-- delete path available to a stale installed build.
drop policy if exists entries_owner_all on public.metric_entries;
drop policy if exists entries_owner_select on public.metric_entries;
drop policy if exists entries_owner_insert on public.metric_entries;
drop policy if exists entries_owner_update on public.metric_entries;
create policy entries_owner_select on public.metric_entries
for select to authenticated
using (user_id = (select auth.uid()));
create policy entries_owner_insert on public.metric_entries
for insert to authenticated
with check (user_id = (select auth.uid()));
create policy entries_owner_update on public.metric_entries
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists photos_owner_all on public.photo_updates;
drop policy if exists photos_owner_select on public.photo_updates;
drop policy if exists photos_owner_insert on public.photo_updates;
drop policy if exists photos_owner_update on public.photo_updates;
create policy photos_owner_select on public.photo_updates
for select to authenticated
using (owner_user_id = (select auth.uid()));
create policy photos_owner_insert on public.photo_updates
for insert to authenticated
with check (owner_user_id = (select auth.uid()));
create policy photos_owner_update on public.photo_updates
for update to authenticated
using (owner_user_id = (select auth.uid()))
with check (owner_user_id = (select auth.uid()));

drop policy if exists energy_profiles_owner_all on public.energy_profiles;
drop policy if exists energy_profiles_owner_select on public.energy_profiles;
drop policy if exists energy_profiles_owner_insert on public.energy_profiles;
drop policy if exists energy_profiles_owner_update on public.energy_profiles;
create policy energy_profiles_owner_select on public.energy_profiles
for select to authenticated
using (user_id = (select auth.uid()));
create policy energy_profiles_owner_insert on public.energy_profiles
for insert to authenticated
with check (user_id = (select auth.uid()));
create policy energy_profiles_owner_update on public.energy_profiles
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Membership creation, role changes, removal, and leaving are mediated by
-- SECURITY DEFINER functions. Keep the table directly readable, but do not
-- expose broad mutation policies that could move or forge an owner row.
drop policy if exists members_admin_insert on public.group_members;
drop policy if exists members_admin_update on public.group_members;
drop policy if exists members_self_or_admin_delete on public.group_members;
drop policy if exists groups_owner_delete on public.groups;

drop policy if exists daily_status_owner_delete on public.daily_metric_status;
drop policy if exists metric_entry_tombstones_owner_insert
  on public.metric_entry_tombstones;
drop policy if exists metric_entry_tombstones_owner_update
  on public.metric_entry_tombstones;
drop policy if exists metric_entry_tombstones_owner_delete
  on public.metric_entry_tombstones;

-- Superseded overloads do not carry a private snapshot revision.
revoke all on function public.delete_group_metric_entries(text[])
  from public, authenticated;
revoke all on function public.commit_group_activity_version(uuid, date)
  from public, authenticated;

create or replace function public.clear_group_metric_entry_tombstones(
  p_client_generated_ids text[],
  p_expected_revision bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_account_snapshot_revision(
    (select auth.uid()),
    p_expected_revision
  );
  delete from public.metric_entry_tombstones tombstone
   where tombstone.user_id = (select auth.uid())
     and tombstone.client_generated_id = any(p_client_generated_ids);
end;
$$;

create or replace function public.commit_group_activity_version(
  p_group_id uuid,
  p_since_date date,
  p_expected_revision bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_account_snapshot_revision(
    (select auth.uid()),
    p_expected_revision
  );
  return public.commit_group_activity_version(p_group_id, p_since_date);
end;
$$;

create or replace function public.delete_group_metric_entries(
  p_client_generated_ids text[],
  p_expected_revision bigint
)
returns table (
  deleted_client_generated_id text,
  deleted_local_date date
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_account_snapshot_revision(
    (select auth.uid()),
    p_expected_revision
  );
  return query
    select *
      from public.delete_group_metric_entries(p_client_generated_ids);
end;
$$;

create or replace function public.delete_group_photo_updates(
  p_client_generated_ids text[],
  p_group_id uuid,
  p_expected_revision bigint
)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_ids text[];
begin
  perform public.assert_account_snapshot_revision(
    (select auth.uid()),
    p_expected_revision
  );

  with deleted as (
    delete from public.photo_updates photo
     where photo.owner_user_id = (select auth.uid())
       and photo.client_generated_id = any(p_client_generated_ids)
       and (p_group_id is null or photo.group_id = p_group_id)
    returning photo.client_generated_id
  )
  select coalesce(array_agg(client_generated_id), array[]::text[])
    into deleted_ids
    from deleted;

  return coalesce(deleted_ids, array[]::text[]);
end;
$$;

create or replace function public.get_group_activity_snapshot(
  p_group_id uuid,
  p_since_date date default (current_date - 120)
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'version',
      coalesce(
        (
          select version
          from public.group_activity_versions
          where group_id = p_group_id
        ),
        0
      ),
    'updated_at',
      (
        select updated_at
        from public.group_activity_versions
        where group_id = p_group_id
      ),
    'since_date', p_since_date,
    'entries_since_date', greatest(p_since_date, current_date - 120),
    'statuses_since_date', p_since_date,
    'metrics',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object('id', definition.id, 'slug', definition.slug)
            order by definition.slug
          )
          from public.metric_definitions definition
          where definition.group_id = p_group_id
            and definition.archived_at is null
        ),
        '[]'::jsonb
      ),
    'entries',
      coalesce(
        (
          select jsonb_agg(to_jsonb(entry) order by entry.recorded_at, entry.id)
          from public.metric_entries entry
          join public.metric_definitions definition
            on definition.id = entry.metric_id
          where definition.group_id = p_group_id
            and definition.archived_at is null
            and entry.local_date >= greatest(p_since_date, current_date - 120)
        ),
        '[]'::jsonb
      ),
    'statuses',
      coalesce(
        (
          select jsonb_agg(
            to_jsonb(status) || jsonb_build_object(
              'exact_value',
              case
                when status.user_id = (select auth.uid())
                  or status.visibility::text = 'group'
                then status.exact_value
                else null
              end
            )
            order by status.local_date, status.metric_id, status.user_id
          )
          from public.daily_metric_status status
          join public.metric_definitions definition
            on definition.id = status.metric_id
          where status.group_id = p_group_id
            and definition.group_id = p_group_id
            and definition.archived_at is null
            and (
              status.user_id = (select auth.uid())
              or coalesce(status.visibility::text, 'status') <> 'private'
            )
            and status.local_date >= p_since_date
        ),
        '[]'::jsonb
      ),
    'tombstones',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'user_id', tombstone.user_id,
              'client_generated_id', tombstone.client_generated_id,
              'local_date', tombstone.local_date,
              'deleted_at', tombstone.deleted_at
            )
            order by tombstone.deleted_at, tombstone.client_generated_id
          )
          from public.metric_entry_tombstones tombstone
          where tombstone.group_id = p_group_id
            and tombstone.local_date >= greatest(p_since_date, current_date - 120)
        ),
        '[]'::jsonb
      )
  )
  where public.is_group_member(p_group_id);
$$;

create or replace function public.create_group_with_metrics_v2(
  p_group_name text,
  p_metric_rows jsonb,
  p_group_theme_color text default '#0FBFB8',
  p_require_member_approval boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  created_group_id uuid;
  generated_code text;
  metric jsonb;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if char_length(trim(p_group_name)) not between 1 and 80 then
    raise exception 'Group name must be between 1 and 80 characters'
      using errcode = '22023';
  end if;

  loop
    generated_code := 'HAB-' || upper(
      substr(md5(random()::text || clock_timestamp()::text), 1, 6)
    );
    begin
      insert into public.groups (
        owner_id,
        name,
        invite_code,
        template_name,
        settings,
        configuration_revision
      )
      values (
        caller_id,
        trim(p_group_name),
        generated_code,
        'Healthy Competition',
        jsonb_build_object(
          'streakRestDaysPerWeek', 1,
          'themeColor', p_group_theme_color,
          'requireMemberApproval', p_require_member_approval
        ),
        0
      )
      returning id into created_group_id;
      exit;
    exception when unique_violation then
      continue;
    end;
  end loop;

  perform pg_catalog.set_config(
    'habhub.group_configuration_id',
    created_group_id::text,
    true
  );

  for metric in
    select value
      from jsonb_array_elements(coalesce(p_metric_rows, '[]'::jsonb))
  loop
    insert into public.metric_definitions (
      group_id,
      owner_user_id,
      slug,
      name,
      icon,
      color,
      unit,
      data_type,
      aggregation_method,
      ranking_direction,
      formula,
      score_weight,
      default_visibility,
      configuration,
      archived_at,
      group_configuration_revision
    )
    values (
      created_group_id,
      null,
      metric ->> 'slug',
      metric ->> 'name',
      metric ->> 'icon',
      metric ->> 'color',
      coalesce(metric ->> 'unit', ''),
      (metric ->> 'data_type')::public.metric_data_type,
      metric ->> 'aggregation_method',
      metric ->> 'ranking_direction',
      metric ->> 'formula',
      coalesce((metric ->> 'score_weight')::numeric, 0),
      (metric ->> 'default_visibility')::public.entry_visibility,
      coalesce(metric -> 'configuration', '{}'::jsonb),
      null,
      0
    );
  end loop;

  return created_group_id;
end;
$$;

revoke all on function public.create_group_with_metrics_v2(
  text, jsonb, text, boolean
) from public;
grant execute on function public.create_group_with_metrics_v2(
  text, jsonb, text, boolean
) to authenticated;

create or replace function public.leave_group_transactionally(
  p_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_owner_id uuid;
  current_revision bigint;
  successor_id uuid;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select target.owner_id, target.configuration_revision
    into current_owner_id, current_revision
    from public.groups target
   where target.id = p_group_id
   for update;
  if current_owner_id is null then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1
      from public.group_members membership
     where membership.group_id = p_group_id
       and membership.user_id = caller_id
  ) then
    raise exception 'Group membership required' using errcode = '42501';
  end if;

  if current_owner_id = caller_id then
    select membership.user_id
      into successor_id
      from public.group_members membership
     where membership.group_id = p_group_id
       and membership.user_id <> caller_id
       and membership.status = 'active'
     order by
       case when membership.role = 'admin' then 0 else 1 end,
       membership.joined_at
     limit 1;

    if successor_id is null then
      delete from public.groups where id = p_group_id;
      return jsonb_build_object('deleted', true);
    end if;

    perform pg_catalog.set_config(
      'habhub.group_configuration_id',
      p_group_id::text,
      true
    );
    update public.groups
       set owner_id = successor_id,
           configuration_revision = current_revision + 1
     where id = p_group_id;
    update public.group_members
       set role = 'owner',
           role_configuration_revision = current_revision + 1
     where group_id = p_group_id
       and user_id = successor_id;
  end if;

  delete from public.group_members
   where group_id = p_group_id
     and user_id = caller_id;
  return jsonb_build_object(
    'deleted', false,
    'successorId', successor_id
  );
end;
$$;

revoke all on function public.leave_group_transactionally(uuid) from public;
grant execute on function public.leave_group_transactionally(uuid)
  to authenticated;

create or replace function public.approve_group_member_transactionally(
  p_group_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_role public.member_role;
begin
  perform 1
    from public.groups target
   where target.id = p_group_id
   for update;
  if not found then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;

  select membership.role
    into caller_role
    from public.group_members membership
   where membership.group_id = p_group_id
     and membership.user_id = caller_id
     and membership.status = 'active'
   for update;
  if caller_id is null or caller_role not in ('owner', 'admin') then
    raise exception 'Group administrator access required'
      using errcode = '42501';
  end if;

  update public.group_members membership
     set status = 'active'
   where membership.group_id = p_group_id
     and membership.user_id = p_user_id
     and membership.status = 'pending'
     and membership.role = 'member';
  if not found then
    raise exception 'Pending membership not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.approve_group_member_transactionally(uuid, uuid)
  from public;
grant execute on function public.approve_group_member_transactionally(uuid, uuid)
  to authenticated;

create or replace function public.remove_group_member_transactionally(
  p_group_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_role public.member_role;
  current_owner_id uuid;
begin
  select target.owner_id
    into current_owner_id
    from public.groups target
   where target.id = p_group_id
   for update;
  if current_owner_id is null then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;

  select membership.role
    into caller_role
    from public.group_members membership
   where membership.group_id = p_group_id
     and membership.user_id = caller_id
     and membership.status = 'active'
   for update;
  if caller_id is null or caller_role not in ('owner', 'admin') then
    raise exception 'Group administrator access required'
      using errcode = '42501';
  end if;
  if p_user_id = caller_id then
    raise exception 'Use the leave-group action for your own membership'
      using errcode = '22023';
  end if;
  if p_user_id = current_owner_id then
    raise exception 'The group owner cannot be removed'
      using errcode = '42501';
  end if;

  delete from public.group_members membership
   where membership.group_id = p_group_id
     and membership.user_id = p_user_id;
  if not found then
    raise exception 'Group membership not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.remove_group_member_transactionally(uuid, uuid)
  from public;
grant execute on function public.remove_group_member_transactionally(uuid, uuid)
  to authenticated;

drop policy if exists group_member_aliases_owner_all
  on public.group_member_aliases;
drop policy if exists group_member_aliases_owner_select
  on public.group_member_aliases;
create policy group_member_aliases_owner_select
on public.group_member_aliases
for select to authenticated
using (
  owner_user_id = (select auth.uid())
  and public.is_group_member(group_id)
);

create or replace function public.publish_group_member_aliases(
  p_group_id uuid,
  p_expected_revision bigint,
  p_aliases jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  alias_row jsonb;
begin
  perform public.assert_account_snapshot_revision(
    (select auth.uid()),
    p_expected_revision
  );
  if not public.is_group_member(p_group_id) then
    raise exception 'Group membership required' using errcode = '42501';
  end if;

  delete from public.group_member_aliases alias
   where alias.owner_user_id = (select auth.uid())
     and alias.group_id = p_group_id;

  for alias_row in
    select value
      from jsonb_array_elements(coalesce(p_aliases, '[]'::jsonb))
  loop
    if char_length(trim(alias_row ->> 'nickname')) between 1 and 80
       and exists (
         select 1
           from public.group_members membership
          where membership.group_id = p_group_id
            and membership.user_id = (alias_row ->> 'subject_user_id')::uuid
            and membership.status = 'active'
       ) then
      insert into public.group_member_aliases (
        owner_user_id,
        group_id,
        subject_user_id,
        nickname
      )
      values (
        (select auth.uid()),
        p_group_id,
        (alias_row ->> 'subject_user_id')::uuid,
        trim(alias_row ->> 'nickname')
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.publish_group_member_aliases(
  uuid, bigint, jsonb
) from public;
grant execute on function public.publish_group_member_aliases(
  uuid, bigint, jsonb
) to authenticated;

-- One network call replaces separate profile, energy profile, group, metric,
-- and member-role writes. The user snapshot row stays locked until the whole
-- metadata projection commits, so another device cannot interleave a newer
-- snapshot while older group settings are being published.
create or replace function public.publish_account_workspace_metadata(
  p_expected_revision bigint,
  p_display_name text,
  p_avatar_path text,
  p_timezone text,
  p_energy_profile jsonb,
  p_group_id uuid,
  p_expected_group_configuration_revision bigint,
  p_group_name text,
  p_group_template_name text,
  p_group_settings jsonb,
  p_group_metrics jsonb,
  p_member_roles jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_role public.member_role;
  current_group_revision bigint;
  next_group_revision bigint;
  metric jsonb;
  member_role_row jsonb;
  existing_semantics jsonb := '[]'::jsonb;
  requested_semantics jsonb := '[]'::jsonb;
  metric_set_changed boolean := false;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  perform public.assert_account_snapshot_revision(
    caller_id,
    p_expected_revision
  );

  update public.profiles
     set display_name = p_display_name,
         avatar_path = p_avatar_path,
         timezone = p_timezone,
         account_revision = p_expected_revision,
         updated_at = now()
   where id = caller_id;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  insert into public.energy_profiles (
    user_id,
    age,
    biological_sex,
    height_cm,
    weight_kg,
    target_weight_kg,
    activity_level,
    desired_weekly_loss_kg,
    account_revision
  )
  values (
    caller_id,
    (p_energy_profile ->> 'age')::integer,
    p_energy_profile ->> 'biological_sex',
    (p_energy_profile ->> 'height_cm')::numeric,
    (p_energy_profile ->> 'weight_kg')::numeric,
    (p_energy_profile ->> 'target_weight_kg')::numeric,
    p_energy_profile ->> 'activity_level',
    (p_energy_profile ->> 'desired_weekly_loss_kg')::numeric,
    p_expected_revision
  )
  on conflict (user_id) do update
    set age = excluded.age,
        biological_sex = excluded.biological_sex,
        height_cm = excluded.height_cm,
        weight_kg = excluded.weight_kg,
        target_weight_kg = excluded.target_weight_kg,
        activity_level = excluded.activity_level,
        desired_weekly_loss_kg = excluded.desired_weekly_loss_kg,
        account_revision = excluded.account_revision;

  if p_group_id is not null then
    select membership.role, target.configuration_revision
      into caller_role, current_group_revision
      from public.groups target
      join public.group_members membership
        on membership.group_id = target.id
     where membership.group_id = p_group_id
       and membership.user_id = caller_id
       and membership.status = 'active'
     for update of target, membership;

    if caller_role is null or caller_role not in ('owner', 'admin') then
      raise exception 'Group administrator access required'
        using errcode = '42501';
    end if;

    if p_expected_group_configuration_revision is null
       or current_group_revision <> p_expected_group_configuration_revision then
      raise exception 'stale_group_configuration'
        using errcode = '40001';
    end if;
    next_group_revision := current_group_revision + 1;
    perform pg_catalog.set_config(
      'habhub.group_configuration_id',
      p_group_id::text,
      true
    );

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'slug', definition.slug,
          'data_type', definition.data_type::text,
          'aggregation_method', definition.aggregation_method,
          'ranking_direction', definition.ranking_direction,
          'formula', definition.formula,
          'score_weight', definition.score_weight,
          'default_visibility', definition.default_visibility::text,
          'configuration', jsonb_build_object(
            'goal', definition.configuration -> 'goal',
            'goalProgressMode', definition.configuration -> 'goalProgressMode',
            'goalEnabled', definition.configuration -> 'goalEnabled',
            'goalRange', definition.configuration -> 'goalRange',
            'gymMapping', definition.configuration -> 'gymMapping',
            'stepFallback', definition.configuration -> 'stepFallback',
            'submetrics', definition.configuration -> 'submetrics',
            'submetricDisplay', definition.configuration -> 'submetricDisplay',
            'sections', definition.configuration -> 'sections',
            'activeFrom', definition.configuration -> 'activeFrom'
          )
        )
        order by definition.slug
      ),
      '[]'::jsonb
    )
      into existing_semantics
      from public.metric_definitions definition
     where definition.group_id = p_group_id
       and definition.owner_user_id is null
       and definition.archived_at is null;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'slug', requested.metric ->> 'slug',
          'data_type', requested.metric ->> 'data_type',
          'aggregation_method', requested.metric ->> 'aggregation_method',
          'ranking_direction', requested.metric ->> 'ranking_direction',
          'formula', requested.metric -> 'formula',
          'score_weight', (requested.metric ->> 'score_weight')::numeric,
          'default_visibility', requested.metric ->> 'default_visibility',
          'configuration', jsonb_build_object(
            'goal', requested.metric -> 'configuration' -> 'goal',
            'goalProgressMode', requested.metric -> 'configuration' -> 'goalProgressMode',
            'goalEnabled', requested.metric -> 'configuration' -> 'goalEnabled',
            'goalRange', requested.metric -> 'configuration' -> 'goalRange',
            'gymMapping', requested.metric -> 'configuration' -> 'gymMapping',
            'stepFallback', requested.metric -> 'configuration' -> 'stepFallback',
            'submetrics', requested.metric -> 'configuration' -> 'submetrics',
            'submetricDisplay', requested.metric -> 'configuration' -> 'submetricDisplay',
            'sections', requested.metric -> 'configuration' -> 'sections',
            'activeFrom', requested.metric -> 'configuration' -> 'activeFrom'
          )
        )
        order by requested.metric ->> 'slug'
      ),
      '[]'::jsonb
    )
      into requested_semantics
      from jsonb_array_elements(coalesce(p_group_metrics, '[]'::jsonb))
        as requested(metric);

    metric_set_changed := existing_semantics is distinct from requested_semantics;

    update public.groups
       set name = p_group_name,
           template_name = p_group_template_name,
           settings = coalesce(p_group_settings, '{}'::jsonb),
           configuration_revision = next_group_revision
     where id = p_group_id;
    if not found then
      raise exception 'Group not found' using errcode = 'P0002';
    end if;

    update public.metric_definitions definition
       set archived_at = now(),
           group_configuration_revision = next_group_revision
     where definition.group_id = p_group_id
       and definition.owner_user_id is null
       and definition.archived_at is null
       and not exists (
         select 1
           from jsonb_array_elements(coalesce(p_group_metrics, '[]'::jsonb))
             as requested(metric)
          where requested.metric ->> 'slug' = definition.slug
       );

    for metric in
      select value
        from jsonb_array_elements(coalesce(p_group_metrics, '[]'::jsonb))
    loop
      insert into public.metric_definitions (
        group_id,
        owner_user_id,
        slug,
        name,
        icon,
        color,
        unit,
        data_type,
        aggregation_method,
        ranking_direction,
        formula,
        score_weight,
        default_visibility,
        configuration,
        archived_at,
        group_configuration_revision
      )
      values (
        p_group_id,
        null,
        metric ->> 'slug',
        metric ->> 'name',
        metric ->> 'icon',
        metric ->> 'color',
        coalesce(metric ->> 'unit', ''),
        (metric ->> 'data_type')::public.metric_data_type,
        metric ->> 'aggregation_method',
        metric ->> 'ranking_direction',
        metric ->> 'formula',
        coalesce((metric ->> 'score_weight')::numeric, 0),
        (metric ->> 'default_visibility')::public.entry_visibility,
        coalesce(metric -> 'configuration', '{}'::jsonb),
        null,
        next_group_revision
      )
      on conflict (group_id, owner_user_id, slug) do update
        set name = excluded.name,
            icon = excluded.icon,
            color = excluded.color,
            unit = excluded.unit,
            data_type = excluded.data_type,
            aggregation_method = excluded.aggregation_method,
            ranking_direction = excluded.ranking_direction,
            formula = excluded.formula,
            score_weight = excluded.score_weight,
            default_visibility = excluded.default_visibility,
            configuration = excluded.configuration,
            archived_at = null,
            group_configuration_revision = excluded.group_configuration_revision;
    end loop;

    if caller_role = 'owner' then
      for member_role_row in
        select value
          from jsonb_array_elements(coalesce(p_member_roles, '[]'::jsonb))
      loop
        update public.group_members membership
           set role = case
                 when member_role_row ->> 'role' = 'admin'
                   then 'admin'::public.member_role
                 else 'member'::public.member_role
               end,
               role_configuration_revision = next_group_revision
         where membership.group_id = p_group_id
           and membership.user_id = (member_role_row ->> 'user_id')::uuid
           and membership.role <> 'owner'
           and membership.status = 'active';
      end loop;
    end if;
  end if;

  return jsonb_build_object(
    'groupMetricSetChanged', metric_set_changed,
    'groupConfigurationRevision',
      case when p_group_id is null then null else next_group_revision end
  );
end;
$$;

revoke all on function public.publish_account_workspace_metadata(
  bigint, text, text, text, jsonb, uuid, bigint, text, text, jsonb, jsonb, jsonb
) from public;
grant execute on function public.publish_account_workspace_metadata(
  bigint, text, text, text, jsonb, uuid, bigint, text, text, jsonb, jsonb, jsonb
) to authenticated;

comment on function public.publish_account_workspace_metadata(
  bigint, text, text, text, jsonb, uuid, bigint, text, text, jsonb, jsonb, jsonb
) is 'Revision-checked transactional projection of account profile and optional group configuration.';

-- Account deletion can transfer ownership, so it must participate in the same
-- group-configuration fence as an explicit leave operation.
create or replace function public.prepare_profile_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owned_group record;
  successor_id uuid;
  next_group_revision bigint;
begin
  for owned_group in
    select target.id, target.configuration_revision
      from public.groups target
     where target.owner_id = old.id
     for update
  loop
    select membership.user_id
      into successor_id
      from public.group_members membership
     where membership.group_id = owned_group.id
       and membership.user_id <> old.id
       and membership.status = 'active'
     order by
       case when membership.role = 'admin' then 0 else 1 end,
       membership.joined_at
     limit 1;

    if successor_id is null then
      delete from public.groups where id = owned_group.id;
    else
      next_group_revision := owned_group.configuration_revision + 1;
      perform pg_catalog.set_config(
        'habhub.group_configuration_id',
        owned_group.id::text,
        true
      );
      update public.groups
         set owner_id = successor_id,
             configuration_revision = next_group_revision,
             updated_at = now()
       where id = owned_group.id;
      update public.group_members
         set role = 'owner',
             role_configuration_revision = next_group_revision
       where group_id = owned_group.id
         and user_id = successor_id;
    end if;

    successor_id := null;
    next_group_revision := null;
  end loop;

  return old;
end;
$$;
