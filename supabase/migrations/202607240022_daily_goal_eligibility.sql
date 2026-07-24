alter table public.daily_metric_status
  add column if not exists goal_eligible boolean not null default true;

comment on column public.daily_metric_status.goal_eligible is
  'Whether the member counted this tracker among their personal tracked goals on this date.';
