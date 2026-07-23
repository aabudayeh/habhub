alter table public.daily_metric_status
  add column if not exists goal_progress numeric
  check (goal_progress between 0 and 200),
  add column if not exists goal_kind text
  check (goal_kind in ('at_least', 'at_most', 'exact', 'complete'));

comment on column public.daily_metric_status.goal_progress is
  'Percentage of the member personal target consumed/reached, capped at 200. Does not expose the private target value.';

comment on column public.daily_metric_status.goal_kind is
  'Personal goal comparison behavior, shared without the private target value.';
