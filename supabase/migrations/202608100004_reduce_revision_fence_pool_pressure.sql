-- Bulk status/entry upserts invoke the revision fence once per row. The first
-- check takes a row lock on user_snapshots which is retained until the current
-- transaction ends, so repeating the same SELECT FOR UPDATE hundreds of times
-- adds no safety and needlessly occupies a PostgREST connection.
--
-- Cache a successfully asserted owner+revision in a transaction-local setting.
-- Separate HTTP requests use separate transactions and therefore must assert
-- again. If a statement ever contains another owner/revision, the marker no
-- longer matches and the normal locked check still runs.

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
  expected_fence text;
begin
  if caller_id is null or caller_id <> p_user_id then
    raise exception 'account_revision_forbidden' using errcode = '42501';
  end if;

  if p_expected_revision is null then
    raise exception 'stale_group_publish' using errcode = '40001';
  end if;

  expected_fence := p_user_id::text || ':' || p_expected_revision::text;
  if current_setting('habhub.account_revision_fence', true)
       = expected_fence then
    return;
  end if;

  select snapshot.revision
    into current_revision
    from public.user_snapshots snapshot
   where snapshot.user_id = p_user_id
   for update;

  if current_revision is null
     or current_revision <> p_expected_revision then
    raise exception 'stale_group_publish' using errcode = '40001';
  end if;

  perform set_config(
    'habhub.account_revision_fence',
    expected_fence,
    true
  );
end;
$$;

revoke all on function public.assert_account_snapshot_revision(uuid, bigint)
  from public;
grant execute on function public.assert_account_snapshot_revision(uuid, bigint)
  to authenticated;
