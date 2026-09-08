# Store review notes — incomplete pre-submission template

Do not upload this file unchanged. Replace each bracketed item with verified
release-candidate information.

## Blocking pre-submission checklist

Every box below must be completed with evidence from the exact signed binaries
submitted for review. An unchecked box or bracketed value means the release is
not ready to submit; none of these entries is a claim of completion.

- [ ] **Review test account:** `[STORE_REVIEW_ACCOUNT]` and
  `[SECURELY PROVIDED IN CONSOLE]` are configured, login is verified, and no
  personal/production-user data is present.
- [ ] **Group review path:** `[INVITE OR PRESEEDED REVIEW GROUP STEPS]` works
  from a clean install for the review account.
- [ ] **Signed artifacts:** `[IOS ARCHIVE BUILD ID / DATE]` and
  `[ANDROID AAB BUILD ID / DATE]` match the store uploads; signing,
  entitlements, permissions, deep links, account reset/deletion, notifications,
  reminders, and background health evidence is attached to the release record.
- [ ] **Human moderation operation:** moderation owner/SLA remains
  `[IMPLEMENT AND VERIFY]` until a named, monitored owner has exercised the
  service-only queue and documented escalation/response coverage.
- [ ] **Support and deletion operations:**
  `[FINALIZE BEFORE SUBMISSION]` is replaced with the monitored mailbox owner,
  manual deletion-request procedure, and response target.
- [ ] **Marketing truth review:** every promoted native-only claim has the
  signed-device evidence required by `capture-plan.json`; the 99-second feature
  tour and the two shorter masters are acknowledged as captions-first videos
  with an intentionally silent AAC track and no implied music/voiceover license.

## Review access

- Review account email: `[STORE_REVIEW_ACCOUNT]`
- Review account password or one-time-code instructions: `[SECURELY PROVIDED IN CONSOLE]`
- Demo mode: choose **Try the full demo first** on the sign-in screen. Demo mode
  does not require a cloud account and should expose representative non-sensitive
  content.
- Group review: `[INVITE OR PRESEEDED REVIEW GROUP STEPS]`

## Authentication in this release

- iOS offers HabHub email/password and magic-link authentication only. Google
  account OAuth is not shown or accepted by the iOS client.
- Google account OAuth is optional on Android and web. Apple account OAuth is
  disabled on every platform until Apple credential revocation is part of the
  verified account-deletion lifecycle.

## Health features

- Apple Health (iPhone): after selecting trackers, tap **Connect Apple Health**
  during setup or **Settings → Connected health data → Connect health data**.
  HabHub requests read access only for the selected categories. Supported
  imports are Steps, active energy, weight, dietary energy/nutrients, water,
  workouts, body fat, lean body mass, blood pressure, resting heart rate,
  sleep, blood glucose, and menstruation.
- Android Health Connect: use the same setup/settings path, grant the selected
  read categories, and grant history/background access when those optional
  features are requested. Supported imports are Steps, active and total
  calories, weight, nutrition, hydration, exercise sessions/distance, body fat,
  lean body mass, body water mass, bone mass, blood pressure, heart rate, sleep,
  blood glucose, and menstruation. Samsung Health is the preferred Steps source
  when it has written the day's aggregate into Health Connect; Health Connect
  and on-device fallbacks remain available instead of fabricating Samsung data.
- Google Health bridge: web-only and hidden unless its production OAuth/backend
  configuration is enabled. Do not describe or submit it as a native store
  feature without a separately approved Google Health production client and
  reviewer test account.
- HabHub requests read-only health access. Reviewers can decline optional access
  and use manual tracking/demo data instead.

## Notifications and background behavior

- Notification test steps: `[VERIFIED STEPS]`
- Reminder test steps: `[VERIFIED STEPS]`
- Background health test steps: `[VERIFIED STEPS]`
- Exact timing is controlled by the operating system; review notes must not
  promise a deadline the signed build cannot meet.

## Account deletion

- In app: Settings → Data controls → Delete cloud account and data.
- Without the app: https://habhub.expo.app/delete-account
- The service removes sent messages and account-authored shared content before
  deleting the authentication identity; a missing or failed purge stops the
  deletion instead of leaving anonymous authored rows.
- Manual request handling owner and response target: `[FINALIZE BEFORE SUBMISSION]`

## Account-data reset (different from deletion)

- In app: **Menu → Cloud account & health sync → Data controls → Clear account
  data**.
- This permanently clears private account data, imported health data,
  reminders/preferences, and registered device/push state while retaining the
  sign-in, group memberships, and manually created content already shared with
  groups. It does not replace **Delete cloud account and data**.
- Review proof: `[DISPOSABLE TEST ACCOUNT, SECOND-DEVICE CHECK, DATE, RESULT]`.
  Export the test account first; never exercise this irreversible reset on a
  production user's account.

## Content safety

- Reporting path: in Chat, open a member message's safety control; in Feed,
  tap the flag on another member's shared update or expand comments and tap the
  flag beside a comment; or open a member profile and choose **Report member**.
  Every cloud report enters a
  service-only operator queue. Eligible group moderators can also act, but a
  moderator cannot decide a report about their account or one they filed.
- Block-user path: open the member profile from Leaderboard/Chat and choose
  **Block**. Their cached and future chat/feed content is hidden immediately;
  direct messages and user-authored pushes are suppressed in both directions.
- Moderation owner/SLA: `[IMPLEMENT AND VERIFY — BLOCKING BEFORE SUBMISSION]`
- Published community standards: `https://habhub.expo.app/community-guidelines`

The reporting/blocking implementation and service-only operator queue are
present and covered by source and PostgreSQL policy tests, including a report
against the group's sole admin. The social release remains blocked until the
final moderation owner/response commitment is supplied, the queue is exercised
by that operator, and the public community-standards URL is tested with the
production review account.
