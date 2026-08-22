-- PostgreSQL's PL/pgSQL linter treats an untyped empty-array literal used in
-- a variable initializer as a possible text-to-text[] assignment. Recreate
-- only the four affected Google Health functions, preserving their installed
-- definitions byte-for-byte apart from the explicit text[] cast.
do $migration$
declare
  v_target record;
  v_definition text;
  v_replacement_count integer;
  v_source constant text := 'text[] := ''{}'';';
  v_replacement constant text := 'text[] := array[]::text[];';
begin
  for v_target in
    select *
      from (values
        ('public.purge_google_health_group_projections(uuid,text[],bigint,boolean)'::regprocedure, 1),
        ('public.update_google_health_metric_visibility(uuid,text,text)'::regprocedure, 1),
        ('public.apply_google_health_import(uuid,jsonb,jsonb,jsonb,timestamptz,bigint,uuid)'::regprocedure, 7),
        ('public.delete_google_health_imports(uuid)'::regprocedure, 1)
      ) targets(signature, expected_count)
  loop
    select pg_catalog.pg_get_functiondef(v_target.signature)
      into v_definition;

    v_replacement_count := (
      length(v_definition) - length(replace(v_definition, v_source, ''))
    ) / length(v_source);
    if v_replacement_count <> v_target.expected_count then
      raise exception
        'google_health_array_initializer_count_mismatch for %: expected %, found %',
        v_target.signature,
        v_target.expected_count,
        v_replacement_count;
    end if;

    execute replace(v_definition, v_source, v_replacement);
  end loop;
end;
$migration$;
