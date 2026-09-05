-- Web Push endpoints are client-supplied URLs that an Edge worker later POSTs
-- to with a notification payload. Keep only the browser push providers HabHub
-- supports so a registered endpoint cannot turn that worker into an SSRF
-- primitive. Host matching is label-bounded to reject deceptive suffixes.
delete from public.web_push_subscriptions subscription
where subscription.endpoint !~* (
  '^https://(?:' ||
  'fcm\.googleapis\.com|' ||
  'updates\.push\.services\.mozilla\.com|' ||
  '(?:[a-z0-9-]+\.)+push\.apple\.com|' ||
  '(?:[a-z0-9-]+\.)*notify\.windows\.com' ||
  ')(?::443)?/[^[:space:]#]*$'
);

alter table public.web_push_subscriptions
  drop constraint if exists web_push_subscriptions_trusted_endpoint_check;
alter table public.web_push_subscriptions
  add constraint web_push_subscriptions_trusted_endpoint_check
  check (
    endpoint ~* (
      '^https://(?:' ||
      'fcm\.googleapis\.com|' ||
      'updates\.push\.services\.mozilla\.com|' ||
      '(?:[a-z0-9-]+\.)+push\.apple\.com|' ||
      '(?:[a-z0-9-]+\.)*notify\.windows\.com' ||
      ')(?::443)?/[^[:space:]#]*$'
    )
  ) not valid;

alter table public.web_push_subscriptions
  validate constraint web_push_subscriptions_trusted_endpoint_check;

-- A schedule acceptance belongs to one exact subscription generation. A
-- refreshed/reassigned endpoint must be eligible again rather than inheriting
-- an earlier delivery checkpoint.
alter table public.web_personal_notification_acceptances
  add column if not exists registration_updated_at timestamptz;

delete from public.web_personal_notification_acceptances acceptance
where not exists (
  select 1
  from public.web_push_subscriptions subscription
  where subscription.endpoint = acceptance.endpoint
    and subscription.user_id = acceptance.user_id
);

update public.web_personal_notification_acceptances acceptance
set registration_updated_at = subscription.updated_at
from public.web_push_subscriptions subscription
where subscription.endpoint = acceptance.endpoint
  and subscription.user_id = acceptance.user_id
  and acceptance.registration_updated_at is null;

delete from public.web_personal_notification_acceptances
where registration_updated_at is null;

alter table public.web_personal_notification_acceptances
  alter column registration_updated_at set not null;

create index if not exists web_personal_acceptances_registration_idx
  on public.web_personal_notification_acceptances (
    user_id,
    endpoint,
    registration_updated_at
  );

-- Remove only the Web Push registration generation that produced a terminal
-- response. A concurrent refresh, key rotation, or account reassignment is
-- reported to the worker so it retries the reminder against the new row.
create or replace function public.delete_exact_stale_web_push_subscriptions(
  p_registrations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := coalesce(p_registrations, '[]'::jsonb);
  v_item jsonb;
  v_user_id uuid;
  v_endpoint text;
  v_p256dh text;
  v_auth text;
  v_updated_at timestamptz;
  v_deleted integer := 0;
  v_deleted_total integer := 0;
  v_changed integer := 0;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if jsonb_typeof(v_payload) <> 'array'
     or jsonb_array_length(v_payload) not between 1 and 100
     or pg_catalog.pg_column_size(v_payload) > 524288 then
    raise exception 'Invalid stale Web Push registration batch.'
      using errcode = '22023';
  end if;

  for v_item in select item.value from jsonb_array_elements(v_payload) item
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Every stale Web Push registration must be an object.'
        using errcode = '22023';
    end if;
    begin
      v_user_id := (v_item ->> 'userId')::uuid;
      v_updated_at := (v_item ->> 'updatedAt')::timestamptz;
    exception when others then
      raise exception 'Stale Web Push registration identity is invalid.'
        using errcode = '22023';
    end;
    v_endpoint := nullif(btrim(v_item ->> 'endpoint'), '');
    v_p256dh := nullif(btrim(v_item ->> 'p256dh'), '');
    v_auth := nullif(btrim(v_item ->> 'auth'), '');
    if v_user_id is null
       or v_updated_at is null
       or v_endpoint is null
       or char_length(v_endpoint) not between 12 and 4096
       or v_p256dh is null
       or char_length(v_p256dh) not between 40 and 200
       or v_p256dh !~ '^[A-Za-z0-9_-]+$'
       or v_auth is null
       or char_length(v_auth) not between 8 and 100
       or v_auth !~ '^[A-Za-z0-9_-]+$' then
      raise exception 'Stale Web Push registration identity is invalid.'
        using errcode = '22023';
    end if;

    delete from public.web_push_subscriptions subscription
     where subscription.endpoint = v_endpoint
       and subscription.user_id = v_user_id
       and subscription.updated_at = v_updated_at
       and subscription.p256dh = v_p256dh
       and subscription.auth = v_auth;
    get diagnostics v_deleted = row_count;
    v_deleted_total := v_deleted_total + v_deleted;
    if v_deleted = 0 and exists (
      select 1
      from public.web_push_subscriptions subscription
      where subscription.endpoint = v_endpoint
    ) then
      v_changed := v_changed + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'webSubscriptions', v_deleted_total,
    'changedRegistrations', v_changed
  );
end;
$$;

revoke all on function public.delete_exact_stale_web_push_subscriptions(jsonb)
  from public, anon, authenticated;
grant execute on function public.delete_exact_stale_web_push_subscriptions(jsonb)
  to service_role;

notify pgrst, 'reload schema';
