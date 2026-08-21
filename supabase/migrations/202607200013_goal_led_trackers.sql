with defaults(slug,name,icon,color,unit,data_type,aggregation_method,ranking_direction,goal,sort_order,mapping) as (values
  ('sleep','Sleep','moon-outline','#5969B0','hr','number'::public.metric_data_type,'sum','closest','{"kind":"exact","target":8}'::jsonb,32,'{"dataType":"sleep","field":"duration_minutes"}'::jsonb),
  ('blood_glucose','Blood glucose','water-outline','#A64F6A','mg/dL','number'::public.metric_data_type,'average','closest','{"kind":"exact","target":100}'::jsonb,33,'{"dataType":"blood_glucose","field":"value"}'::jsonb),
  ('menstrual_cycle','Cycle tracking','flower-outline','#C95B88','','boolean'::public.metric_data_type,'max','higher','{"kind":"complete","target":1}'::jsonb,34,'{"dataType":"menstruation","field":"value"}'::jsonb)
)
insert into public.metric_definitions(group_id,owner_user_id,slug,name,icon,color,unit,data_type,aggregation_method,ranking_direction,score_weight,default_visibility,configuration)
select g.id,null,d.slug,d.name,d.icon,d.color,d.unit,d.data_type,d.aggregation_method,d.ranking_direction,0,
  case when d.slug='menstrual_cycle' then 'private'::public.entry_visibility else 'group'::public.entry_visibility end,
  jsonb_build_object('goal',d.goal,'goalEnabled',d.slug not in ('menstrual_cycle','blood_glucose'),'goalRange',case when d.slug='sleep' then '{"min":7,"max":9}'::jsonb end,'category','health','healthMapping',d.mapping,'manualEntry',true,'sections',jsonb_build_object('today',false,'group',false,'insights',true),'order',d.sort_order,'activeFrom',current_date::text)
from public.groups g cross join defaults d on conflict(group_id,owner_user_id,slug) do nothing;

update public.metric_definitions m set configuration=jsonb_set(jsonb_set(jsonb_set(coalesce(m.configuration,'{}'::jsonb),'{healthMapping}',x.mapping,true),'{category}',to_jsonb(x.category),true),'{manualEntry}',to_jsonb(x.manual_entry),true)
from (values
 ('steps','{"dataType":"steps","field":"value"}'::jsonb,'activity',false),('food','{"dataType":"nutrition","field":"value"}'::jsonb,'nutrition',true),('exercise','{"dataType":"active_energy","field":"value"}'::jsonb,'activity',true),('water','{"dataType":"water","field":"value"}'::jsonb,'nutrition',true),('weight','{"dataType":"weight","field":"value"}'::jsonb,'body',true),
 ('workout','{"dataType":"workouts","field":"value"}'::jsonb,'activity',true),('workout_duration','{"dataType":"workouts","field":"duration_minutes"}'::jsonb,'activity',true),('workout_calories','{"dataType":"workouts","field":"active_calories"}'::jsonb,'activity',true),('workout_distance','{"dataType":"workouts","field":"distance_km"}'::jsonb,'activity',true),
 ('body_fat','{"dataType":"body_fat","field":"value"}'::jsonb,'body',true),('lean_body_mass','{"dataType":"lean_body_mass","field":"value"}'::jsonb,'body',true),('blood_pressure_systolic','{"dataType":"blood_pressure","field":"systolic"}'::jsonb,'health',true),('blood_pressure_diastolic','{"dataType":"blood_pressure","field":"diastolic"}'::jsonb,'health',true),('pulse','{"dataType":"heart_rate","field":"value"}'::jsonb,'health',true)
) as x(slug,mapping,category,manual_entry) where m.slug=x.slug;

update public.metric_definitions set configuration=jsonb_set(configuration,'{goalEnabled}','false'::jsonb,true) where slug='weekly_deficit_balance';
update public.metric_definitions set configuration=jsonb_set(configuration,'{stepFallback}','true'::jsonb,true) where slug='exercise';
update public.metric_definitions set configuration=jsonb_set(configuration,'{goalEnabled}','false'::jsonb,true) where slug in ('blood_pressure_systolic','blood_pressure_diastolic','pulse','blood_glucose');
update public.metric_definitions set aggregation_method='average' where slug in ('body_fat','lean_body_mass','blood_pressure_systolic','blood_pressure_diastolic','pulse','blood_glucose');
