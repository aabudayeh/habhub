# Production deployment

MetricRally can still run without credentials, but accounts, cross-device sync, real friend groups, private cloud media, and account deletion require Supabase.

The separate Google Health PWA pilot has security-sensitive ordering, Vault,
subscriber, and acceptance gates in [GOOGLE_HEALTH_WEB_SYNC.md](./GOOGLE_HEALTH_WEB_SYNC.md).

## 1. Create the Supabase project

Create a project, then copy its project URL and **publishable key** from the Connect panel. Never expose the service-role key in the Expo app.

```powershell
Copy-Item .env.example .env
```

Fill in at least:

```text
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Deploy the authenticated deletion function before applying the latest
migrations. The current function deliberately fails closed until
`202609040003_fail_closed_account_content_deletion.sql` is present, preventing
an older deletion path from orphaning shared content during rollout. At this
stage, deploy only `delete-account`; then follow the coordinated migration and
push-worker sequence in section 5 rather than running an unfenced database
push:

```powershell
pnpm.cmd dlx supabase@latest login
pnpm.cmd dlx supabase@latest link --project-ref YOUR_PROJECT_REF
pnpm.cmd dlx supabase@latest functions deploy delete-account
```

`202609040002_user_safety.sql` deliberately installs
`app_policy_versions.ugc_terms_enforced = false` so the previous store client
does not lose chat/feed writes during rollout. Version 1.0.18 enforces the same
Terms gate in its UI immediately. Only after the minimum supported native build
is 1.0.18 or newer, activate the server gate from the Supabase SQL editor:

```sql
update public.app_policy_versions
set ugc_terms_enforced = true,
    updated_at = now()
where singleton;
```

Confirm the policy row and a current Terms acceptance with a non-production
test account before raising the minimum supported version.

The fifth migration adds revisioned account sync, registered devices, realtime group invalidation, idempotent photo/message writes, and RLS-backed group access to private Storage objects. The sixth adds health-source provenance, connection/cursor storage, deduplication constraints, and owner-only RLS.

## 2. Configure authentication

In Supabase Authentication > URL Configuration, set the final web Site URL and allow these redirects:

```text
paceboard://auth-callback
http://localhost:8081/auth-callback
https://YOUR_WEB_DOMAIN/auth-callback
```

For reliable production email, configure a custom SMTP provider. Email/password, sign-up, password reset, and magic links work after email is enabled.

Release `1.0.18` deliberately disables Apple account OAuth on every platform
until account deletion can revoke the Apple provider token as part of the same
verified lifecycle. Google account OAuth remains available on Android and web,
but is hidden and rejected by the iOS client; iOS uses HabHub email/password or
magic-link authentication only. Keep the Apple provider disabled in the
production Supabase project. Do not expose Google account OAuth on iOS until
Sign in with Apple, Apple credential revocation, and physical-device deletion
tests are implemented together.

## 3. Test the cloud path locally

Restart Expo after changing `.env`:

```powershell
pnpm.cmd start
```

Test with two different accounts:

1. Create an account on device/browser A.
2. Create a **cloud group** and copy its invite code.
3. Join that code from account B.
4. Log an exact-value group metric, a status-only metric, a private metric, a chat image, and a progress photo.
5. Confirm B sees only the authorized versions.
6. Sign into A from a second device and confirm account changes synchronize.
7. Test export, sign-out, and account deletion.

## 4. Configure EAS

Log in and attach the project to your Expo account:

```powershell
pnpm.cmd dlx eas-cli@latest login
pnpm.cmd dlx eas-cli@latest init
pnpm.cmd dlx eas-cli@latest build:configure
pnpm.cmd dlx eas-cli@latest update:configure
```

Add the two public Supabase values to each EAS environment you use. They are public client configuration, not server secrets:

```powershell
pnpm.cmd dlx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value https://YOUR_PROJECT.supabase.co --visibility plaintext
pnpm.cmd dlx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value YOUR_PUBLISHABLE_KEY --visibility plaintext
pnpm.cmd dlx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://YOUR_PROJECT.supabase.co --visibility plaintext
pnpm.cmd dlx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value YOUR_PUBLISHABLE_KEY --visibility plaintext
```

Add the legal/support variables from `.env.example` before store submission.
`EXPO_PUBLIC_PRIVACY_URL`, `EXPO_PUBLIC_TERMS_URL`,
`EXPO_PUBLIC_SUPPORT_URL`, and `EXPO_PUBLIC_DELETE_ACCOUNT_URL` must be distinct,
public HTTPS routes that work without the installed app. Configure
`EXPO_PUBLIC_SUPPORT_EMAIL` with a monitored mailbox owned by the final operator.
The repository validator checks route/config wiring, but it cannot replace legal
review, mailbox operations, or store-console verification.

## 5. Configure standards-based Web Push

Web Push uses one VAPID P-256 keypair for the web origin. Generate the pair once
with a reputable Web Push tool. The public key is browser configuration; the
private key must never enter Expo, the web bundle, Git, or an `EXPO_PUBLIC_`
variable.

Set the public key for the static Expo export:

```text
EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY=URL_SAFE_PUBLIC_KEY
```

Set the matching Edge Function secrets:

```powershell
pnpm.cmd dlx supabase@latest secrets set WEB_PUSH_VAPID_PUBLIC_KEY=URL_SAFE_PUBLIC_KEY
pnpm.cmd dlx supabase@latest secrets set WEB_PUSH_VAPID_PRIVATE_KEY=URL_SAFE_PRIVATE_KEY
pnpm.cmd dlx supabase@latest secrets set WEB_PUSH_VAPID_SUBJECT=mailto:notifications@YOUR_DOMAIN
pnpm.cmd dlx supabase@latest secrets set PERSONAL_NOTIFICATION_WORKER_SECRET=YOUR_EXISTING_32_PLUS_CHARACTER_WORKER_SECRET
```

Use this rollout order so the native Expo path never depends on an incomplete
browser rollout:

1. Quiesce group push dispatch for this coordinated upgrade by setting
   `public.push_dispatch_configuration.emitters_active` to `false` from a
   trusted database-operator session. Verify the row before continuing:

   ```sql
   update public.push_dispatch_configuration
   set emitters_active = false
   where singleton;

   select singleton, emitters_active
   from public.push_dispatch_configuration;
   ```

2. Apply all six pending migrations, in order, through
   `202609050002_google_health_history_window.sql`. The first four are a
   coupled notification/safety/deletion rollout:

   - `202609040001_expo_push_receipts.sql` installs the service-only Expo
     receipt/resend queue and changes the private acceptance-ledger writer
     contract.
   - `202609040002_user_safety.sql` installs block/report data-access rules and
     the operator safety queue.
   - `202609040003_fail_closed_account_content_deletion.sql` installs the
     deletion-lease-owned shared-content purge and write fence.
   - `202609040004_trusted_web_push_endpoints.sql` binds Web Push acceptances to
     an exact registration version, purges untrusted endpoints, and installs
     the exact stale-registration RPC required by the matching Web worker.
   - `202609050001_fix_challenge_result_social_recipient.sql` replaces the
     unsupported `min(uuid)` challenge-result recipient aggregate while
     retaining the one-winner-only notification rule.
   - `202609050002_google_health_history_window.sql` persists each Google
     Health connection's selected history window, including the strict
     current-day-only (`0`) mode used by both interactive and background
     imports.

   Confirm the exact list, then apply it while dispatch remains quiesced:

   ```powershell
   pnpm.cmd dlx supabase@latest db push --dry-run --linked
   pnpm.cmd dlx supabase@latest db push --linked
   ```

   Do not deploy only a prefix of this set. The old `send-push` revision is not
   compatible with migration `202609040001`, and the new
   `web-personal-notifications` revision is not compatible without migration
   `202609040004`. Keep dispatch quiesced across this interval.
3. Set and verify all three VAPID secrets. Retain the already-deployed
   `PERSONAL_NOTIFICATION_WORKER_SECRET`; the Web reminder and Expo receipt
   workers deliberately share this internal cron credential.
4. Deploy `google-health`, `google-health-worker`, and
   `google-health-webhook` only after migration `202609050002` is present. This
   keeps interactive reads, scheduled catch-up, and webhook-triggered sync on
   the same user-selected history boundary.
5. Deploy `delete-account` and `send-push` so account removal uses the guarded
   purge and every accepted Expo ticket is atomically checkpointed
   with its per-token acceptance.
6. Deploy both notification cron targets without gateway JWT verification;
   each validates
   the high-entropy internal secret itself rather than a user access token:

   ```powershell
   pnpm.cmd dlx supabase@latest functions deploy web-personal-notifications --no-verify-jwt
   pnpm.cmd dlx supabase@latest functions deploy push-receipts --no-verify-jwt
   ```

7. Run `pnpm.cmd configure:web-notifications-worker` once with the same
   `PERSONAL_NOTIFICATION_WORKER_SECRET` in the shell. This stores the canonical
   Web worker URL and secret in Vault; the receipt cron derives the sibling
   `/push-receipts` URL from that validated URL, so it needs no second URL or
   secret.
8. Smoke-test both workers and inspect their protected queue health. Only then
   resume group push dispatch by setting `emitters_active = true` and verifying
   the row again.
9. Export and deploy the HTTPS web app with the matching public key.
10. From the installed PWA, enable notifications with the in-app switch and
   verify both a chat/group event and a tracker or to-do reminder while the PWA
   is closed.

Do not rotate the VAPID pair casually: existing browser subscriptions are bound
to its public key. The client can replace a subscription after a deliberate
rotation, but every browser must reopen once to register the replacement.

On iPhone and iPad, add HabHub to the Home Screen and open that installed app
before enabling notifications. Web Push currently carries server-owned chat,
group, leaderboard, membership, and challenge events. Timed tracker and to-do
reminders remain device-scheduled on native builds and are mirrored into a
private, durable server schedule for closed-browser PWA delivery. The
`web-personal-notifications-every-minute` cron job and Edge Function must both
remain healthy for that PWA path.

Native Expo pushes additionally depend on the
`expo-push-receipts-every-five-minutes` cron and `push-receipts` Edge Function.
The queue waits 15 minutes before its first provider-receipt check and retries
missing/transient receipt requests with bounded backoff. A
`MessageRateExceeded` receipt becomes a targeted resend action for the original
canonical event; an exact, unexpired worker lease plus owner, token, acceptance,
and registration-version fences prevent concurrent workers from crossing or a
refreshed device from receiving stale work. Chat events are also materialized
in the durable outbox so their resend payload is reconstructed from committed
server data. `resend_complete` is terminal only after the replacement is
accepted, deduplicated, or safely suppressed. Pending IDs expire at 24 hours
when Expo no longer retains them, and terminal diagnostics are retained for
seven days. A `DeviceNotRegistered` receipt removes only the device-token
version selected for that send; it cannot remove a registration refreshed or
reassigned while the provider response was in flight.
Receipt status `provider_accepted` means APNs or FCM accepted the notification,
not that a handset displayed it.

After deployment, use the Supabase SQL editor with an operator account to check
the server-only state (the app roles intentionally have no table access):

```sql
select jobname, schedule, active
from cron.job
where jobname in (
  'web-personal-notifications-every-minute',
  'expo-push-receipts-every-five-minutes'
);

select receipt_status, count(*)
from public.expo_push_receipts
group by receipt_status
order by receipt_status;
```

The same safety migration creates a durable report queue that is deliberately
unavailable to app clients and group admins. Follow
`docs/MODERATION_OPERATIONS.md` from a trusted service-role environment. Before
public UGC is enabled, confirm the assigned operator can page the queue and act
on a non-personal fixture report:

```sql
select *
from public.habhub_list_operator_safety_reports('priority', null, null, 100);

select *
from public.habhub_list_operator_safety_reports('queued', null, null, 100);

select public.habhub_operator_safety_queue_health();
```

Do not place the service-role key in the app or web deployment. A named,
monitored moderation owner, tested response process, and legally reviewed
retention policy remain public-launch gates; the database queue does not supply
those human operations.

Send a push to a physical Android and iOS release build, confirm its ticket row
starts no earlier than 15 minutes after `accepted_at`, and confirm it settles or
records a bounded error before `expires_at`. Also test an invalid/unregistered
test token and verify only that token is removed. Never use a production user's
token for destructive delivery testing.

## 6. Build and deploy

Health sync, barcode scanning, and push notifications are configured in `app.json`. They require a new native EAS build. Remote push is not available in Expo Go on Android; test it in the preview/release APK. Test Apple Health on a physical iPhone. On Android, test Health Connect on Android 8+; Android 14 includes it in the system, while older supported versions may require the Health Connect app.

Before distributing the Android production build, complete Google Play's Health Connect declaration for every requested read category. Confirm Samsung Health, MyFitnessPal, or Google Fit is allowed to write into Health Connect if you want its data to appear. On iOS, allow compatible apps to write into Apple Health and grant MetricRally read access when prompted.

Background health refresh is best-effort on both mobile platforms; an interval
is the earliest eligible time, not a delivery guarantee. Android WorkManager can
be delayed by Doze, OEM battery restrictions, or a user Force stop, and a
force-stopped app cannot resume scheduled work until the user launches it again.
Galaxy Watch data must first reach Samsung Health on the phone and then Health
Connect; HabHub cannot force either upstream transfer. Test the production AAB
on a physical Samsung phone/watch pair for at least 48 hours with the app swiped
away (but not Force stopped), including an offline run followed by reconnection.

The iOS build now declares HealthKit background delivery and BG processing, but
the current app adapter still performs unanchored polling rather than consuming
HealthKit observer events with per-type anchors. Treat terminated-app,
edit/deletion, and multi-day HealthKit refresh as a physical-device P1 release
test and do not market event-driven Apple Health sync until that native path is
implemented. Verify `aps-environment=production`, the HealthKit entitlements,
and `BGTaskSchedulerPermittedIdentifiers` from the final signed IPA rather than
assuming source configuration proves the store artifact.

Run the release checks:

```powershell
pnpm.cmd check:release
```

The production dependency audit intentionally ignores only
`GHSA-w3rx-r6r6-pgpr` and `GHSA-5p2g-fcmc-qvqq`: both affect Expo's local
`image-size` build-tool path, their advisory requires `image-size >=2.0.3`, and
that version is not yet published in the configured npm registry. HabHub never
parses user-supplied ICNS, JXL, or HEIF files through that CLI path. Remove the
two scoped ignores as soon as Expo adopts a published patched release; do not
add broad audit exclusions.

Android preview:

```powershell
pnpm.cmd dlx eas-cli@latest build --profile preview --platform android
```

iOS preview:

```powershell
pnpm.cmd dlx eas-cli@latest build --profile preview --platform ios
```

Production store binaries:

```powershell
pnpm.cmd dlx eas-cli@latest build --profile production --platform all
pnpm.cmd dlx eas-cli@latest submit --profile production --platform android
pnpm.cmd dlx eas-cli@latest submit --profile production --platform ios
```

Static web hosting:

```powershell
pnpm.cmd export:web
pnpm.cmd dlx eas-cli@latest deploy --prod
```

You may instead upload `dist/` to another static host. Add that exact domain to the Supabase redirect allowlist.

## 7. Store-launch responsibilities

Before public release:

- Replace `app.paceboard.mobile` if you want an identifier owned by your domain. Do this before distributing test builds.
- Provide final icons, screenshots, store copy, privacy policy, terms, and a support URL.
- Complete Apple/Google health and nutrition disclosures before enabling device-health imports.
- Configure database backups and a staging Supabase project.
- Review consent, data retention, deletion, incident response, and processor agreements for health-related data.
- Test deep links, OAuth, email confirmation, offline conflicts, large text, photos, RLS boundaries, and deletion on physical iOS and Android devices.

## Troubleshooting

- `pnpm is not recognized`: install Node.js, then run `corepack enable`, or `npm install -g pnpm`.
- PowerShell blocks `pnpm.ps1`: use `pnpm.cmd` as shown above.
- “Apply the latest Supabase migrations”: run `supabase db push`, then restart the app.
- OAuth returns to the browser: verify `paceboard://auth-callback` is allowlisted and rebuild after changing the app scheme.
- A friend cannot see a photo: confirm the photo is group-visible; private Storage URLs are generated only when relational RLS grants access.
