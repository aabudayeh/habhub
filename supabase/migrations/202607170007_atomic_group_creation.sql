create or replace function public.create_group_with_metrics(
  group_name text,
  metric_configuration jsonb,
  group_theme_color text default '#176B4D'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_group_id uuid;
  generated_code text;
  metric jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(trim(group_name)) not between 1 and 80 then raise exception 'Group name must be between 1 and 80 characters'; end if;

  insert into public.profiles (id, display_name)
  values (
    auth.uid(),
    coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', auth.jwt() -> 'user_metadata' ->> 'name', split_part(auth.jwt() ->> 'email', '@', 1), 'Paceboard member')
  ) on conflict (id) do nothing;

  loop
    generated_code := 'PACE-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    begin
      insert into public.groups (owner_id, name, invite_code, template_name, settings)
      values (auth.uid(), trim(group_name), generated_code, 'Healthy Competition', jsonb_build_object('streakRestDaysPerWeek', 1, 'themeColor', group_theme_color))
      returning id into created_group_id;
      exit;
    exception when unique_violation then
      continue;
    end;
  end loop;

  for metric in select value from jsonb_array_elements(coalesce(metric_configuration, '[]'::jsonb)) loop
    insert into public.metric_definitions (
      group_id, owner_user_id, slug, name, icon, color, unit, data_type,
      aggregation_method, ranking_direction, formula, score_weight,
      default_visibility, configuration
    ) values (
      created_group_id, null, metric ->> 'id', metric ->> 'name',
      coalesce(metric ->> 'icon', 'analytics-outline'), coalesce(metric ->> 'color', '#176B4D'),
      coalesce(metric ->> 'unit', ''), (metric ->> 'dataType')::public.metric_data_type,
      coalesce(metric ->> 'aggregation', 'sum'), coalesce(metric ->> 'rankingDirection', 'higher'),
      nullif(metric ->> 'formula', ''), coalesce((metric ->> 'scoreWeight')::numeric, 0),
      coalesce(metric ->> 'defaultVisibility', 'group')::public.entry_visibility,
      jsonb_build_object(
        'goal', metric -> 'goal', 'sections', metric -> 'sections',
        'order', coalesce((metric ->> 'order')::integer, 0),
        'activeFrom', metric ->> 'activeFrom'
      )
    );
  end loop;

  return created_group_id;
end;
$$;

revoke all on function public.create_group_with_metrics(text, jsonb, text) from public;
grant execute on function public.create_group_with_metrics(text, jsonb, text) to authenticated;
