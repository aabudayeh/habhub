-- An UPSERT from a legacy client updates only its submitted columns. Without
-- these ordered triggers, an existing row's v2 marker could survive such an
-- update and cause the privacy trigger to trust an old mixed-visibility exact
-- value. Reset every UPDATE to v1, then restore v2 only when this statement
-- explicitly includes privacy_projection_version in its SET list.

create or replace function public.reset_daily_metric_projection_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.privacy_projection_version := 1;
  return new;
end;
$$;

create or replace function public.accept_explicit_daily_metric_projection_v2()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- UPDATE OF fires because the column was explicitly submitted, even though
  -- the alphabetically earlier reset trigger has already changed NEW.
  new.privacy_projection_version := 2;
  return new;
end;
$$;

drop trigger if exists daily_metric_status_a_reset_projection_version
  on public.daily_metric_status;
create trigger daily_metric_status_a_reset_projection_version
before update on public.daily_metric_status
for each row execute function public.reset_daily_metric_projection_version();

drop trigger if exists daily_metric_status_b_accept_explicit_projection_v2
  on public.daily_metric_status;
create trigger daily_metric_status_b_accept_explicit_projection_v2
before update of privacy_projection_version on public.daily_metric_status
for each row execute function public.accept_explicit_daily_metric_projection_v2();

revoke all on function public.reset_daily_metric_projection_version()
  from public, anon, authenticated;
revoke all on function public.accept_explicit_daily_metric_projection_v2()
  from public, anon, authenticated;

comment on function public.reset_daily_metric_projection_version() is
  'Prevents an omitted legacy projection marker from inheriting a stored v2 trust decision.';
comment on function public.accept_explicit_daily_metric_projection_v2() is
  'Restores v2 only for an UPDATE statement that explicitly submits the projection marker.';
