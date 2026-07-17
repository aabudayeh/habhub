# Roadmap

## Stage 1 — current repository

- Universal Expo UI and credential-free demo.
- Default/custom metrics, safe formulas, weighted scoring, configurable dashboards, photos, privacy, rankings, and chat.
- Centralized Supabase authentication, automatic account sync, device tracking, private Storage, data export/deletion, static web export, and EAS configuration.
- Authenticated cloud groups, real profiles, invite-code membership, relational metric/log/status/chat/photo sync, realtime invalidation, and ownership transfer on leave.
- HealthKit and Health Connect native adapters with permissions, provenance, deduplication, app-open/manual/pull-to-refresh sync, and OS-managed background schedules.

## Stage 2 — collaboration hardening

- Add abuse reporting, blocking, rate limits, and moderation audit history.
- Move high-volume invalidation from Postgres Changes to private Realtime Broadcast channels.
- Add server-side aggregation/materialized daily rankings for large groups.
- Add explicit conflict-review UI for rare non-append concurrent edits.
- Add automated RLS integration tests using two authenticated test users.

## Stage 3 — nutrition expansion and health hardening

- Physical-device provider matrix tests for Apple Health, Samsung Health, MyFitnessPal summaries, and Google Fit migration data.
- Use native change tokens/anchors for larger histories; the current stable-ID implementation safely refreshes an overlapping date window.
- Add an imported-record correction/override audit screen.
- Open Food Facts search/barcode flow with confirmation and correction.
- Saved foods, meals, recipes, and imported meal summaries.

## Stage 4 — notifications and automation

- Push token registration and quiet hours.
- Scheduled leaderboard finalization.
- Rule-based goal, lead-change, streak, reminder, and daily-winner messages.
- Cooldowns, user banter preferences, moderation, and audit history.

## Stage 5 — template community

- Sanitize and publish group configurations without member data.
- Private, unlisted, and public templates.
- Version diffs and selective upgrades.
- Ratings, reports, curation, and moderation dashboard.

## Before a public health launch

- Threat model and independent security review.
- GDPR/UK GDPR data map, lawful-basis review, processor agreements, and deletion SLAs.
- Store health-data declarations and consent copy.
- Accessibility audit and real-device QA.
- Load, retry, offline-conflict, and migration rollback testing.
