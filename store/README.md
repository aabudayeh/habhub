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
lives in `video/storyboard.md`, and `video/capture-runbook.md` separates
repeatable web capture from signed-device evidence. The source captures in
`source-captures/iphone-420x911/` are 840 × 1822 JPEGs: the directory names the
420 × 911 CSS viewport, captured at 2× density for crisp store artwork. They
come from the real running web app with the synthetic Ahmad demo profile and
are tracked so the store
compositions can be reproduced and audited without inventing feature UI.

## Generated deliverables

From the repository root on Windows:

```powershell
$env:HABHUB_CAPTURE_URL = 'http://127.0.0.1:8091'
# Keep preview:web serving this workspace's dist on port 8091.
node scripts/marketing-runtime-provenance.mjs --export-web
pnpm.cmd capture:marketing:web
# Inspect store/exports/capture-candidates/web-420x911, then:
pnpm.cmd capture:marketing:web -- --promote-reviewed
node scripts/marketing-runtime-provenance.mjs --render-marketing
pnpm.cmd capture:interactive-guide:web
pnpm.cmd validate:marketing
& .\scripts\package-store-marketing.ps1 -Version 1.0.21
```

Freeze app source and `dist` throughout capture. The export wrapper verifies
source fingerprints and actual served files; avatar/menu captures receive
matching `.capture.json` sidecars. Promotion and rendering reject missing or
stale proof, and the complete guide records the same runtime identity. Include
those sidecars and `changed-surfaces.render.json` in any handoff archive.
`node scripts/marketing-runtime-provenance.mjs --self-test` exercises rejection
of stale source, images, served bundles and generated videos.

The **1.0.21** correction restores the original human avatar artwork and removes
the Menu search/Explore directory. The **1.0.20** archive is an obsolete design
snapshot, not the current promotional set. See
`docs/AVATAR_RESTORATION_1.0.21.md` for current verification and release evidence.

Set `HABHUB_FFMPEG` to an FFmpeg 6+ executable if `ffmpeg` is not on `PATH`.
The capture harness uses bounded, surface-only retries and rejects wrong-size,
blank or near-solid frames by decoding their pixels. Reviewed promotion validates
the whole selected set before replacing any source; `--promote` instead performs
a fresh capture directly into the source folder and is intended for supervised use.
The builder uses only the real source captures, HabHub brand assets, captions,
crops, and backgrounds. Generated binaries stay under the ignored
`store/exports/` directory; `manifest.json` records their dimensions, byte
sizes, durations, codecs, and SHA-256 hashes.

To compare a design revision before replacing the current exports:

```powershell
& .\scripts\build-store-marketing-assets.ps1 -SkipVideo -OutputDirectory store/exports/visual-polish-candidate
```

The builder measures every headline and caption before placing screenshots.
Both are limited to two lines; layouts reserve their real height across Apple,
Google and 4:5 social formats. Social cards use deliberate real-app detail
crops. Photo compositions carry a readable synthetic-photo disclosure.
Source crops use 420 × 911 reference coordinates and scale to the 2× capture.
Dedicated 886 × 1920 video frames keep Apple app previews in proportion.
`-SkipVideo` preserves existing MP4s while refreshing only the still artwork;
rebuild without it before validating or publishing a revised export set.

The current export set contains:

- 10 Apple 1260 × 2736 portrait PNG screenshots.
- 8 Google Play 1080 × 1920 portrait PNG screenshots.
- 1 Google Play 1024 × 500 PNG feature graphic.
- 4 social/app-listing 1080 × 1350 PNG highlights.
- 1 Apple 886 × 1920 H.264/AAC master at 29.9 seconds and 30 fps.
- 1 Google 1080 × 1920 H.264/AAC master at 44.9 seconds.
- 1 still-screen long-form 1080 × 1920 H.264/AAC feature-tour montage
  at 102 seconds, including live Today setup.
- 1 continuous 1080 × 1920 H.264/AAC interactive guide recorded from the
  real full-app Watch tutorial.

The three still-based masters are captions-first; the separate interactive
guide preserves actual app timing, animated tutorial-pointer movement,
automatic page transitions, and isolated tutorial actions. All four carry an
intentionally silent AAC track. No music or voiceover license is implied. If
approved licensed audio is added later, rebuild and revalidate the exact
submission files and update their manifest hashes.

For this release-candidate set, `pnpm.cmd validate:marketing` must report 29 JPEG
source captures, 56 PNG deliverables, and 4 H.264/AAC MP4 masters, then write
`store/exports/manifest.json`. That pass verifies source presence, dimensions,
flattened PNG output, codecs, frame rate, duration, hashes, and full video
decode. It does not prove App Store Connect/Play Console acceptance, signed
native behavior, notification delivery, background execution, or claim
substantiation. Re-run it after any capture, caption, audio, timing, or release
commit changes.

The full 98-step Watch course uses readable pacing; the verified master is 19 minutes 24 seconds.
Its 30-minute recording watchdog is deliberately bounded: enough room for normal
route transitions, but not permission to record indefinitely if a step stalls.
This long support walkthrough is separate from the 30-second Apple preview.
While that recording is still running, `node scripts/validate-marketing-assets.mjs --static-masters`
validates the stills and three montage videos only. It writes
`manifest-static-candidate.json`, never the complete `manifest.json`; the default
four-master validation is still required before handoff.

The remaining native media truth gates are deliberately blocking:

- `[SIGNED ANDROID EVIDENCE REQUIRED]` for background Health Connect behavior
  and Samsung Health-source preference with the app process absent.
- `[SIGNED IOS AND ANDROID EVIDENCE REQUIRED]` for local/push notification
  delivery, taps, reminders, and quiet hours.
- `[SIGNED ANDROID EVIDENCE REQUIRED]` before adding home-screen widgets or
  native progress-photo video export to a promotional video.
- `[SIGNED IOS EVIDENCE REQUIRED]` before adding connected Apple Health import
  to a promotional video.

Keep those features out of the current store video masters until the evidence
is recorded against the exact signed submission binaries. Web captures and a
successful media validator are not substitutes for those tests.

## Export matrix

Create exports under the following untracked/generated directories when the
release candidate is stable:

```text
store/exports/apple/iphone-6.9/en-US/
store/exports/google/phone/en-US/
store/exports/google/feature-graphic/en-US/
store/exports/video/apple/en-US/
store/exports/video/google/en-US/
store/exports/video/feature-tour/en-US/
store/exports/video/interactive-guide/en-US/
store/exports/social/en-US/
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
the longer 45-second cut described in the storyboard. The 102-second feature
tour and continuous interactive Watch guide are for a product page, support
page or organic campaign; neither is an Apple preview asset.

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
