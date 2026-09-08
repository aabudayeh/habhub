# Free core and optional integrations

The current app has no billing SDK, purchase flow, premium entitlement, or paid-tier gate. An audit of app routes, domain code, cloud functions, database migrations, Expo configuration, and dependencies on 8 September 2026 found no core functionality restricted by payment.

The complete everyday workflow remains available without a subscription: configurable trackers and goals, logs and history, charts, workouts and timers, food logging, progress photos, to-dos and subtasks, groups and challenges, chat and social interactions, reminders, tutorials, privacy controls, account data management, and supported health connections. Existing requirements such as sign-in for cloud sharing, active group membership, device permissions, and platform capabilities are access or capability rules, not paid upgrades.

Any future premium offering should add optional extras while preserving these core workflows. A user who declines an upgrade must still be able to use the app, view their full recorded history, manage or export their data, control notifications, and use safety and deletion tools. No premium offer or new commercial service is introduced in this release.

## Deferred integrations

The following are explicitly deferred until the product owner supplies the provider choice, credentials, budget, and implementation approval:

- AI coaching or personalized AI advice.
- Photo-based food recognition and calorie estimation.
- Paid country-specific food databases or commercial nutrition APIs.

Do not advertise these as available, show misleading upgrade buttons, bundle secret keys into Expo/web code, or silently send health data or photos to an external provider. A later implementation needs an explicit user choice, clear data handling, bounded server-side usage, and a usable manual fallback. Existing manual food logging and the currently configured food-search integration remain available.
