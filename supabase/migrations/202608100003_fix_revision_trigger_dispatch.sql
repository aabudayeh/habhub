-- PostgreSQL resolves fields referenced inside a CASE expression against the
-- concrete NEW/OLD row type used by a trigger invocation. The revision guards
-- are intentionally shared by tables with different owner columns, so a CASE
-- branch that is not selected can still fail with SQLSTATE 42703 while being
-- prepared (for example NEW.user_id on public.profiles).
--
-- Keep each table-specific row expression in its own PL/pgSQL branch. Branch
-- statements are prepared only when that relation fires the function, while
-- the existing revision, ownership, and stale-write checks remain unchanged.

create or replace function public.enforce_account_profile_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  owner_id uuid;
  content_changed boolean := false;
begin
  if caller_id is null then
    return new;
  end if;

  if tg_table_name = 'profiles' then
    owner_id := new.id;
  elsif tg_table_name = 'energy_profiles' then
    owner_id := new.user_id;
  else
    raise exception 'unsupported_account_revision_relation'
      using errcode = '0A000';
  end if;

  if owner_id <> caller_id or new.account_revision is null then
    raise exception 'account_revision_required' using errcode = '40001';
  end if;

  if tg_op = 'UPDATE' then
    if tg_table_name = 'profiles' then
      content_changed :=
        (new.display_name, new.avatar_path, new.timezone)
          is distinct from
        (old.display_name, old.avatar_path, old.timezone);
    elsif tg_table_name = 'energy_profiles' then
      content_changed := (
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
      );
    end if;
  end if;
  if content_changed
     and old.account_revision is not null
     and new.account_revision <= old.account_revision then
    raise exception 'stale_group_publish' using errcode = '40001';
  end if;

  perform public.assert_account_snapshot_revision(
    owner_id,
    new.account_revision
  );
  return new;
end;
$$;

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

  if tg_table_name = 'metric_entries' then
    owner_id := new.user_id;
  elsif tg_table_name = 'daily_metric_status' then
    owner_id := new.user_id;
  elsif tg_table_name = 'photo_updates' then
    owner_id := new.owner_user_id;
  else
    raise exception 'unsupported_group_projection_relation'
      using errcode = '0A000';
  end if;

  perform public.assert_account_snapshot_revision(
    owner_id,
    new.account_revision
  );
  return new;
end;
$$;
