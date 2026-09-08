# Release-candidate capture runbook

## Repeatable web capture

1. Start the release candidate with `pnpm web` and wait for
   `http://127.0.0.1:8081`.
2. Run `pnpm capture:marketing:web`. This opens a clean headless Edge profile,
   selects credential-free demo mode, marks onboarding complete, dismisses the
   tutorial overlay and writes 420 × 911 JPEG candidates below
   `store/exports/capture-candidates/web-420x911/`.
3. Inspect every candidate for loading/error UI, clipped controls, accidental
   personal data, stale navigation and feature/caption mismatch.
4. Run `pnpm capture:marketing:web -- --promote-reviewed` only after that
   review (or use `--promote` to repeat capture directly into the source set).
   The promoted JPEGs are the auditable inputs below
   `store/source-captures/iphone-420x911/`.
5. Run `scripts/build-store-marketing-assets.ps1`, then
   `pnpm validate:marketing`.

The capture process uses reduced motion for stable stills. The deliberate Quick
Guide scene is the only source capture that shows tutorial UI. Every other scene
is the real page without a tutorial spotlight.

## Continuous interactive guide

Keep the same release-candidate web server running, then record the actual
full-app Watch experience:

```powershell
$env:HABHUB_CAPTURE_URL = "http://127.0.0.1:8081"
pnpm.cmd capture:interactive-guide:web -- --probe-today
pnpm.cmd capture:interactive-guide:web
```

Do not begin the long recording unless the short probe reports this exact
boundary sequence: `/ → /view-filters?scope=today → / → /status`. It proves
that Watch mode returns after the full view editor and enters the next module.

The recorder starts a clean temporary Edge profile outside the repository,
selects the credential-free synthetic demo, opens Quick Guide, and clicks the
real `Watch Complete HabHub guide` control. It keeps normal motion enabled and
records the tutorial's animated pointer, automatic page transitions, and
isolated tutorial actions as a continuous CDP screencast. It fails if a step
stalls, if Watch mode disappears before the final step, or if the resulting
walkthrough is shorter than three minutes.

The output is
`store/exports/video/interactive-guide/en-US/habhub-full-interactive-guide-1080x1920.mp4`.
Set `HABHUB_EDGE_PATH`, `HABHUB_INTERACTIVE_CAPTURE_PORT`,
`HABHUB_INTERACTIVE_CAPTURE_TIMEOUT_MS`, or `HABHUB_FFMPEG` only when the
documented defaults do not suit the capture host. Add `--keep-frames` only for
diagnostics; otherwise temporary JPEG frames are removed after encoding.

## Signed-device inserts

Record native-only inserts separately in the final signed binaries. Each clip
must include a visible beginning state, the user action, the operating-system
surface and the resulting app state.

| Insert | Android | iOS | Evidence required before use |
| --- | --- | --- | --- |
| Background health history | Required | Required | Source data timestamped before/after, app not running, later import provenance visible |
| Notification/reminder tap | Required | Required | Scheduled time, delivered system notification, tap route and quiet-hours case |
| Home-screen widget | Required | Not claimed | Real launcher, each promoted size, refresh and tap |
| Progress-video export | Required | Not claimed | Export, permission denial/retry, saved media and clean playback |
| Connected-health consent | Health Connect | Apple Health | Exact requested categories, decline path and imported result |

Web compositions must never be used as substitutes for these proofs. Add a
native insert to a public cut only after its signed-device checklist passes and
its raw recording is archived with the build identifier.

## Delivery review

- Decode every MP4 end to end and confirm H.264 video, AAC audio and 30 fps.
  Confirm the Apple preview is 886 × 1920; Google and the comprehensive tour
  are 1080 × 1920, as is the separate continuous interactive guide.
- Confirm the Apple cut is no longer than 30 seconds.
- Check every PNG is flattened RGB at the declared dimensions.
- Compare the generated SHA-256 manifest to the files submitted to the stores.
- Sample the continuous guide across its whole duration and reject it if a
  tutorial-opened sheet or modal obscures later lessons.
- Re-capture and rebuild after any UI, fixture or claim changes.
