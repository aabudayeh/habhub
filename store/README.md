# HabHub store-release workspace

This directory is the source of truth for App Store and Google Play copy,
capture scenes, review notes, and marketing exports. It does not prove store
approval or device readiness. Every artifact must be regenerated from the
release candidate and checked against the final signed binaries.

## Required sign-offs before capture

- Product owner has finalized the public developer/operator identity, support
  commitment, availability regions, minimum age, and legal entity details.
- Qualified counsel has reviewed the in-app privacy policy and terms. Remove
  their explicit pre-release review notices only after that review is complete.
- A production Android AAB and iOS archive have passed physical-device tests,
  including background health import, notification delivery/taps, reminders,
  photo selection/collage, account deletion, deep links, and accessibility.
- Chat and shared-content release is blocked until the service-only report queue
  has a named, monitored human owner and tested abuse-response process. The
  release candidate contains in-app reporting, blocking, group moderation, and
  a durable operator queue, but code cannot supply the human operation or
  response commitment. Disable social surfaces if that operation is not ready.
- Every requested Apple Health/Health Connect data type is necessary, exercised
  by a visible feature, and declared consistently in store privacy forms.
- The signed iOS archive has been checked for its production APNs entitlement,
  required-reason privacy manifest entries, and transport-security settings.
- The final Android bundle manifest has been checked for only justified
  permissions. `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW` are intentionally
  blocked in Expo config.

## Capture fixture

Use the deterministic tutorial sandbox as the source dataset, but hide tutorial
spotlights, controls, and debug labels during marketing capture. Freeze the
clock and locale, reset the fixture before every run, disable network-dependent
content, and use only synthetic names/photos. Do not capture an aged local demo
or a real account.

Recommended first capture configuration:

- locale: `en-US`
- theme: dark navy
- phone: 6.9-inch iPhone class and 1080 × 1920 Android portrait
- date/time: fixed and internally consistent across every screen
- motion: reduced for screenshots; normal, deliberate pacing for video
- status bar: sanitized carrier/time/battery, with no personal notifications

The scene definitions live in `capture-plan.json`; the exact generated sequence
lives in `video/storyboard.md`. The small source captures in
`source-captures/iphone-420x911/` are JPEGs captured from the real running web
app with the synthetic Ahmad demo profile. They are tracked so the store
compositions can be reproduced and audited without inventing feature UI.

## Generated deliverables

From the repository root on Windows:

```powershell
& .\scripts\build-store-marketing-assets.ps1
node .\scripts\validate-marketing-assets.mjs
```

Set `HABHUB_FFMPEG` to an FFmpeg 6+ executable if `ffmpeg` is not on `PATH`.
The builder uses only the real source captures, HabHub brand assets, captions,
crops, and backgrounds. Generated binaries stay under the ignored
`store/exports/` directory; `manifest.json` records their dimensions, byte
sizes, durations, codecs, and SHA-256 hashes.

The current export set contains:

- 10 Apple 1260 × 2736 portrait PNG screenshots.
- 8 Google Play 1080 × 1920 portrait PNG screenshots.
- 1 Google Play 1024 × 500 PNG feature graphic.
- 1 Apple 1080 × 1920 H.264/AAC master at 29.9 seconds.
- 1 Google 1080 × 1920 H.264/AAC master at 44.9 seconds.

## Export matrix

Create exports under the following untracked/generated directories when the
release candidate is stable:

```text
store/exports/apple/iphone-6.9/en-US/
store/exports/google/phone/en-US/
store/exports/google/feature-graphic/en-US/
store/exports/video/apple/en-US/
store/exports/video/google/en-US/
```

Apple currently accepts 1–10 screenshots per device class. Use a supported
6.9-inch portrait size such as 1260 × 2736. The initial release is explicitly
iPhone-only (`supportsTablet: false`) until the tablet layout, signed binary,
and dedicated iPad artwork receive their own physical-device review.

For Google Play, export at least two 24-bit PNG/JPEG phone screenshots; this plan
uses 1080 × 1920. Also export a 1024 × 500 feature graphic and upload the preview
video through a public or unlisted YouTube URL with ads disabled.

Apple app previews are optional and limited to 30 seconds. Export a
device-compatible H.264 MP4 and validate it in App Store Connect. Google may use
the longer 45–60 second cut described in the storyboard.

Official references:

- Apple screenshot specifications: https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
- Apple previews/screenshots: https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots
- Google Play graphic assets: https://support.google.com/googleplay/android-developer/answer/9866151
- Google Health Connect publishing: https://developer.android.com/health-and-fitness/health-connect/publish

## Truth-in-marketing constraints

- Say “Android home-screen widgets,” not “widgets on every platform.”
- Native progress-video export is Android-only today. Apple creative may show
  photo comparison and collage, but must not promise iOS video export.
- Do not promise continuous or exact background sync. Android and iOS schedule
  work opportunistically; force-stop and OS battery policies can delay it.
- Do not present health, body, calorie, AI, or nutrition estimates as medical
  advice or guaranteed results.
- Do not imply a specific amount or speed of weight loss. Use “track your
  journey” and label the progress sequence as synthetic demo imagery where
  context could otherwise suggest a real testimonial.

## Naming convention

Use two-digit ordering and stable scene IDs, for example:

```text
01-today-personalized.png
02-custom-trackers.png
03-progress-map.png
04-photo-progress.png
```

Keep clean device captures separate from composited store artwork. Source
captures must remain reviewable so each marketing claim can be traced to real
release-candidate UI.
