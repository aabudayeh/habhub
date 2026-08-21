insert into public.metric_definitions (
  group_id, owner_user_id, slug, name, icon, color, unit, data_type,
  aggregation_method, ranking_direction, score_weight, default_visibility, configuration
)
select g.id, null, 'weekly_deficit_balance', 'Weekly deficit balance', 'calendar-number-outline', '#7756D9', 'kcal',
  'calculated'::public.metric_data_type, 'latest', 'closest', 0, 'group'::public.entry_visibility,
  jsonb_build_object('goal',jsonb_build_object('kind','exact','target',0),'sections',jsonb_build_object('today',true,'group',false,'insights',false),'order',31,'activeFrom',current_date::text)
from public.groups g
on conflict (group_id,owner_user_id,slug) do nothing;

update public.metric_definitions
set configuration = jsonb_set(configuration, '{sections,today}', 'true'::jsonb, true)
where slug in ('workout_duration','workout_calories','workout_distance','body_fat','lean_body_mass','blood_pressure_systolic','blood_pressure_diastolic','pulse');
