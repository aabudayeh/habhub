-- Shared rows are projections of the private account snapshot. Stamp each
-- projection with that snapshot revision so a slower device cannot overwrite a
-- newer device's visibility, value, or deletion decision after the fact.

alter table public.metric_entries
  add column if not exists account_revision bigint;
alter table public.daily_metric_status
  add column if not exists account_revision bigint;
alter table public.photo_updates
  add column if not exists account_revision bigint;

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

  -- The row lock serializes this projection statement against the CAS snapshot
  -- update without blocking unrelated accounts.
  select snapshot.revision
    into current_revision
    from public.user_snapshots snapshot
   where snapshot.user_id = p_user_id
   for update;

  if current_revision is null or current_revision <> p_expected_revision then
    raise exception 'stale_group_publish' using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.assert_account_snapshot_revision(uuid, bigint)
  from public;
grant execute on function public.assert_account_snapshot_revision(uuid, bigint)
  to authenticated;

create or replace function public.enforce_group_projection_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
begin
  if tg_op = 'UPDATE'
     and old.account_revision is not null
     and (
       new.account_revision is null
       or new.account_revision < old.account_revision
     ) then
    raise exception 'stale_group_publish' using errcode = '40001';
  end if;

  -- Null remains temporarily accepted for older installed clients. Every row
  -- written by this release is causal and protected from older revisions.
  if new.account_revision is null then
    return new;
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

drop trigger if exists metric_entries_enforce_account_revision
  on public.metric_entries;
create trigger metric_entries_enforce_account_revision
before insert or update on public.metric_entries
for each row execute function public.enforce_group_projection_revision();

drop trigger if exists daily_metric_status_enforce_account_revision
  on public.daily_metric_status;
create trigger daily_metric_status_enforce_account_revision
before insert or update on public.daily_metric_status
for each row execute function public.enforce_group_projection_revision();

drop trigger if exists photo_updates_enforce_account_revision
  on public.photo_updates;
create trigger photo_updates_enforce_account_revision
before insert or update on public.photo_updates
for each row execute function public.enforce_group_projection_revision();

create or replace function public.delete_group_metric_entries(
  p_client_generated_ids text[],
  p_expected_revision bigint
)
returns table (
  deleted_client_generated_id text,
  deleted_local_date date
)
language plpgsql
security invoker
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

revoke all on function public.delete_group_metric_entries(text[], bigint)
  from public;
grant execute on function public.delete_group_metric_entries(text[], bigint)
  to authenticated;

create or replace function public.clear_group_metric_entry_tombstones(
  p_client_generated_ids text[],
  p_expected_revision bigint
)
returns void
language plpgsql
security invoker
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

revoke all on function public.clear_group_metric_entry_tombstones(text[], bigint)
  from public;
grant execute on function public.clear_group_metric_entry_tombstones(text[], bigint)
  to authenticated;

create or replace function public.commit_group_activity_version(
  p_group_id uuid,
  p_since_date date,
  p_expected_revision bigint
)
returns bigint
language plpgsql
security invoker
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

revoke all on function public.commit_group_activity_version(uuid, date, bigint)
  from public;
grant execute on function public.commit_group_activity_version(uuid, date, bigint)
  to authenticated;

create or replace function public.delete_group_photo_updates(
  p_client_generated_ids text[],
  p_group_id uuid,
  p_expected_revision bigint
)
returns text[]
language plpgsql
security invoker
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

revoke all on function public.delete_group_photo_updates(text[], uuid, bigint)
  from public;
grant execute on function public.delete_group_photo_updates(text[], uuid, bigint)
  to authenticated;

comment on column public.metric_entries.account_revision is
  'Private account snapshot revision that causally published this shared row.';
comment on column public.daily_metric_status.account_revision is
  'Private account snapshot revision that causally published this shared row.';
comment on column public.photo_updates.account_revision is
  'Private account snapshot revision that causally published this shared row.';
