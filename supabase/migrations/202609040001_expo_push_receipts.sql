-- Expo push tickets prove only gateway acceptance. Persist every successful
-- ticket together with its event/token identity, then poll Expo's provider
-- receipts after the documented 15-minute delay. All queue state is private to
-- service-role workers because push tokens and delivery diagnostics are not
-- client-readable application data.

-- Legacy acceptance rows identified only the transport token. That is not an
-- account-safe identity because native tokens and browser endpoints can move
-- between accounts. Resolve rows that still have one current registration
-- owner whose current version is no newer than the checkpoint. Discard
-- orphaned, ambiguous, or post-checkpoint registrations, then make the owner
-- part of the durable key used by every writer and reader.
alter table public.push_token_dispatch_acceptances
  add column if not exists user_id uuid;

with registration_owners as (
  select token.token as registration_key, token.user_id, token.updated_at
  from public.device_push_tokens token
  union all
  select subscription.endpoint as registration_key,
    subscription.user_id,
    subscription.updated_at
  from public.web_push_subscriptions subscription
), unambiguous_owners as (
  select owner.registration_key,
    max(owner.user_id::text)::uuid as user_id,
    max(owner.updated_at) as updated_at
  from registration_owners owner
  group by owner.registration_key
  having count(distinct owner.user_id) = 1
)
update public.push_token_dispatch_acceptances acceptance
set user_id = owner.user_id
from unambiguous_owners owner
where acceptance.user_id is null
  and owner.registration_key = acceptance.token
  and owner.updated_at <= acceptance.accepted_at;

delete from public.push_token_dispatch_acceptances acceptance
where acceptance.user_id is null;

alter table public.push_token_dispatch_acceptances
  alter column user_id set not null;
alter table public.push_token_dispatch_acceptances
  drop constraint if exists push_token_dispatch_acceptances_user_id_fkey;
alter table public.push_token_dispatch_acceptances
  add constraint push_token_dispatch_acceptances_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;
alter table public.push_token_dispatch_acceptances
  drop constraint if exists push_token_dispatch_acceptances_pkey;
alter table public.push_token_dispatch_acceptances
  add constraint push_token_dispatch_acceptances_pkey
  primary key (event_key, user_id, token);
create index if not exists push_token_dispatch_acceptances_user_retention_idx
  on public.push_token_dispatch_acceptances (user_id, accepted_at);

-- Chat originally used the committed messages row as its canonical source but
-- did not materialize the final audience/copy in the durable push outbox. A
-- provider receipt can arrive long after the authenticated sender request, so
-- a service worker needs the same immutable, server-derived event to resend.
alter table public.push_dispatch_events
  drop constraint if exists push_dispatch_events_category_check;
alter table public.push_dispatch_events
  add constraint push_dispatch_events_category_check check (
    category in ('chat', 'metric', 'lead', 'winner', 'membership', 'challenge')
  );

create table if not exists public.expo_push_receipts (
  ticket_id text primary key
    check (char_length(ticket_id) between 1 and 200 and ticket_id !~ '[[:space:]]'),
  event_key text not null check (char_length(event_key) between 1 and 240),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null
    check (char_length(token) between 1 and 512 and token !~ '[[:space:]]'),
  registration_updated_at timestamptz not null,
  accepted_at timestamptz not null,
  next_attempt_at timestamptz not null,
  expires_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count between 0 and 100),
  action_attempt_count integer not null default 0
    check (action_attempt_count between 0 and 100),
  delivery_action text not null default 'poll'
    check (delivery_action in ('poll', 'resend')),
  lease_owner uuid,
  lease_until timestamptz,
  receipt_status text not null default 'pending'
    check (
      receipt_status in (
        'pending',
        'provider_accepted',
        'resend_complete',
        'terminal_error',
        'expired'
      )
    ),
  terminal_at timestamptz,
  last_error_code text check (
    last_error_code is null or char_length(last_error_code) between 1 and 120
  ),
  last_error_message text check (
    last_error_message is null or char_length(last_error_message) between 1 and 500
  ),
  updated_at timestamptz not null default clock_timestamp(),
  constraint expo_push_receipts_attempt_window
    check (next_attempt_at >= accepted_at),
  constraint expo_push_receipts_expiry_window
    check (expires_at > accepted_at),
  constraint expo_push_receipts_terminal_state check (
    (receipt_status = 'pending' and terminal_at is null)
    or (receipt_status <> 'pending' and terminal_at is not null)
  )
);

create index if not exists expo_push_receipts_due_idx
  on public.expo_push_receipts (next_attempt_at, accepted_at, ticket_id)
  where receipt_status = 'pending';
create index if not exists expo_push_receipts_terminal_retention_idx
  on public.expo_push_receipts (terminal_at)
  where receipt_status <> 'pending';
create index if not exists expo_push_receipts_pending_resend_event_idx
  on public.expo_push_receipts (event_key, next_attempt_at, ticket_id)
  where receipt_status = 'pending' and delivery_action = 'resend';

alter table public.expo_push_receipts enable row level security;
revoke all on table public.expo_push_receipts
  from public, anon, authenticated;
grant select, insert, update, delete on table public.expo_push_receipts
  to service_role;

-- A provider's stale response describes the registration version observed
-- before the network request. Delete only that exact version: a concurrent
-- refresh, key rotation, or account reassignment must survive the late result.
-- Checkpoint the stale target only when that exact row was deleted, in the
-- same transaction, so an RPC failure remains retryable and a newer version
-- can still receive the event.
create or replace function public.delete_exact_stale_push_registrations(
  p_event_key text,
  p_registrations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_key text := nullif(btrim(coalesce(p_event_key, '')), '');
  v_payload jsonb := coalesce(p_registrations, '[]'::jsonb);
  v_item jsonb;
  v_kind text;
  v_user_id uuid;
  v_updated_at timestamptz;
  v_token text;
  v_endpoint text;
  v_p256dh text;
  v_auth text;
  v_deleted integer := 0;
  v_device_deleted integer := 0;
  v_web_deleted integer := 0;
  v_changed integer := 0;
begin
  if v_event_key is null or char_length(v_event_key) > 240 then
    raise exception 'Invalid stale push event key.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_payload) <> 'array'
     or jsonb_array_length(v_payload) not between 1 and 100
     or pg_catalog.pg_column_size(v_payload) > 524288 then
    raise exception 'Invalid stale push registration batch.'
      using errcode = '22023';
  end if;

  for v_item in select item.value from jsonb_array_elements(v_payload) item
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Every stale push registration must be an object.'
        using errcode = '22023';
    end if;
    v_kind := nullif(btrim(v_item ->> 'kind'), '');
    begin
      v_user_id := (v_item ->> 'userId')::uuid;
      v_updated_at := (v_item ->> 'updatedAt')::timestamptz;
    exception when others then
      raise exception 'Stale push registration identity is invalid.'
        using errcode = '22023';
    end;
    if v_user_id is null or v_updated_at is null then
      raise exception 'Stale push registration identity is invalid.'
        using errcode = '22023';
    end if;

    if v_kind = 'expo' then
      v_token := nullif(btrim(v_item ->> 'token'), '');
      if v_token is null
         or char_length(v_token) > 512
         or v_token ~ '[[:space:]]' then
        raise exception 'Stale Expo registration identity is invalid.'
          using errcode = '22023';
      end if;
      delete from public.device_push_tokens token
       where token.token = v_token
         and token.user_id = v_user_id
         and token.updated_at = v_updated_at;
      get diagnostics v_deleted = row_count;
      v_device_deleted := v_device_deleted + v_deleted;
      if v_deleted = 1 then
        insert into public.push_token_dispatch_acceptances (
          event_key, user_id, token, accepted_at
        ) values (
          v_event_key, v_user_id, v_token, clock_timestamp()
        )
        on conflict (event_key, user_id, token) do nothing;
      elsif exists (
        select 1
        from public.device_push_tokens token
        where token.token = v_token
      ) then
        v_changed := v_changed + 1;
      end if;
    elsif v_kind = 'web' then
      v_endpoint := nullif(btrim(v_item ->> 'endpoint'), '');
      v_p256dh := nullif(btrim(v_item ->> 'p256dh'), '');
      v_auth := nullif(btrim(v_item ->> 'auth'), '');
      if v_endpoint is null
         or char_length(v_endpoint) not between 12 and 4096
         or v_endpoint !~ '^https://[^[:space:]]+$'
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
      v_web_deleted := v_web_deleted + v_deleted;
      if v_deleted = 1 then
        insert into public.push_token_dispatch_acceptances (
          event_key, user_id, token, accepted_at
        ) values (
          v_event_key, v_user_id, v_endpoint, clock_timestamp()
        )
        on conflict (event_key, user_id, token) do nothing;
      elsif exists (
        select 1
        from public.web_push_subscriptions subscription
        where subscription.endpoint = v_endpoint
      ) then
        v_changed := v_changed + 1;
      end if;
    else
      raise exception 'Stale push registration kind is invalid.'
        using errcode = '22023';
    end if;
  end loop;

  return jsonb_build_object(
    'deviceTokens', v_device_deleted,
    'webSubscriptions', v_web_deleted,
    'changedRegistrations', v_changed
  );
end;
$$;

revoke all on function public.delete_exact_stale_push_registrations(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.delete_exact_stale_push_registrations(text, jsonb)
  to service_role;

-- One RPC makes an Expo ticket and the existing per-token dispatch acceptance
-- a single PostgreSQL commit. A database error cannot leave a receipt queued
-- without also preserving the deduplication checkpoint (or vice versa).
create or replace function public.record_expo_push_ticket_acceptances(
  p_event_key text,
  p_tickets jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_key text := nullif(btrim(coalesce(p_event_key, '')), '');
  v_payload jsonb := coalesce(p_tickets, '[]'::jsonb);
  v_item jsonb;
  v_ticket_id text;
  v_user_id uuid;
  v_token text;
  v_registration_updated_at timestamptz;
  v_ticket_ids text[] := array[]::text[];
  v_tokens text[] := array[]::text[];
  v_now timestamptz := clock_timestamp();
  v_count integer := 0;
  v_inserted integer := 0;
begin
  if v_event_key is null or char_length(v_event_key) > 240 then
    raise exception 'Invalid Expo push event key.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_payload) <> 'array'
     or jsonb_array_length(v_payload) not between 1 and 100
     or pg_catalog.pg_column_size(v_payload) > 131072 then
    raise exception 'Invalid Expo push ticket batch.' using errcode = '22023';
  end if;

  for v_item in select item.value from jsonb_array_elements(v_payload) item
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Every Expo push ticket must be an object.'
        using errcode = '22023';
    end if;
    v_ticket_id := nullif(btrim(v_item ->> 'ticketId'), '');
    v_token := nullif(btrim(v_item ->> 'token'), '');
    begin
      v_user_id := (v_item ->> 'userId')::uuid;
      v_registration_updated_at := (v_item ->> 'updatedAt')::timestamptz;
    exception when others then
      raise exception 'Expo push ticket registration identity is invalid.'
        using errcode = '22023';
    end;
    if v_ticket_id is null
       or char_length(v_ticket_id) > 200
       or v_ticket_id ~ '[[:space:]]'
       or v_ticket_id = any(v_ticket_ids)
       or v_token is null
       or char_length(v_token) > 512
       or v_token ~ '[[:space:]]'
       or v_token = any(v_tokens)
       or v_user_id is null
       or v_registration_updated_at is null then
      raise exception 'Expo push ticket identity is invalid or duplicated.'
        using errcode = '22023';
    end if;
    v_ticket_ids := array_append(v_ticket_ids, v_ticket_id);
    v_tokens := array_append(v_tokens, v_token);

    insert into public.expo_push_receipts (
      ticket_id,
      event_key,
      user_id,
      token,
      registration_updated_at,
      accepted_at,
      next_attempt_at,
      expires_at,
      updated_at
    ) values (
      v_ticket_id,
      v_event_key,
      v_user_id,
      v_token,
      v_registration_updated_at,
      v_now,
      v_now + interval '15 minutes',
      v_now + interval '24 hours',
      v_now
    )
    on conflict (ticket_id) do nothing;
    get diagnostics v_inserted = row_count;

    if not exists (
      select 1
        from public.expo_push_receipts receipt
       where receipt.ticket_id = v_ticket_id
         and receipt.event_key = v_event_key
         and receipt.user_id = v_user_id
         and receipt.token = v_token
         and receipt.registration_updated_at = v_registration_updated_at
    ) then
      raise exception 'Expo push ticket identity collision.' using errcode = '23505';
    end if;

    if v_inserted = 1 then
      insert into public.push_token_dispatch_acceptances (
        event_key,
        user_id,
        token,
        accepted_at
      ) values (
        v_event_key,
        v_user_id,
        v_token,
        v_now
      )
      on conflict (event_key, user_id, token) do update
        set accepted_at = greatest(
          public.push_token_dispatch_acceptances.accepted_at,
          excluded.accepted_at
        );
    else
      -- An ambiguous network retry with the same Expo ticket is idempotent: it
      -- must not make that ticket look superseded by advancing its checkpoint.
      insert into public.push_token_dispatch_acceptances (
        event_key,
        user_id,
        token,
        accepted_at
      ) values (
        v_event_key,
        v_user_id,
        v_token,
        (
          select receipt.accepted_at
          from public.expo_push_receipts receipt
          where receipt.ticket_id = v_ticket_id
        )
      )
      on conflict (event_key, user_id, token) do nothing;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.record_expo_push_ticket_acceptances(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_expo_push_ticket_acceptances(text, jsonb)
  to service_role;

drop function if exists public.claim_due_expo_push_receipts(integer, uuid);
create function public.claim_due_expo_push_receipts(
  p_limit integer,
  p_lease_owner uuid
)
returns table (
  ticket_id text,
  event_key text,
  delivery_action text,
  attempt_count integer,
  action_attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lease_owner is null then
    raise exception 'Expo receipt lease owner is required.' using errcode = '22023';
  end if;

  -- A resend expiry must close its per-target hole before the ordinary outbox
  -- drain sees the reopened event. This is a suppression checkpoint, not a
  -- delivery claim; a newer checkpoint wins via DO NOTHING.
  insert into public.push_token_dispatch_acceptances (
    event_key, user_id, token, accepted_at
  )
  select receipt.event_key,
    receipt.user_id,
    receipt.token,
    clock_timestamp()
    from public.expo_push_receipts receipt
   where receipt.receipt_status = 'pending'
     and receipt.delivery_action = 'resend'
     and (
       receipt.expires_at <= clock_timestamp()
       or receipt.attempt_count >= 100
       or receipt.action_attempt_count >= 100
     )
  on conflict on constraint push_token_dispatch_acceptances_pkey do nothing;

  update public.expo_push_receipts receipt
     set receipt_status = 'expired',
         terminal_at = clock_timestamp(),
         lease_owner = null,
         lease_until = null,
         last_error_code = 'ReceiptExpired',
         last_error_message = case
           when receipt.delivery_action = 'resend' then
             'The canonical resend did not complete before its bounded expiry.'
           else
             'Expo receipt was unavailable before its bounded expiry.'
         end,
         updated_at = clock_timestamp()
   where receipt.receipt_status = 'pending'
     and (
       receipt.expires_at <= clock_timestamp()
       or receipt.attempt_count >= 100
       or receipt.action_attempt_count >= 100
     );

  return query
  with selected as (
    select receipt.ticket_id
      from public.expo_push_receipts receipt
     where receipt.receipt_status = 'pending'
       and receipt.next_attempt_at <= clock_timestamp()
       and receipt.expires_at > clock_timestamp()
       and receipt.attempt_count < 100
       and receipt.action_attempt_count < 100
       and (receipt.lease_until is null or receipt.lease_until < clock_timestamp())
     order by receipt.next_attempt_at, receipt.accepted_at, receipt.ticket_id
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 500), 1000))
  ), claimed as (
    update public.expo_push_receipts receipt
       set lease_owner = p_lease_owner,
           lease_until = clock_timestamp() + interval '3 minutes',
           attempt_count = receipt.attempt_count + 1,
           action_attempt_count = receipt.action_attempt_count + 1,
           updated_at = clock_timestamp()
      from selected
     where receipt.ticket_id = selected.ticket_id
    returning receipt.ticket_id,
      receipt.event_key,
      receipt.delivery_action,
      receipt.attempt_count,
      receipt.action_attempt_count
  )
  select claimed.ticket_id,
    claimed.event_key,
    claimed.delivery_action,
    claimed.attempt_count,
    claimed.action_attempt_count
    from claimed;
end;
$$;

revoke all on function public.claim_due_expo_push_receipts(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_due_expo_push_receipts(integer, uuid)
  to service_role;

-- Settle every row owned by one worker lease in one transaction. A rate-limit
-- receipt is immutable, so polling it again can never succeed: instead, move
-- the row into a durable resend action, remove only its still-current
-- owner-scoped acceptance checkpoint, and reopen the committed canonical
-- outbox. A newer ticket acceptance, registration refresh/reassignment, or
-- missing canonical event suppresses the old retry without disturbing newer
-- state. Terminal DeviceNotRegistered cleanup uses the same exact-version
-- fence.
create or replace function public.settle_expo_push_receipts(
  p_lease_owner uuid,
  p_outcomes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb := coalesce(p_outcomes, '[]'::jsonb);
  v_outcome jsonb;
  v_ticket_id text;
  v_status text;
  v_error_code text;
  v_error_message text;
  v_ticket_ids text[] := array[]::text[];
  v_receipt public.expo_push_receipts%rowtype;
  v_now timestamptz := clock_timestamp();
  v_settled integer := 0;
  v_retried integer := 0;
  v_invalidated integer := 0;
  v_deleted integer := 0;
  v_resend_queued integer := 0;
  v_resend_completed integer := 0;
  v_acceptance_at timestamptz;
  v_acceptance_current boolean;
  v_registration_current boolean;
  v_outbox_found boolean;
  v_outbox_id uuid;
  v_outbox_category text;
  v_outbox_group_id uuid;
  v_outbox_dispatcher_id uuid;
  v_outbox_message_id text;
begin
  if p_lease_owner is null then
    raise exception 'Expo receipt lease owner is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_payload) <> 'array'
     or jsonb_array_length(v_payload) not between 1 and 1000
     or pg_catalog.pg_column_size(v_payload) > 1048576 then
    raise exception 'Invalid Expo receipt outcome batch.' using errcode = '22023';
  end if;

  for v_outcome in select item.value from jsonb_array_elements(v_payload) item
  loop
    if jsonb_typeof(v_outcome) <> 'object' then
      raise exception 'Every Expo receipt outcome must be an object.'
        using errcode = '22023';
    end if;
    v_ticket_id := nullif(btrim(v_outcome ->> 'ticketId'), '');
    v_status := nullif(btrim(v_outcome ->> 'status'), '');
    v_error_code := nullif(left(btrim(v_outcome ->> 'errorCode'), 120), '');
    v_error_message := nullif(left(btrim(v_outcome ->> 'errorMessage'), 500), '');
    if v_ticket_id is null
       or char_length(v_ticket_id) > 200
       or v_ticket_id ~ '[[:space:]]'
       or v_ticket_id = any(v_ticket_ids)
       or v_status not in (
         'retry',
         'provider_accepted',
         'terminal_error',
         'resend',
         'resend_complete'
       ) then
      raise exception 'Expo receipt outcome is invalid or duplicated.'
        using errcode = '22023';
    end if;
    v_ticket_ids := array_append(v_ticket_ids, v_ticket_id);

    select receipt.* into v_receipt
      from public.expo_push_receipts receipt
     where receipt.ticket_id = v_ticket_id
       and receipt.receipt_status = 'pending'
       and receipt.lease_owner = p_lease_owner
     for update;
    if not found then
      raise exception 'Expo receipt lease no longer owns every outcome.'
        using errcode = 'P0001';
    end if;
    if v_status = 'resend'
       and (
         v_receipt.delivery_action <> 'poll'
         or v_error_code <> 'MessageRateExceeded'
       ) then
      raise exception 'Only a MessageRateExceeded receipt can enter resend.'
        using errcode = '22023';
    end if;
    if v_status = 'resend_complete'
       and v_receipt.delivery_action <> 'resend' then
      raise exception 'Only a durable resend action can be completed.'
        using errcode = '22023';
    end if;

    if v_status = 'retry'
       and v_receipt.expires_at > v_now
       and v_receipt.attempt_count < 100
       and v_receipt.action_attempt_count < 100 then
      update public.expo_push_receipts receipt
         set next_attempt_at = least(
               v_receipt.expires_at,
               v_now + pg_catalog.make_interval(
                 secs => least(
                   3600,
                   (
                     300 * power(
                       2,
                       greatest(
                         0,
                         least(4, v_receipt.action_attempt_count - 1)
                       )
                     )
                   )::integer
                 )
               )
             ),
             lease_owner = null,
             lease_until = null,
             last_error_code = case
               when v_receipt.delivery_action = 'resend'
                 then coalesce(v_receipt.last_error_code, 'MessageRateExceeded')
               else coalesce(v_error_code, 'ReceiptNotReady')
             end,
             last_error_message = coalesce(
               v_error_message,
               'Expo has not published this provider receipt yet.'
             ),
             updated_at = v_now
       where receipt.ticket_id = v_ticket_id;
      v_retried := v_retried + 1;
    elsif v_status = 'resend' then
      -- Lock the exact checkpoint first. record_expo_push_ticket_acceptances
      -- advances accepted_at for a newer ticket, so equality to this receipt's
      -- accepted_at is the durable supersession fence.
      v_acceptance_at := null;
      select acceptance.accepted_at into v_acceptance_at
        from public.push_token_dispatch_acceptances acceptance
       where acceptance.event_key = v_receipt.event_key
         and acceptance.user_id = v_receipt.user_id
         and acceptance.token = v_receipt.token
       for update;
      v_acceptance_current := found
        and v_acceptance_at = v_receipt.accepted_at;

      v_registration_current := false;
      if v_acceptance_current then
        select true into v_registration_current
          from public.device_push_tokens token
         where token.token = v_receipt.token
           and token.user_id = v_receipt.user_id
           and token.updated_at = v_receipt.registration_updated_at
         for update;
        v_registration_current := found;
      end if;

      v_outbox_found := false;
      v_outbox_id := null;
      v_outbox_category := null;
      v_outbox_group_id := null;
      v_outbox_dispatcher_id := null;
      v_outbox_message_id := null;
      if v_acceptance_current and v_registration_current then
        select event.id,
          event.category,
          event.group_id,
          event.dispatcher_id,
          nullif(event.data ->> 'messageId', '')
          into v_outbox_id,
            v_outbox_category,
            v_outbox_group_id,
            v_outbox_dispatcher_id,
            v_outbox_message_id
          from public.push_dispatch_events event
         where event.event_key = v_receipt.event_key
         for update;
        v_outbox_found := found;
      end if;

      if v_acceptance_current
         and v_registration_current
         and v_outbox_found then
        delete from public.push_token_dispatch_acceptances acceptance
         where acceptance.event_key = v_receipt.event_key
           and acceptance.user_id = v_receipt.user_id
           and acceptance.token = v_receipt.token
           and acceptance.accepted_at = v_receipt.accepted_at;
        get diagnostics v_deleted = row_count;
        if v_deleted <> 1 then
          raise exception 'Expo resend acceptance changed while locked.'
            using errcode = 'P0001';
        end if;

        update public.push_dispatch_events event
           set dispatched_at = null,
               last_error = 'receipt_rate_limited'
         where event.id = v_outbox_id;
        delete from public.push_events claim
         where claim.event_key = v_receipt.event_key;
        if v_outbox_category = 'chat'
           and v_outbox_message_id is not null then
          update public.messages message
             set push_dispatched_at = null
           where message.group_id = v_outbox_group_id
             and message.sender_id = v_outbox_dispatcher_id
             and message.client_generated_id = v_outbox_message_id;
        end if;

        update public.expo_push_receipts receipt
           set delivery_action = 'resend',
               action_attempt_count = 0,
               next_attempt_at = v_now + interval '5 minutes',
               expires_at = least(
                 v_receipt.accepted_at + interval '48 hours',
                 greatest(v_receipt.expires_at, v_now + interval '1 hour')
               ),
               lease_owner = null,
               lease_until = null,
               last_error_code = 'MessageRateExceeded',
               last_error_message = coalesce(
                 v_error_message,
                 'Expo rate-limited provider delivery; canonical resend is queued.'
               ),
               updated_at = v_now
         where receipt.ticket_id = v_ticket_id;
        v_resend_queued := v_resend_queued + 1;
      else
        -- A newer acceptance already covers this owner/token, or the exact
        -- registration/canonical event no longer exists. Suppress the old
        -- receipt rather than replaying an event to a changed destination.
        update public.expo_push_receipts receipt
           set receipt_status = 'resend_complete',
               terminal_at = v_now,
               lease_owner = null,
               lease_until = null,
               last_error_code = 'MessageRateExceeded',
               last_error_message = case
                 when not v_acceptance_current then
                   'Canonical resend suppressed because a newer acceptance superseded this ticket.'
                 when not v_registration_current then
                   'Canonical resend suppressed because the selected registration changed.'
                 else
                   'Canonical resend suppressed because its durable outbox event is unavailable.'
               end,
               updated_at = v_now
         where receipt.ticket_id = v_ticket_id;
        v_settled := v_settled + 1;
        v_resend_completed := v_resend_completed + 1;
      end if;
    elsif v_status = 'resend_complete' then
      update public.expo_push_receipts receipt
         set receipt_status = 'resend_complete',
             terminal_at = v_now,
             lease_owner = null,
             lease_until = null,
             last_error_code = coalesce(
               v_receipt.last_error_code,
               'MessageRateExceeded'
             ),
             last_error_message = coalesce(
               v_receipt.last_error_message,
               v_error_message,
               'The canonical event resend was accepted or safely suppressed.'
             ),
             updated_at = v_now
       where receipt.ticket_id = v_ticket_id;
      v_settled := v_settled + 1;
      v_resend_completed := v_resend_completed + 1;
    elsif v_status = 'provider_accepted' then
      update public.expo_push_receipts receipt
         set receipt_status = 'provider_accepted',
             terminal_at = v_now,
             lease_owner = null,
             lease_until = null,
             last_error_code = null,
             last_error_message = null,
             updated_at = v_now
       where receipt.ticket_id = v_ticket_id;
      v_settled := v_settled + 1;
    elsif v_status = 'terminal_error' then
      v_error_code := coalesce(v_error_code, 'UnknownExpoReceiptError');
      update public.expo_push_receipts receipt
         set receipt_status = 'terminal_error',
             terminal_at = v_now,
             lease_owner = null,
             lease_until = null,
             last_error_code = v_error_code,
             last_error_message = coalesce(
               v_error_message,
               'Expo reported a terminal provider delivery error.'
             ),
             updated_at = v_now
       where receipt.ticket_id = v_ticket_id;
      if v_error_code = 'DeviceNotRegistered' then
        delete from public.device_push_tokens token
         where token.token = v_receipt.token
           and token.user_id = v_receipt.user_id
           and token.updated_at = v_receipt.registration_updated_at;
        get diagnostics v_deleted = row_count;
        v_invalidated := v_invalidated + v_deleted;
      end if;
      v_settled := v_settled + 1;
    else
      if v_receipt.delivery_action = 'resend' then
        insert into public.push_token_dispatch_acceptances (
          event_key, user_id, token, accepted_at
        ) values (
          v_receipt.event_key,
          v_receipt.user_id,
          v_receipt.token,
          v_now
        )
        on conflict (event_key, user_id, token) do nothing;
      end if;
      update public.expo_push_receipts receipt
         set receipt_status = 'expired',
             terminal_at = v_now,
             lease_owner = null,
             lease_until = null,
             last_error_code = 'ReceiptExpired',
             last_error_message = case
               when v_receipt.delivery_action = 'resend' then
                 'The canonical resend did not complete before its bounded expiry.'
               else
                 'Expo receipt was unavailable before its bounded expiry.'
             end,
             updated_at = v_now
       where receipt.ticket_id = v_ticket_id;
      v_settled := v_settled + 1;
    end if;
  end loop;

  if exists (
    select 1
      from public.expo_push_receipts receipt
     where receipt.receipt_status = 'pending'
       and receipt.lease_owner = p_lease_owner
  ) then
    raise exception 'Expo receipt outcomes did not cover the complete lease.'
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'settled', v_settled,
    'retried', v_retried,
    'invalidatedTokens', v_invalidated,
    'resendQueued', v_resend_queued,
    'resendCompleted', v_resend_completed
  );
end;
$$;

revoke all on function public.settle_expo_push_receipts(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.settle_expo_push_receipts(uuid, jsonb)
  to service_role;

-- Reuse the already-deployed personal-notification worker secret and derive
-- the sibling function URL from its validated canonical Supabase URL. No new
-- secret or manually duplicated project URL is introduced.
create or replace function public.invoke_expo_push_receipt_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_web_worker_url text;
  v_receipt_worker_url text;
  v_secret text;
begin
  delete from public.push_token_dispatch_acceptances acceptance
   where acceptance.accepted_at < clock_timestamp() - interval '7 days';

  delete from public.expo_push_receipts receipt
   where receipt.receipt_status <> 'pending'
     and receipt.terminal_at < clock_timestamp() - interval '7 days';

  insert into public.push_token_dispatch_acceptances (
    event_key, user_id, token, accepted_at
  )
  select receipt.event_key,
    receipt.user_id,
    receipt.token,
    clock_timestamp()
    from public.expo_push_receipts receipt
   where receipt.receipt_status = 'pending'
     and receipt.delivery_action = 'resend'
     and (
       receipt.expires_at <= clock_timestamp()
       or receipt.attempt_count >= 100
       or receipt.action_attempt_count >= 100
     )
  on conflict (event_key, user_id, token) do nothing;

  update public.expo_push_receipts receipt
     set receipt_status = 'expired',
         terminal_at = clock_timestamp(),
         lease_owner = null,
         lease_until = null,
         last_error_code = 'ReceiptExpired',
         last_error_message = case
           when receipt.delivery_action = 'resend' then
             'The canonical resend did not complete before its bounded expiry.'
           else
             'Expo receipt was unavailable before its bounded expiry.'
         end,
         updated_at = clock_timestamp()
   where receipt.receipt_status = 'pending'
     and (
       receipt.expires_at <= clock_timestamp()
       or receipt.attempt_count >= 100
       or receipt.action_attempt_count >= 100
     );

  if not exists (
    select 1
      from public.expo_push_receipts receipt
     where receipt.receipt_status = 'pending'
       and receipt.next_attempt_at <= clock_timestamp()
       and receipt.expires_at > clock_timestamp()
       and receipt.attempt_count < 100
       and receipt.action_attempt_count < 100
       and (receipt.lease_until is null or receipt.lease_until < clock_timestamp())
  ) then
    return;
  end if;

  select secret.decrypted_secret into v_web_worker_url
    from vault.decrypted_secrets secret
   where secret.name = 'web_personal_notification_worker_url'
   order by secret.created_at desc limit 1;
  select secret.decrypted_secret into v_secret
    from vault.decrypted_secrets secret
   where secret.name = 'web_personal_notification_worker_secret'
   order by secret.created_at desc limit 1;
  if coalesce(btrim(v_web_worker_url), '') !~
     '^https://[a-z0-9-]+[.]supabase[.]co/functions/v1/web-personal-notifications$' then
    raise exception 'web_personal_notification_worker_url is not configured safely';
  end if;
  if char_length(btrim(coalesce(v_secret, ''))) < 32
     or char_length(btrim(coalesce(v_secret, ''))) > 512
     or btrim(v_secret) ~ '[[:space:]]' then
    raise exception 'web_personal_notification_worker_secret is not configured safely';
  end if;
  v_receipt_worker_url := regexp_replace(
    v_web_worker_url,
    '/web-personal-notifications$',
    '/push-receipts'
  );
  perform net.http_post(
    url := v_receipt_worker_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || btrim(v_secret),
      'Content-Type', 'application/json'
    ),
    body := '{"limit":100}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function public.invoke_expo_push_receipt_worker()
  from public, anon, authenticated;
grant execute on function public.invoke_expo_push_receipt_worker()
  to service_role;

comment on table public.expo_push_receipts is
  'Server-only, seven-day bounded diagnostics for Expo provider push receipts.';
comment on function public.invoke_expo_push_receipt_worker() is
  'Five-minute cron hook; performs local expiry/retention and invokes Edge only for due Expo receipts.';

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'expo-push-receipts-every-five-minutes';
select cron.schedule(
  'expo-push-receipts-every-five-minutes',
  '*/5 * * * *',
  'select public.invoke_expo_push_receipt_worker()'
);

notify pgrst, 'reload schema';
