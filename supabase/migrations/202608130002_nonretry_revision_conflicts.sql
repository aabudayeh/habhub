-- SQLSTATE 40001 means a genuine PostgreSQL serialization failure. Database
-- clients and transaction middleware are allowed to retry that class, so it
-- must not be used for HabHub's deterministic revision/CAS rejections. A stale
-- installed client can otherwise turn one permanently stale token into an
-- unbounded rollback storm.
--
-- Keep every fence fail-closed and preserve its stable message (the current
-- clients rebase from those messages), but expose it as PL/pgSQL raise_exception
-- P0001 instead. PostgREST maps P0001 to HTTP 400 and does not classify it as a
-- transaction-retry condition.

do $migration$
declare
  expected_functions constant text[] := array[
    'assert_account_snapshot_revision',
    'enforce_account_profile_revision',
    'enforce_group_configuration_fence',
    'enforce_group_projection_revision',
    'publish_account_workspace_metadata'
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
      raise exception 'Could not rewrite revision fence %', target.proname
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
