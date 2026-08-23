-- Realtime CPU containment.
--
-- These three high-churn/private tables were added to the Postgres Changes
-- publication by the original sync implementation. Current clients no longer
-- subscribe to them:
--
-- * account snapshots publish a private, revision-only Broadcast;
-- * entry/status commits publish one private group-activity Broadcast and keep
--   group_activity_versions as the compact Postgres Changes fallback.
--
-- Leaving the old tables published makes Realtime repeatedly evaluate their
-- restrictive privacy policies across thousands of health rows. Removing them
-- does not change table access, RLS, writes, sync, or the compact fallback; it
-- only stops generating unused Postgres Changes work. Very old installed
-- clients could use these changes as an error fallback, but released clients
-- have used the private Broadcast/version path as their primary path since the
-- August 4 cutover; losing that legacy fallback delays refresh until a manual
-- sync/restart and cannot lose or expose stored data.
do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'user_snapshots',
    'metric_entries',
    'daily_metric_status'
  ]
  loop
    if exists (
      select 1
        from pg_catalog.pg_publication_tables publication_table
       where publication_table.pubname = 'supabase_realtime'
         and publication_table.schemaname = 'public'
         and publication_table.tablename = relation_name
    ) then
      execute format(
        'alter publication supabase_realtime drop table public.%I',
        relation_name
      );
    end if;
  end loop;
end;
$$;
