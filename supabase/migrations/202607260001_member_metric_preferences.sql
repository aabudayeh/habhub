alter table public.daily_metric_status
  add column if not exists goal_target numeric,
  add column if not exists visibility text
    check (visibility in ('group', 'status', 'private'));

comment on column public.daily_metric_status.goal_target is
  'Member-specific target used for authorized group progress displays.';
comment on column public.daily_metric_status.visibility is
  'Member-specific sharing preference at the time the status was written.';

-- Existing row-level security remains authoritative: members can read status
-- rows only for groups they belong to, and can write only their own rows.
