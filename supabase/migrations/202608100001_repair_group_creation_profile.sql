-- Group creation must not assume the public profile projection already exists.
-- Older accounts, partially deleted accounts, and projects restored from a
-- backup can have a valid auth.users row before the profile trigger catches up.

create or replace function public.create_group_with_metrics_v2(
  p_group_name text,
  p_metric_rows jsonb,
  p_group_theme_color text default '#0FBFB8',
  p_require_member_approval boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  created_group_id uuid;
  generated_code text;
  metric jsonb;
  profile_name text;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if char_length(trim(p_group_name)) not between 1 and 80 then
    raise exception 'Group name must be between 1 and 80 characters'
      using errcode = '22023';
  end if;
  if p_metric_rows is not null
     and jsonb_typeof(p_metric_rows) <> 'array' then
    raise exception 'Metric configuration must be a JSON array'
      using errcode = '22023';
  end if;

  profile_name := coalesce(
    nullif(trim(auth.jwt() -> 'user_metadata' ->> 'display_name'), ''),
    nullif(trim(auth.jwt() -> 'user_metadata' ->> 'full_name'), ''),
    nullif(trim(auth.jwt() -> 'user_metadata' ->> 'name'), ''),
    nullif(split_part(auth.jwt() ->> 'email', '@', 1), ''),
    'HabHub member'
  );
  insert into public.profiles (id, display_name)
  values (caller_id, left(profile_name, 80))
  on conflict (id) do nothing;

  loop
    generated_code := 'HAB-' || upper(
      substr(md5(random()::text || clock_timestamp()::text), 1, 6)
    );
    begin
      insert into public.groups (
        owner_id,
        name,
        invite_code,
        template_name,
        settings,
        configuration_revision
      )
      values (
        caller_id,
        trim(p_group_name),
        generated_code,
        'Healthy Competition',
        jsonb_build_object(
          'streakRestDaysPerWeek', 1,
          'themeColor', p_group_theme_color,
          'requireMemberApproval', p_require_member_approval
        ),
        0
      )
      returning id into created_group_id;
      exit;
    exception when unique_violation then
      continue;
    end;
  end loop;

  perform pg_catalog.set_config(
    'habhub.group_configuration_id',
    created_group_id::text,
    true
  );

  for metric in
    select value
      from jsonb_array_elements(coalesce(p_metric_rows, '[]'::jsonb))
  loop
    insert into public.metric_definitions (
      group_id,
      owner_user_id,
      slug,
      name,
      icon,
      color,
      unit,
      data_type,
      aggregation_method,
      ranking_direction,
      formula,
      score_weight,
      default_visibility,
      configuration,
      archived_at,
      group_configuration_revision
    )
    values (
      created_group_id,
      null,
      metric ->> 'slug',
      metric ->> 'name',
      coalesce(metric ->> 'icon', 'analytics-outline'),
      coalesce(metric ->> 'color', '#081B49'),
      coalesce(metric ->> 'unit', ''),
      coalesce(metric ->> 'data_type', 'number')::public.metric_data_type,
      coalesce(metric ->> 'aggregation_method', 'sum'),
      coalesce(metric ->> 'ranking_direction', 'higher'),
      nullif(metric ->> 'formula', ''),
      coalesce((metric ->> 'score_weight')::numeric, 0),
      coalesce(
        metric ->> 'default_visibility',
        'group'
      )::public.entry_visibility,
      coalesce(metric -> 'configuration', '{}'::jsonb),
      null,
      0
    );
  end loop;

  return created_group_id;
end;
$$;

revoke all on function public.create_group_with_metrics_v2(
  text, jsonb, text, boolean
) from public;
grant execute on function public.create_group_with_metrics_v2(
  text, jsonb, text, boolean
) to authenticated;

comment on function public.create_group_with_metrics_v2(
  text, jsonb, text, boolean
) is
  'Atomically repairs the caller profile, creates a group, and installs its active shared tracker definitions.';
