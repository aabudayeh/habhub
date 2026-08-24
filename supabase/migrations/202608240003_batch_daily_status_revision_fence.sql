-- Daily status upserts can contain hundreds of tracker/date rows. The former
-- row trigger called assert_account_snapshot_revision for every row, creating
-- a user_snapshots lookup storm in already-installed clients. Keep cheap
-- owner/null/monotonic checks per row, but perform the snapshot fence once per
-- distinct owner/revision in each INSERT or UPDATE statement.

create or replace function public.enforce_daily_metric_status_revision_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  -- Trusted SQL/service-role maintenance has no end-user JWT, matching the
  -- existing projection trigger's behavior.
  if caller_id is null then
    return new;
  end if;

  if new.user_id <> caller_id then
    raise exception 'account_revision_forbidden' using errcode = '42501';
  end if;
  if new.account_revision is null then
    raise exception 'account_revision_required' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE'
     and old.account_revision is not null
     and new.account_revision < old.account_revision then
    raise exception 'stale_group_publish' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function public.assert_daily_metric_status_insert_revisions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  revision_row record;
begin
  if caller_id is null then
    return null;
  end if;

  if exists (
    select 1
    from inserted_status_rows status
    where status.account_revision is null
  ) then
    raise exception 'account_revision_required' using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from inserted_status_rows status
    where status.user_id <> caller_id
  ) then
    raise exception 'account_revision_forbidden' using errcode = '42501';
  end if;

  for revision_row in
    select distinct status.user_id, status.account_revision
    from inserted_status_rows status
  loop
    perform public.assert_account_snapshot_revision(
      revision_row.user_id,
      revision_row.account_revision
    );
  end loop;
  return null;
end;
$$;

create or replace function public.assert_daily_metric_status_update_revisions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  revision_row record;
begin
  if caller_id is null then
    return null;
  end if;

  if exists (
    select 1
    from updated_status_rows status
    where status.account_revision is null
  ) then
    raise exception 'account_revision_required' using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from updated_status_rows status
    where status.user_id <> caller_id
  ) then
    raise exception 'account_revision_forbidden' using errcode = '42501';
  end if;

  for revision_row in
    select distinct status.user_id, status.account_revision
    from updated_status_rows status
  loop
    perform public.assert_account_snapshot_revision(
      revision_row.user_id,
      revision_row.account_revision
    );
  end loop;
  return null;
end;
$$;

drop trigger if exists daily_metric_status_enforce_account_revision
  on public.daily_metric_status;
create trigger daily_metric_status_enforce_account_revision
before insert or update on public.daily_metric_status
for each row execute function public.enforce_daily_metric_status_revision_row();

drop trigger if exists daily_metric_status_enforce_insert_revision_statement
  on public.daily_metric_status;
create trigger daily_metric_status_enforce_insert_revision_statement
after insert on public.daily_metric_status
referencing new table as inserted_status_rows
for each statement execute function public.assert_daily_metric_status_insert_revisions();

drop trigger if exists daily_metric_status_enforce_update_revision_statement
  on public.daily_metric_status;
create trigger daily_metric_status_enforce_update_revision_statement
after update on public.daily_metric_status
referencing new table as updated_status_rows
for each statement execute function public.assert_daily_metric_status_update_revisions();

revoke all on function public.enforce_daily_metric_status_revision_row()
  from public, anon, authenticated;
revoke all on function public.assert_daily_metric_status_insert_revisions()
  from public, anon, authenticated;
revoke all on function public.assert_daily_metric_status_update_revisions()
  from public, anon, authenticated;

comment on function public.enforce_daily_metric_status_revision_row() is
  'Cheap per-row owner/null/monotonic guard; snapshot revision is checked after each statement.';
comment on function public.assert_daily_metric_status_insert_revisions() is
  'Checks each distinct daily-status owner/revision once after an INSERT statement.';
comment on function public.assert_daily_metric_status_update_revisions() is
  'Checks each distinct daily-status owner/revision once after an UPDATE statement.';
