-- Explicit deletions are an outbox operation. A transport failure can occur
-- after the first request committed, leaving the client to retry an id whose
-- relational row is already absent. The former RPC returned only rows deleted
-- by this exact attempt, so that successful retry could never acknowledge the
-- durable local tombstone and every later autosave repeated the same scan.
--
-- Keep the existing revision/privacy fence and canonical deletion function.
-- Return each distinct requested id after that function finishes, with the
-- deleted date when one was available. An absent row is already the requested
-- server state, so acknowledging it is both idempotent and safe. A stale
-- device still fails before any acknowledgement at the snapshot fence.

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
    with requested as materialized (
      select distinct requested_id as client_generated_id
        from unnest(coalesce(p_client_generated_ids, array[]::text[]))
          as requested(requested_id)
       where requested_id is not null
         and btrim(requested_id) <> ''
       limit 1000
    ),
    removed as materialized (
      select deletion.deleted_client_generated_id,
             deletion.deleted_local_date
        from public.delete_group_metric_entries(
          array(
            select requested.client_generated_id
              from requested
          )
        ) deletion
    )
    select requested.client_generated_id,
           removed.deleted_local_date
      from requested
      left join removed
        on removed.deleted_client_generated_id = requested.client_generated_id;
end;
$$;

revoke all on function public.delete_group_metric_entries(text[], bigint)
  from public, anon, service_role;
grant execute on function public.delete_group_metric_entries(text[], bigint)
  to authenticated;

comment on function public.delete_group_metric_entries(text[], bigint) is
  'Revision-fenced, idempotent metric-entry deletion; every valid requested id is acknowledged after canonical deletion, including rows already absent after a prior committed attempt.';

notify pgrst, 'reload schema';
