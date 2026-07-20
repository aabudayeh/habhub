with d(slug,name,icon,color,unit,goal_kind,goal_target,sort_order) as (values
('sugar','Sugar','cube-outline','#C47C47','g','at_most',50,21),('saturated_fat','Saturated fat','ellipse-outline','#A85D49','g','at_most',20,22),
('cholesterol','Cholesterol','heart-outline','#9B3F72','mg','at_most',300,23),('potassium','Potassium','leaf-outline','#5F8C57','mg','at_least',3500,24),
('calcium','Calcium','medical-outline','#71839B','mg','at_least',1000,25),('iron','Iron','fitness-outline','#8D5A45','mg','at_least',8,26),
('magnesium','Magnesium','sparkles-outline','#7462A8','mg','at_least',400,27),('vitamin_c','Vitamin C','sunny-outline','#E08A32','mg','at_least',90,28),
('vitamin_d','Vitamin D','sunny-outline','#D2A329','mcg','at_least',15,29),('vitamin_b12','Vitamin B12','medkit-outline','#B05C8C','mcg','at_least',2.4,30))
insert into public.metric_definitions(group_id,owner_user_id,slug,name,icon,color,unit,data_type,aggregation_method,ranking_direction,score_weight,default_visibility,configuration)
select g.id,null,d.slug,d.name,d.icon,d.color,d.unit,'number'::public.metric_data_type,'sum',case when d.goal_kind='at_most' then 'lower' else 'higher' end,0,'group'::public.entry_visibility,jsonb_build_object('goal',jsonb_build_object('kind',d.goal_kind,'target',d.goal_target),'sections',jsonb_build_object('today',false,'group',false,'insights',true),'order',d.sort_order,'activeFrom',current_date::text)
from public.groups g cross join d on conflict(group_id,owner_user_id,slug) do nothing;

update public.metric_definitions set configuration=jsonb_set(jsonb_set(configuration,'{sections,today}','true'::jsonb,true),'{sections,group}','true'::jsonb,true)
where slug='workout_duration';
