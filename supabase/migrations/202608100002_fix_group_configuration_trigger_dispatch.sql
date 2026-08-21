-- Keep the configuration fence polymorphic without dereferencing columns that
-- do not exist on the row type currently firing the trigger. PostgreSQL may
-- evaluate both operands of an AND expression, so the previous table-name
-- guard could still attempt NEW.role_configuration_revision while inserting a
-- metric definition and abort group creation with SQLSTATE 42703.

create or replace function public.enforce_group_configuration_fence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_group_id uuid;
  member_role_revision bigint;
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
  elsif tg_table_name = 'group_members' then
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
    member_role_revision := new.role_configuration_revision;
  else
    raise exception 'unsupported_group_configuration_relation'
      using errcode = '0A000';
  end if;

  if marker is null or marker <> target_group_id::text then
    raise exception 'group_configuration_revision_required'
      using errcode = '40001';
  end if;
  if tg_table_name = 'group_members' then
    if member_role_revision is distinct from (
      select target.configuration_revision
        from public.groups target
       where target.id = target_group_id
    ) then
      raise exception 'stale_group_configuration' using errcode = '40001';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

