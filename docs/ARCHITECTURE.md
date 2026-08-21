# Architecture

## Client

MetricRally is an Expo Router application targeting iOS, Android, and web from one TypeScript codebase.

The current client is local-first:

1. `AppProvider` creates the default Healthy Competition template.
2. AsyncStorage restores any locally saved state before the routed app appears.
3. Mutations update React state immediately.
4. A short debounce persists the complete local state.
5. When authenticated, a revisioned owner-only snapshot synchronizes account state automatically and retries after offline use.
6. Real groups use normalized relational rows for memberships, metrics, entries, value-free goal statuses, chat, and photos.

The client-loading gate is intentional. It keeps static web hydration deterministic while state, local dates, locale formatting, and AsyncStorage are resolved in the browser.

## Domain layer

`src/domain` has no React Native dependencies.

- `formula.ts` tokenizes and parses approved arithmetic, comparison operators, metric identifiers, and a small function allowlist. It never uses `eval` or `Function`.
- `metrics.ts` aggregates raw entries, resolves calculated metrics, detects circular dependency paths, computes goal progress, normalizes weighted scores, and ranks members.
- Raw entries remain separate from calculated values. Editing an input changes the calculation rather than rewriting source data.

## Privacy model

Visibility is attached to each entry or photo:

- `private`: owner only.
- `status`: the group may see goal state without the exact value.
- `group`: exact shared value.

The UI is only one enforcement layer. The Supabase migration enables RLS on every user-data table. Group membership checks are implemented as security-definer helper functions with an empty search path.

## Cloud model

The migrations include normalized tables for profiles, groups, memberships, metric definitions, goals, entries, layouts, chat, media, automation, and versioned templates. Private media uses a non-public Storage bucket. Object paths remain private; signed URLs can be minted only when relational RLS proves ownership or authorized group/private-message access.

`user_snapshots` is an owner-only, revisioned account document used for fast multi-device recovery of the local-first state. Optimistic revisions detect concurrent edits and the client merges append-only collections before retrying. `account_devices` exposes recent sessions without exposing tokens.

Cloud groups use the normalized tables as the collaboration source of truth. Admins own metric/scoring configuration. Exact group entries are readable by members, private entries remain owner-only, and `daily_metric_status` shares a goal result without its underlying value. Realtime database events are invalidation signals; every refresh still passes through RLS.

## Formula syntax

Supported operators:

```text
+  -  *  /
>  <  >=  <=  ==  !=
```

Supported functions:

```text
MIN  MAX  AVERAGE  ROUND  ABS  CLAMP  IF
```

Example:

```text
CLAMP(baseline + exercise - food, -1000, 2000)
```

Booleans resolve to `1` or `0` inside formulas. Unknown identifiers, divide-by-zero, unsupported characters, invalid function arity, and circular metric dependencies fail closed.
