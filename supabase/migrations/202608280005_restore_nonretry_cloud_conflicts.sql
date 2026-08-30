-- Later Google Health/protocol migrations redefined three revision guards
-- after 202608130002_nonretry_revision_conflicts.sql and accidentally restored
-- SQLSTATE 40001. PostgREST treats 40001 as a retryable serialization failure;
-- a deterministic stale revision can therefore keep one HTTP request retrying
-- inside the database and exhaust compute without ever returning to the client.
--
-- Keep the conflicts fail-closed and retain their stable messages, but expose
-- them as PL/pgSQL raise_exception P0001 so the client receives one response
-- and can perform its bounded rebase/backoff path.

do $migration$
declare
  expected_functions constant text[] := array[
    'apply_google_health_import',
    'assert_account_snapshot_revision',
    'project_google_health_group_data'
  ];
  retry_functions text[];
  target record;
  rewritten_definition text;
begin
  select array_agg(candidate.proname order by candidate.proname)
    into retry_functions
    from (
      select p.proname
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n
          on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prokind in ('f', 'p')
         and pg_catalog.strpos(
           pg_catalog.pg_get_functiondef(p.oid),
           '''40001'''
         ) > 0
    ) candidate;

  if retry_functions is distinct from expected_functions then
    raise exception
      'Unexpected public functions use retry-class SQLSTATE 40001: %',
      coalesce(retry_functions::text, '<none>')
      using errcode = 'P0001';
  end if;

  for target in
    select
      p.proname,
      pg_catalog.pg_get_functiondef(p.oid) as function_definition
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(p.oid),
        '''40001'''
      ) > 0
    order by p.proname
  loop
    rewritten_definition := pg_catalog.replace(
      target.function_definition,
      '''40001''',
      '''P0001'''
    );
    if rewritten_definition is not distinct from target.function_definition then
      raise exception 'Could not rewrite revision conflict %', target.proname
        using errcode = 'P0001';
    end if;
    execute rewritten_definition;
  end loop;

  if exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n
        on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'p')
       and pg_catalog.strpos(
         pg_catalog.pg_get_functiondef(p.oid),
         '''40001'''
       ) > 0
  ) then
    raise exception 'A public function still uses retry-class SQLSTATE 40001'
      using errcode = 'P0001';
  end if;
end;
$migration$;
