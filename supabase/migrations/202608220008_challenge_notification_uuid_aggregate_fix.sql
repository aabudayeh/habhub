-- PostgreSQL does not provide min(uuid) on every supported Supabase image.
-- Keep fresh installs correct in 006 and repair the already-deployed function
-- without duplicating its large, independently-reviewed definition here.
do $repair$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
           'public.stage_group_challenge_notifications(integer)'::regprocedure
         )
    into v_definition;

  if pg_catalog.strpos(v_definition, 'min(standing.user_id)') > 0 then
    execute pg_catalog.replace(
      v_definition,
      'min(standing.user_id)',
      '(array_agg(standing.user_id order by standing.user_id))[1]'
    );
  elsif pg_catalog.strpos(
          v_definition,
          '(array_agg(standing.user_id order by standing.user_id))[1]'
        ) = 0 then
    raise exception 'Challenge notification worker definition was not recognized.';
  end if;
end;
$repair$;
