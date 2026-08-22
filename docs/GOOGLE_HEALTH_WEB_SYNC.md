# Google Health web-sync pilot

This pilot lets an authenticated HabHub PWA account authorize the Google Health API directly. It does not read Health Connect from a browser. Google acts as the cloud bridge: a user must have supported data in Google Health, authorize the four read-only scopes, and keep the Google grant active.

The implementation is intentionally limited to the current unverified-client ceiling of 100 users. Do not deploy any part of this runbook out of order.

Migration `202608210001` installs Google Health with
`google_health_runtime_config.enabled = false`. While disabled, only status,
disconnect/delete, OAuth-state cleanup, and durable token revocation remain
available; connect, callback staging/completion, manual/background import, and
webhook enqueue/drain fail closed. Do not enable the switch until the
privacy-aware schema-27 clients are live and the mixed-version checks below
pass.

## Frozen endpoints and OAuth contract

- OAuth callback: `https://iloxyarjwpohycbxrwui.supabase.co/functions/v1/google-health/oauth/callback`
- Authenticated action endpoint: `https://iloxyarjwpohycbxrwui.supabase.co/functions/v1/google-health`
- Google webhook: `https://iloxyarjwpohycbxrwui.supabase.co/functions/v1/google-health-webhook`
- Scheduled worker: `https://iloxyarjwpohycbxrwui.supabase.co/functions/v1/google-health-worker`
- Approved browser return page: `https://habhub.expo.app/settings` only

The callback never links an account or imports data. It exchanges the code, encrypts the refresh token, stages a ten-minute one-time completion grant, and redirects with the high-entropy completion token in the URL fragment. The original authenticated HabHub browser must POST `action: "complete"`. This prevents a shared Google authorization URL from linking a victim's Google Health account to the attacker's HabHub account.

Authenticated POST actions are:

- `status`
- `connect`, with `redirectUri: "https://habhub.expo.app/settings"`
- `complete`, with `completionToken`
- `sync`
- `disconnect` — stops future sync and durably queues Google revocation; already imported rows remain
- `delete` — stops sync, queues revocation, and atomically deletes Google imports and stale group projections
- `updateEntry`, with `entryId` and a patch containing `visibility` and/or the paired `recordedAtOverride` plus `localDate`
- `dismissEntry`, with `entryId`
- `updateMetricVisibility`, with `metricId` and `visibility`

All action bodies have an actual streamed 8 KiB limit. Entry ownership and mutation validation are enforced server-side. A tracker-default visibility change updates the metric and Google rows without creating per-entry overrides; an explicit entry preference continues to win.

Schema 27 sends `x-habhub-privacy-schema: 27` on every Supabase REST/RPC
request and reads snapshots only through `get_user_snapshot(27)` and
`get_user_snapshot_metadata(27)`. `sync_user_snapshot` also requires both the
header and client schema 27 once the account has started Google OAuth. Released
schema-26/no-header clients retain normal native/manual-only accounts, but are
denied Google-bearing owner snapshots and cannot read, insert, update, or
delete Google-derived group entries/statuses/tombstones. Group snapshot RPCs
remain SECURITY INVOKER, so the same row-level filters apply.

Account snapshot invalidation is versioned too. Schema 27 subscribes only to
the private `account:<user-id>:snapshot:v27` topic, whose payload is
provider-neutral `{ revision }`. The trigger always emits that current topic;
it emits the legacy `account:<user-id>:snapshot` payload only while the account
has no Google privacy marker. Realtime cannot reliably inspect PostgREST
headers, so the versioned topic—not a Realtime header—is the transport cutover.

Build 1 does not emit metric-entry or lead-change push notifications from a
Google-derived row. The existing push outbox cannot yet select recipients by
privacy capability, so suppression is required to keep schema-26 devices from
receiving source-derived events. The legacy send-push compatibility synthesizer
also rejects Google metric and lead source rows. Manual/native metric push and generic scheduled
period-result push remain unchanged; Google rows can still appear in the group
and leaderboard according to configured visibility.

`sync` can partially succeed. Its response preserves `sync.errors` as a safe
array of `{ dataType, code }`; clients must show a partial-sync/retry notice
whenever that array is non-empty and must not report unconditional success.

## Google Cloud configuration

Enable the Google Health API for project `paceboard-92551`. Use a **dedicated Web OAuth client used only by this Google Health integration**, with the exact callback above and these minimum scopes:

```text
https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly
https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly
https://www.googleapis.com/auth/googlehealth.nutrition.readonly
https://www.googleapis.com/auth/googlehealth.sleep.readonly
```

Do not reuse a client ID that has ever requested login, Drive, Calendar, or other Google scopes. The authorization request explicitly sets `include_granted_scopes=false`, so historic unrelated grants cannot be folded into Health consent. Do not request `openid`, email, location, or write scopes. The Google Health identity endpoint supplies a Health user ID, not an email, so the UI must not claim it knows which Google email is connected.

The OAuth app is currently External and In production but unverified. The operational acceptance gate is a successful authorization by one ordinary consumer account that was never manually allowlisted. Do not claim universal eligibility: Workspace administrator policy and Advanced Protection can still block a user. If the live Health consent flow unexpectedly requires a Test user, stop rollout and resolve the Google-console/API eligibility discrepancy rather than weakening account binding.

Before creating a subscriber, create a dedicated user-managed service account where possible and grant only Google Health API Editor (Admin only if Editor is insufficient for the required operation). The subscriber helper uses a `cloud-platform` service-account access token. A downloaded Firebase Admin SDK JSON can technically authenticate, but it is broader than necessary: keep it outside the repository, rotate it after setup, and prefer the dedicated account.

## Edge secrets

Generate independent random values; never reuse the webhook and worker secrets:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The first command produces a 32-byte AES key. Configure these Supabase Edge secrets from an untracked temporary env file so values do not enter shell history:

```text
GOOGLE_HEALTH_CLIENT_ID
GOOGLE_HEALTH_CLIENT_SECRET
GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY
GOOGLE_HEALTH_OAUTH_REDIRECT_URI
GOOGLE_HEALTH_WEB_ORIGIN
GOOGLE_HEALTH_ALLOWED_REDIRECT_ORIGINS
GOOGLE_HEALTH_WEBHOOK_AUTHORIZATION
GOOGLE_HEALTH_WORKER_SECRET
```

Expected non-secret URI/origin values are:

```text
GOOGLE_HEALTH_OAUTH_REDIRECT_URI=https://iloxyarjwpohycbxrwui.supabase.co/functions/v1/google-health/oauth/callback
GOOGLE_HEALTH_WEB_ORIGIN=https://habhub.expo.app
GOOGLE_HEALTH_ALLOWED_REDIRECT_ORIGINS=https://habhub.expo.app
```

`GOOGLE_HEALTH_WEBHOOK_AUTHORIZATION` is the entire subscriber header, for example `Bearer <random-value>`. `GOOGLE_HEALTH_WORKER_SECRET` is the raw random value; the worker and cron add `Bearer ` themselves.

Optional rotation secrets are:

```text
GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEYS={"1":"<base64-32-bytes>","2":"<base64-32-bytes>"}
GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY_VERSION=2
GOOGLE_HEALTH_WEBHOOK_AUTHORIZATIONS=["Bearer <previous>","Bearer <current>"]
GOOGLE_HEALTH_WORKER_SECRETS=["<previous>","<current>"]
```

Set secrets with the linked CLI only after reviewing the untracked file:

```powershell
pnpm exec supabase secrets set --env-file .env.google-health.local
pnpm exec supabase secrets list
```

Delete the temporary file securely when setup is complete. Never put server secrets in `.env`, EAS public variables, app config, or committed SQL.

## Deployment order

Run the local gates first:

```powershell
pnpm validate:google-health
pnpm typecheck
pnpm lint
pnpm export:web
pnpm validate:cloud
git diff --check
```

Then use this exact order. The feature switch remains off through steps 1–8:

1. Deploy the new fail-closed `delete-account` function **before** the migration. Until the migration exists, account deletion returns the generic `account_deletion_failed` response; it must never fall back to deleting an auth user without durable Google revocation.
2. Dry-run and apply migration `202608210001_google_health_web_sync.sql`.
3. Verify the migration is listed remotely and PostgREST can resolve `begin_google_health_account_deletion`.
4. Deploy the Google OAuth, webhook, and worker functions.
5. Deploy the schema-27 web client with `x-habhub-privacy-schema: 27`; submit/install the schema-27 native build. Confirm neither path has a direct snapshot-table fallback.
6. With the switch still off, prove connect/manual sync/webhook data delivery cannot create a connection, queue item, import, or group projection. Prove a schema-26/no-header request cannot read/write a seeded Google-marked account, while schema 27 succeeds and a native/manual-only schema-26 account remains usable.
7. Provision the two Vault values used by cron and prove revocation cleanup still runs while imports are disabled.
8. Verify the authorized webhook verification body returns 201 and unauthorized verification returns 401; do not create the subscriber yet.
9. Enable the pilot in one reviewed SQL transaction:

   ```sql
   update public.google_health_runtime_config
      set enabled = true, updated_at = now()
    where singleton = true
      and min_privacy_schema = 27;
   ```

   Verify exactly one row is enabled and `min_privacy_schema = 27`.
10. Create/check the AUTOMATIC subscriber and complete the end-to-end acceptance tests below before exposing the card broadly.

```powershell
pnpm exec supabase functions deploy delete-account --no-verify-jwt
pnpm exec supabase db push --dry-run --linked
pnpm exec supabase db push --linked
pnpm exec supabase migration list --linked
pnpm exec supabase functions deploy google-health --no-verify-jwt
pnpm exec supabase functions deploy google-health-webhook --no-verify-jwt
pnpm exec supabase functions deploy google-health-worker --no-verify-jwt
```

`supabase/config.toml` also pins all three Google functions and `delete-account` to `verify_jwt = false`. The functions authenticate their own bearer token, Google header/signature, or worker secret as applicable.

## Vault and autonomous worker

Migration `202608210001` enables `pg_cron` and `pg_net`, schedules `google-health-worker-every-minute`, and safely does nothing until these Vault entries exist:

```sql
do $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'google_health_worker_url';
  if v_id is null then
    perform vault.create_secret(
      'https://iloxyarjwpohycbxrwui.supabase.co/functions/v1/google-health-worker',
      'google_health_worker_url',
      'Google Health scheduled worker URL'
    );
  else
    perform vault.update_secret(
      v_id,
      'https://iloxyarjwpohycbxrwui.supabase.co/functions/v1/google-health-worker',
      'google_health_worker_url',
      'Google Health scheduled worker URL'
    );
  end if;

  select id into v_id from vault.secrets where name = 'google_health_worker_secret';
  if v_id is null then
    perform vault.create_secret(
      '<same raw value as GOOGLE_HEALTH_WORKER_SECRET>',
      'google_health_worker_secret',
      'Google Health scheduled worker secret'
    );
  else
    perform vault.update_secret(
      v_id,
      '<same raw value as GOOGLE_HEALTH_WORKER_SECRET>',
      'google_health_worker_secret',
      'Google Health scheduled worker secret'
    );
  end if;
end $$;
```

Verify configuration without printing either secret:

```sql
select name, decrypted_secret is not null as configured, length(decrypted_secret) as value_length
from vault.decrypted_secrets
where name in ('google_health_worker_url', 'google_health_worker_secret');

select jobid, jobname, schedule, active, command
from cron.job
where jobname = 'google-health-worker-every-minute';

select status, start_time, end_time, return_message
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'google-health-worker-every-minute')
order by start_time desc
limit 10;
```

The queue is not client-driven: cron reclaims stale leases, drains pending webhook events and token revocations, and removes consumed/expired OAuth state after its one-hour audit window every minute. OAuth completion atomically queues the first import before returning. Each worker tick may also stage at most one due connected account for a roughly six-hour safety sweep; webhook notifications always claim first. This catches missed notifications and provider-side grant changes without creating a polling burst for the 100-account pilot. Revocation retries continue indefinitely with a capped 24-hour backoff.

An abandoned/denied OAuth attempt sets the compatibility marker before the
browser redirect. The worker releases that marker only after the one-hour
state audit window and after no pending grant, revocation, import, preference,
provider-linked snapshot ID, or Google-derived group projection remains. A
disconnect retains the marker while imported rows remain. Completed/dead
webhook payloads are stripped immediately; their notification hash is retained
for one year as a bounded replay ledger.

Signed webhook intervals are capped against the later of the connected
profile's civil date and a one-day UTC physical-time envelope. This retains
both local-tomorrow events east of UTC and next-UTC-date physical samples west
of UTC while keeping the fetch range bounded.

## Webhook subscriber

First verify the endpoint. The exact configured Authorization header with a verification body must return 201; omission must return 401. A normal notification additionally requires Google's raw-body signature and returns 204 only after durable enqueue.

```powershell
$headers = @{ Authorization = 'Bearer <webhook-secret>'; 'Content-Type' = 'application/json' }
Invoke-WebRequest -Method Post -Uri 'https://iloxyarjwpohycbxrwui.supabase.co/functions/v1/google-health-webhook' -Headers $headers -Body '{"type":"verification"}' -SkipHttpErrorCheck
Invoke-WebRequest -Method Post -Uri 'https://iloxyarjwpohycbxrwui.supabase.co/functions/v1/google-health-webhook' -ContentType 'application/json' -Body '{"type":"verification"}' -SkipHttpErrorCheck
```

Configure the helper environment without committing values:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\path\outside\repo\google-health-subscriber.json'
$env:GOOGLE_HEALTH_PROJECT_NUMBER = '<numeric project number, not paceboard-92551>'
$env:GOOGLE_HEALTH_SUBSCRIBER_ID = 'habhub-web'
$env:GOOGLE_HEALTH_WEBHOOK_URL = 'https://iloxyarjwpohycbxrwui.supabase.co/functions/v1/google-health-webhook'
$env:GOOGLE_HEALTH_WEBHOOK_AUTHORIZATION = 'Bearer <same full header configured in Edge>'
pnpm configure:google-health-subscriber
pnpm configure:google-health-subscriber -- --check
```

The helper polls the official long-running Operation and then requires an ACTIVE subscriber with this exact AUTOMATIC set:

```text
steps
exercise
body-fat
heart-rate
blood-glucose
sleep
hydration-log
nutrition-log
weight
```

Do not add `active-energy-burned`; it is not in the official webhook-supported list. Steps/exercise notifications also reconcile active energy, and a failure in that dependent fetch keeps the source event retryable.

Manual sync is deployable before subscriber registration, but the AUTOMATIC subscriber is a release gate. After the first sync, ordinary manual/periodic reconciliation uses a two-day overlap; without signed notification intervals, older provider edits and deletions are not guaranteed to be observed. The periodic sweep is a recovery net, not a replacement for the signed webhook range.

## Acceptance tests

Complete all of these with a non-production test account:

1. Confirm an ordinary, never-allowlisted consumer account can grant the four scopes. Record only pass/fail; do not log identity or tokens.
2. Share an authorization URL with a different HabHub session and prove the second account cannot complete binding.
3. Complete in the initiating session and verify the completion fragment is removed immediately.
4. Grant only a subset of scopes and verify supported data syncs without marking the connection erroneous for ungranted categories.
5. Import steps, food (including `UNSATURATED_FAT` when present), exercise, sleep, weight, body fat, glucose, hydration, heart rate, and active energy fixtures.
6. Verify a native current-day steps aggregate remains authoritative over a smaller Google total; a web-only user still receives Google steps.
7. Change tracker default visibility and verify non-overridden Google rows follow it after restart; verify an explicit entry visibility still wins.
8. Edit a synced food time, restart, sync again, and verify the override survives. Dismiss a row, simulate provider absence then reappearance, and verify it stays dismissed.
9. Share a Google entry, publish a calculated tracker and a latest-value carry-forward status that depend on it, then update/delete it at the provider and drain the signed event **without opening a client**. Verify the direct `metric_entries` row and every `daily_metric_status` marked `source_provider = 'google_health'` are removed, each affected tracker fence advances, and stale peer caches cannot rehydrate them. Unmarked manual/native statuses must remain.
10. Send a signed historical interval wider than 370 days and verify the worker chunks the full range rather than truncating it.
11. Kill a worker after queue claim and verify lease recovery. Fail one data type and verify only that type's source notification retries.
12. Disconnect while Google revoke is unavailable: local disconnect must succeed and the durable revocation row must later drain.
13. Delete imported data and verify the connection, snapshots, preferences, tombstones, relational projections, and provider-linked settings are removed.
14. Simulate a refresh-token replacement whose database commit succeeds but response is lost; verify the exact nonce/hash/generation re-read treats it as active and never queues it for revoke. Simulate a proven pre-commit failure with the old generation/lease still active and verify only that unpersisted replacement is queued.
15. Insert a group-visible Google row and prove it creates neither a metric-entry push outbox row nor a lead-change push; manual/native rows must still create their normal events. Verify no `google-health:` identifier reaches the push outbox or handset payload.
16. Start two concurrent account deletions. Only the attempt-token owner may proceed or cancel; the loser must receive `account_deletion_in_progress` and must not clear the winning guard. While guarded, prove the owner's still-valid JWT cannot read/write media. Kill the owner after the begin transaction, prove no takeover occurs before the ten-minute lease expires, then prove a fresh attempt takes over after expiry and completes idempotently. Force auth deletion failure and verify only the current owning attempt clears its guard; then complete a successful deletion and verify media are empty and a revocation row survives the auth cascade.
17. Age consumed and expired OAuth-state fixtures beyond one hour, drain the worker, and verify they are removed while live states remain. Verify an abandoned clean connection marker is released, but a marker with a revocation/import/preference remains.
18. Run the subscriber helper with `--check` and inspect cron/queue health for at least two ticks.

Account deletion commits an invocation-unique, attempt-token-owned database guard before enumerating
Storage. It paginates every folder beyond 1,000 objects, deletes in bounded
batches, and performs a second full listing. Any list/delete/verification
failure aborts auth deletion and only that invocation may clear its guard. A
heartbeat renews a ten-minute lease before every Storage page and delete batch;
after a killed Edge process, a fresh authenticated attempt can take over only
after that lease expires and rerun the cleanup idempotently. It never silently
leaves an unowned media prefix. Storage read and mutation
policies require the auth user to still exist and deny the guarded account,
blocking residual access during deletion and a stale JWT afterward.

Build 1 retains Google's explicit general `UNSATURATED_FAT` value as the
distinct canonical `nutrition.unsaturatedFatG` field; it is never inferred
from mono/polyunsaturated fat. Adding that field to the selectable nutrient
tracker/chart catalog is deliberately a phase-2 UI task.

## Monitoring without sensitive payloads

Never select webhook payloads, external IDs, encrypted tokens, provider response bodies, or OAuth state into operator logs. Use counts and ages:

```sql
select status, count(*), min(created_at) as oldest
from public.google_health_webhook_queue
group by status;

select status, count(*), min(created_at) as oldest
from public.google_health_revocation_queue
group by status;

select status, count(*), max(last_synced_at) as latest_sync
from public.google_health_connections
group by status;

select
  count(*) filter (where consumed_at is not null) as consumed_states,
  count(*) filter (where expires_at < now()) as expired_states,
  min(coalesce(consumed_at, expires_at)) as oldest_state
from public.google_health_oauth_states;
```

An accumulating revocation queue is an incident: retries are intentionally indefinite rather than silently dead-lettering live grants.

`group_members.last_data_synced_at` and `group_activity_versions` are retained
as non-source-identifying synchronization/version metadata after a Google
purge. They contain no tracker, value, provider ID, or health record content.

## Rotation

For token encryption, add a new key to `GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEYS`, set `GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY_VERSION` to it, deploy, and allow active connections to re-encrypt on sync. Provider-issued refresh-token replacements are persisted through an idempotent nonce/hash/generation RPC; an ambiguous response is resolved by re-reading the exact active credential and durable revoke queue before compensation. Keep every old key until all four stores report zero rows at that version: OAuth states, pending grants, active connections, and revocation queue. Never remove a key while a queued credential still needs revocation.

For webhook authorization, deploy `GOOGLE_HEALTH_WEBHOOK_AUTHORIZATIONS` containing previous and current full headers, patch the subscriber to the current header, prove delivery, then remove the previous header.

For worker authorization, deploy `GOOGLE_HEALTH_WORKER_SECRETS` containing previous and current raw values, set the singular current value, update the Vault worker secret to current, prove cron succeeds, then remove previous.

## Disclosure, verification, and rollback

Before the connection button, and in normal app usage rather than only Settings, disclose which categories are read, that imports follow each tracker's configured visibility and can appear in group/status/leaderboard views, how to change visibility, and the difference between Disconnect and Delete imported data. Publish accurate privacy/support/terms pages and comply with the Google API Services User Data Policy and Limited Use requirements. Moving beyond the unverified ceiling requires Google's OAuth verification and any applicable restricted-scope/security assessment.

RISC is optional for this pilot; do not claim it is configured unless its endpoint is deployed and verified.

To roll back, first set `google_health_runtime_config.enabled = false`, then
stop new connections in the UI, delete/disable the Google subscriber, drain all
pending revocations, disconnect/delete pilot grants, verify queues, and only
then remove functions or secrets. Never roll back by dropping credential tables
or deleting ciphertext before remote grants are revoked.

Official references:

- https://developers.google.com/health/setup
- https://developers.google.com/health/webhooks
- https://developers.google.com/health/reference/rest/v4/projects.subscribers/create
- https://developers.google.com/health/reference/rest/v4/projects.subscribers
- https://developers.google.com/health/rate-limits
- https://developers.google.com/health/developer-checklist
- https://supabase.com/docs/guides/database/vault
- https://supabase.com/docs/guides/functions/schedule-functions
- https://supabase.com/docs/guides/database/extensions/pg_net
