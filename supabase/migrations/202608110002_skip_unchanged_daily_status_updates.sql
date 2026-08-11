-- Repeated compact leaderboard publications may submit a bounded recent
-- window even when most rows have not changed. The generic touch trigger made
-- every conflict update create a new tuple, timestamp, and Realtime event.
-- Cancel exact no-op updates while retaining normal behavior for any real
-- value, visibility, source, or revision change (including future columns).
create or replace function public.touch_daily_metric_status_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'updated_at')
       is not distinct from
     (to_jsonb(old) - 'updated_at') then
    return null;
  end if;

  new.updated_at = statement_timestamp();
  return new;
end;
$$;

drop trigger if exists daily_metric_status_touch_updated_at
  on public.daily_metric_status;
create trigger daily_metric_status_touch_updated_at
before update on public.daily_metric_status
for each row execute function public.touch_daily_metric_status_updated_at();

revoke all on function public.touch_daily_metric_status_updated_at()
  from public, anon, authenticated;
