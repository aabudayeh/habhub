-- Keep leaderboard exact values reliable without weakening entry privacy.
-- This field is written only when the member chose exact group visibility.
alter table public.daily_metric_status
  add column if not exists exact_value numeric;

comment on column public.daily_metric_status.exact_value is
  'Daily aggregate shared only when the owner selected exact group visibility.';
