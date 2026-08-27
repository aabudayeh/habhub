-- The compact Realtime cutover stopped the former high-CPU call storm, but
-- the old group/date status index retained substantial historical bloat. The
-- table is small, so a regular transactional rebuild is brief and avoids the
-- migration-runner incompatibility of REINDEX CONCURRENTLY.
alter index public.daily_metric_status_group_date_idx
  set (fillfactor = 80);

reindex index public.daily_metric_status_group_date_idx;

analyze public.daily_metric_status;
