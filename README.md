# Paceboard

Paceboard is a customizable social tracker for private friend groups: **track your way, rally together**.

This repository contains a working Expo app for iOS, Android, and web. It launches with a credential-free demo group so you can try the product immediately. Supabase sign-in and cloud backup turn on when you add environment variables.

## What works now

- Five-tab mobile experience: Today, Log, Leaderboard, Progress, and Chat.
- Healthy Competition starter template with 30 days of demo history for every member, including dated progress photos.
- Number, yes/no, and free-text logging with notes, food labels, image attachments, and offline persistence.
- Profile-based BMR and general-activity estimates, recommended deficit from desired weekly loss, and a matching food-intake target. The default deficit is `bmr + daily_activity + exercise - food`; the food allowance adds logged active energy by default and can be switched to fixed mode.
- Editable and removable metrics in dedicated modal editors, with 60 icons, aggregation, ranking, goal, privacy, and safe formulas assembled from selectable fields. Formula validation shows a persistent success check or a precise error.
- User-configurable Today, Group, and Progress lists with drag ordering.
- Fully adjustable normalized scoring weights.
- Today/yesterday/custom-day/7-day/month leaderboards with separate per-metric rankings, explicit daily averages and totals, yes/no completion fractions, date-aware friend comparisons, 7-day/30-day/overall averages, and filterable drill-downs to collapsible shared entries, notes, nutrition, reporting alignment, and dated photo comparisons.
- Multiple local demo groups with create, join, switch, invite, and leave controls. Each group keeps its own metric and scoring configuration.
- Per-entry privacy: private, group-visible, or goal-status only.
- Switchable 7-day and month Progress views with multi-metric visuals and summaries, a visible normalized goal line, clickable filtered daily detail, completed-goal fractions, dated manual logs, nutrition macros, and explicitly retrospective or non-retroactive tracked-goal history.
- Group-visible exact values are the default, with private and goal-status overrides on every metric and entry. Progress photos appear only on their logged day, preselect the nearest older comparison, include nearest-weight annotations, expand full-screen, and export as a web snapshot.
- Group and private chat with a conversation sidebar, image attachments, draft-first quick suggestions, and randomized libraries of 180+ cheers, taunts, and reminders per category.
- Group-scoped nicknames with original-name labels, optional profile photos, owner/admin scoring and streak-rest-day controls, metric-specific notification preferences, and a global side menu exposing them from every primary screen.
- A dedicated Badge cabinet filter in Alerts, a full date/person-filterable cabinet, five-badge profile showcases, two-sided metric-aware head-to-head stats, and leaderboard alerts for lead changes and messages.
- Today and Progress show the amount remaining for each goal, including current weight-loss pace and the activity-adjusted food allowance. Today also estimates extra activity needed to recover a deficit shortfall and shows the cumulative current-week deficit balance.
- Daily-shuffled personal and group recap stories summarize 5–8 useful trends, comparisons, distance equivalents, goal completion, and group leaders.
- Local persistence through AsyncStorage.
- Email/password, sign-up, password reset, magic-link, Google, and Apple account flows through Supabase, with a credential-free demo fallback.
- Automatic revisioned multi-device account sync with offline retry, conflict merging, device management, portable JSON export, and permanent account deletion.
- Real cloud groups with invite codes, membership switching, admin-owned scoring/metrics, authorized realtime refresh, group/private/status-only logs, chat, and private-bucket photo uploads.
- Native Apple Health and Android Health Connect imports for steps, active energy, weight, food calories/macros, water, and workouts. Source provenance, overlapping-window replacement, app-open sync, pull-to-refresh, manual sync, and OS-managed background schedules are included. Samsung Health, MyFitnessPal, and legacy Google Fit data are consumed through the platform health hub when those apps share it.
- Production Supabase migrations with row-level security on user data and relationally authorized signed media URLs.
- Static web export and EAS build configuration.

## Try it locally

Prerequisites: Node.js 20+ and pnpm.

```bash
pnpm install
pnpm start
```

On Windows PowerShell, if script execution blocks `pnpm.ps1`, use `pnpm.cmd install` and `pnpm.cmd start` instead.

Then:

- Press `w` to open the web app.
- Scan the QR code with Expo Go to try the non-health demo on a phone.
- Or run `pnpm android` / `pnpm ios` with an emulator or simulator.

Apple Health and Health Connect require the EAS custom development/preview build; native health modules do not run in Expo Go or the web preview.

Expo SDK 54 is intentional: it is the stable version compatible with Expo Go during the current SDK 57 transition.

Run the quality checks:

```bash
pnpm typecheck
pnpm lint
pnpm export:web
pnpm preview:web
```

## Enable Supabase cloud accounts

1. Create a Supabase project.
2. Copy `.env.example` to `.env`.
3. In Supabase’s **Connect** panel, copy the Project URL and publishable key into `.env`.
4. Apply all included database migrations and deploy account deletion:

```bash
pnpm dlx supabase@latest login
pnpm dlx supabase@latest link --project-ref YOUR_PROJECT_REF
pnpm dlx supabase@latest db push
pnpm dlx supabase@latest functions deploy delete-account
```

5. Add your deployed web callback and `paceboard://auth-callback` to the allowed Auth redirect URLs in Supabase.
6. Restart Expo. The app now opens its account screen and retains **Try the full demo** as an option.

The publishable key is designed for client apps and is protected by row-level security. Never place a Supabase service-role key in an `EXPO_PUBLIC_` variable.

## Deploy the web app

The quickest hosted preview uses EAS Hosting:

```bash
pnpm export:web
pnpm dlx eas-cli@latest login
pnpm dlx eas-cli@latest deploy
```

When ready for the production alias:

```bash
pnpm dlx eas-cli@latest deploy --prod
```

You can also publish the generated `dist/` directory with Netlify, Cloudflare Pages, Vercel, or another static host.

## Build installable mobile apps

The `eas.json`, Android application ID, and iOS bundle identifier are already present.

```bash
pnpm dlx eas-cli@latest login
pnpm dlx eas-cli@latest build:configure
pnpm dlx eas-cli@latest build --profile preview --platform android
```

For iOS:

```bash
pnpm dlx eas-cli@latest build --profile preview --platform ios
```

Change `app.paceboard.mobile` in `app.json` before store submission if you want a bundle identifier tied to your own domain.

## Important scope boundary

This is now a deployable cloud-backed core product, not a finished medical/health platform. Accounts, cloud groups/media/chat, and HealthKit/Health Connect imports are implemented. Barcode nutrition search, OS push-token delivery, production store health-data approval, and public-launch legal/security review remain; see [docs/ROADMAP.md](docs/ROADMAP.md).

## Repository map

```text
app/                         Expo Router screens
src/components/              Reusable UI
src/data/                    Default template and demo state
src/domain/                  Formula, scoring, ranking, and date logic
src/auth/, src/cloud/        Session, account sync, group collaboration, media
src/health/                  Native adapters, sync orchestration, background jobs
src/lib/                     Supabase client
src/state/                   Offline-first app state
supabase/migrations/         Cloud schema, functions, storage, and RLS
docs/                        Architecture, deployment, and roadmap
```

## Privacy note

Fitness, weight, nutrition, and progress photos can be sensitive data. The demo illustrates privacy controls, but a public launch still needs a reviewed privacy policy, retention rules, consent copy, deletion/export workflows, processor agreements, and a security review.
