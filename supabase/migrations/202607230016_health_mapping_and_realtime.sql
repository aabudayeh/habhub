-- Repair older group tracker configurations so native health records map to
-- the intended tracker fields without requiring every member to edit them.
update public.metric_definitions
set configuration = jsonb_set(
  coalesce(configuration, '{}'::jsonb),
  '{healthMapping}',
  case slug
    when 'workout' then '{"dataType":"workouts","field":"value"}'::jsonb
    when 'workout_duration' then '{"dataType":"workouts","field":"duration_minutes"}'::jsonb
    when 'workout_calories' then '{"dataType":"workouts","field":"active_calories"}'::jsonb
    when 'workout_distance' then '{"dataType":"workouts","field":"distance_km"}'::jsonb
    when 'exercise' then '{"dataType":"active_energy","field":"value"}'::jsonb
    when 'blood_pressure_systolic' then '{"dataType":"blood_pressure","field":"systolic"}'::jsonb
    when 'blood_pressure_diastolic' then '{"dataType":"blood_pressure","field":"diastolic"}'::jsonb
  end,
  true
)
where slug in (
  'workout', 'workout_duration', 'workout_calories', 'workout_distance',
  'exercise', 'blood_pressure_systolic', 'blood_pressure_diastolic'
);

update public.metric_definitions
set name = 'Blood pressure'
where slug = 'blood_pressure_systolic';

update public.metric_definitions
set configuration = jsonb_set(
  coalesce(configuration, '{}'::jsonb),
  '{sections}',
  '{"today":false,"group":false,"insights":false}'::jsonb,
  true
)
where slug = 'blood_pressure_diastolic';

update public.metric_definitions
set configuration = jsonb_set(
  coalesce(configuration, '{}'::jsonb),
  '{stepFallback}',
  'true'::jsonb,
  true
)
where slug = 'exercise';

-- These are the tables observed by the live workspace and membership channels.
do $$ begin
  alter publication supabase_realtime add table public.group_members;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.metric_entries;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.metric_definitions;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.photo_updates;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.daily_metric_status;
exception when duplicate_object then null; end $$;
