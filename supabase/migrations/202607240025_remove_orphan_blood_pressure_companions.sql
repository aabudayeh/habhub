-- Diastolic is an internal companion to the visible blood-pressure tracker.
-- Older clients could delete systolic while leaving this row behind.
delete from public.metric_definitions as diastolic
where diastolic.group_id is not null
  and diastolic.slug = 'blood_pressure_diastolic'
  and not exists (
    select 1
    from public.metric_definitions as systolic
    where systolic.group_id = diastolic.group_id
      and systolic.slug = 'blood_pressure_systolic'
  );

