with defaults(slug,name,icon,color,unit,aggregation_method,ranking_direction,goal_kind,goal_target,sort_order) as (values
  ('workout_duration','Workout duration','timer-outline','#337B7B','min','sum','higher','at_least',30,13),
  ('body_fat','Body fat','body-outline','#9B6B43','%','latest','closest','exact',20,14),
  ('lean_body_mass','Lean body mass','fitness-outline','#5A7184','kg','latest','higher','at_least',0,15),
  ('blood_pressure_systolic','Systolic pressure','heart-outline','#D95852','mmHg','latest','closest','exact',120,16),
  ('blood_pressure_diastolic','Diastolic pressure','heart-half-outline','#C45B35','mmHg','latest','closest','exact',80,17),
  ('pulse','Pulse','pulse-outline','#9B3F72','bpm','latest','closest','exact',70,18)
)
insert into public.metric_definitions (
  group_id,owner_user_id,slug,name,icon,color,unit,data_type,aggregation_method,
  ranking_direction,score_weight,default_visibility,configuration
)
select g.id,null,d.slug,d.name,d.icon,d.color,d.unit,'number'::public.metric_data_type,d.aggregation_method,
  d.ranking_direction,0,'group'::public.entry_visibility,
  jsonb_build_object('goal',jsonb_build_object('kind',d.goal_kind,'target',d.goal_target),'sections',jsonb_build_object('today',false,'group',false,'insights',true),'order',d.sort_order,'activeFrom',current_date::text)
from public.groups g cross join defaults d
on conflict (group_id,owner_user_id,slug) do nothing;
