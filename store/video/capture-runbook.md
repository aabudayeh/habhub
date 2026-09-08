# Release-candidate capture runbook

## Repeatable web capture

1. Finish the runtime and onboarding checks, then create the frozen web export:
   `node scripts/marketing-runtime-provenance.mjs --export-web`.
   Keep app source and `dist` unchanged until all captures finish. A development
   Metro server is not a substitute for the verified export.
2. In a separate terminal, set `$env:PORT = '8091'` and run
   `pnpm.cmd preview:web`. In the capture terminal, set
   `$env:HABHUB_CAPTURE_URL = 'http://127.0.0.1:8091'`. This serves the actual
   exported files checked by `dist/habhub-marketing-runtime.json`.
3. Run `pnpm.cmd capture:marketing:web`. This opens a clean headless Edge profile,
   selects credential-free demo mode, marks onboarding complete, dismisses the
   tutorial overlay and writes 840 × 1822 JPEG candidates (420 × 911 CSS pixels at 2× density) below
   `store/exports/capture-candidates/web-420x911/`.
4. Inspect every candidate for loading/error UI, clipped controls, accidental
   personal data, stale navigation and feature/caption mismatch.
5. Run `pnpm.cmd capture:marketing:web -- --promote-reviewed` only after that
   review (or use `--promote` to repeat capture directly into the source set).
   The promoted JPEGs are the auditable inputs below
   `store/source-captures/iphone-420x911/`.
6. Run `node scripts/marketing-runtime-provenance.mjs --render-marketing`.
   The wrapper verifies the reviewed avatar/Menu captures and records hashes
   for the rebuilt artwork and all three montage masters. Complete the live
   guide below, then run `pnpm.cmd validate:marketing` before packaging.

The capture process uses reduced motion for stable stills. Quick Guide and
`26-live-setup.jpg` deliberately show learning UI. Live setup starts from the
real clean-account boundary's local fixture, not populated demo history; normal
onboarding gestures then open its first inline Today tip. This never signs up
or mutates a remote account. All other scenes show real pages without a
tutorial spotlight. The group calendar scene explicitly selects Day view and
advances to the next populated demo day, independent of its responsive default.

Record the actual fixture capture date and local time zone in `capture-plan.json`.
Capture timestamps remain in the image/video proof files; do not stamp a reused
image as fresh or silently reuse candidates from an interrupted runtime.

## Continuous interactive guide

Keep the same release-candidate web server running, then record the actual
full-app Watch experience:

```powershell
$env:HABHUB_CAPTURE_URL = "http://127.0.0.1:8091"
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
walkthrough is shorter than three minutes. Successful capture must also confirm
all 98 current lessons and 19 real demonstrations. It records the same frozen
runtime identity as the stills, plus the curriculum and completed video hashes.

The output is
`store/exports/video/interactive-guide/en-US/habhub-full-interactive-guide-1080x1920.mp4`.
Set `HABHUB_EDGE_PATH`, `HABHUB_INTERACTIVE_CAPTURE_PORT`,
`HABHUB_INTERACTIVE_CAPTURE_TIMEOUT_MS`, or `HABHUB_FFMPEG` only when the
documented defaults do not suit the capture host. Add `--keep-frames` only for
diagnostics; otherwise temporary JPEG frames are removed after encoding.
Each run owns a new temporary profile. A disconnected browser rejects pending
commands promptly so cleanup can finish; an interrupted run is not a completed
master and must never be promoted or packaged.

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
