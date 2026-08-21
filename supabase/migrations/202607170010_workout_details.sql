with defaults(slug,name,icon,color,unit,sort_order,goal_target) as (values
  ('workout_calories','Workout calories','flame-outline','#D95852','kcal',19,250),
  ('workout_distance','Workout distance','map-outline','#3478D4','km',20,3)
)
insert into public.metric_definitions (
  group_id,owner_user_id,slug,name,icon,color,unit,data_type,aggregation_method,
  ranking_direction,score_weight,default_visibility,configuration
)
select g.id,null,d.slug,d.name,d.icon,d.color,d.unit,'number'::public.metric_data_type,'sum',
  'higher',0,'group'::public.entry_visibility,
  jsonb_build_object('goal',jsonb_build_object('kind','at_least','target',d.goal_target),'sections',jsonb_build_object('today',false,'group',false,'insights',true),'order',d.sort_order,'activeFrom',current_date::text)
from public.groups g cross join defaults d
on conflict (group_id,owner_user_id,slug) do nothing;
