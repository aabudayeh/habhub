# HabHub 1.0.21: original avatar, clean live setup and compact shared tools

Branch: `codex/avatar-shape-restoration-20260908`, based on `043d609`.

## User-directed correction

1. Restore the previous human-shaped artwork, preserving its silhouette and
   internal anatomy rather than inventing a new vector figure.
2. Keep profile-based customization and both avatar appearances, with clearer
   visibility of the existing detailed artwork.
3. Remove the Find field and Explore directory from Menu while preserving the
   profile and established settings destinations.
4. Recapture affected screenshots and the complete walkthrough, rebuild the
   promotional assets, validate, then deploy web and request a new preview APK.

### Additional corrections requested during review

5. Give Group Schedule the personal calendar's compact hierarchy; keep view,
   filter and reminder settings available without crowding the calendar.
6. Reuse the personal rich-note composer and formatting toolbar for Group Notes,
   with privately stored image attachments and existing group social actions.
7. Standardize main header icons to Today's 40px surface and 44px touch area.
   Keep Log's full question in its tracker selector; give narrow Leaderboard
   screens a separate action row instead of breaking the title mid-word.
8. Make Guided setup name/interests only, then a clean real Today. Launch the
   actual tracker picker, edit and log screens from short inline tips. Skip on
   an untouched empty guide restores ordinary defaults. Classic remains separate.
9. Clear all personal demo collections for new accounts, narrowly repair only
   positively identified untouched legacy fixtures, and defer health connection
   prompts until guided setup ends. Preserve existing user records and edits.

These additions supersede the earlier provisional media capture and screen
checks below. All affected screenshots and the full walkthrough must be
recaptured from the final runtime before release.

## Implementation

- The runtime selects from the exact 400 original male/female raster assets
  used before the 1.0.20 contour redesign. Their combined regression fingerprint
  is `13d8b2d884cad876559b00eb9887459e0c29c4b9135a74e05ca95db581f0f98e`.
- Each avatar layer renders one original artwork state, uniformly scaled with
  `contain`; no limb stretching, independent axis scaling, outline reconstruction
  or whole-body crossfade is used. The retired vector renderer is removed.
- Detailed appearance retains the source shading with a lighter progress-color
  overlay. Full-resolution source decoding avoids requesting a reduced decode.
  These are the original assets, not newly generated high-resolution anatomy.
- Weight, height, body-fat and lean-mass controls remain. They select bounded
  illustrated body states; nearby values can share an image. This is not a body
  scan, clinical assessment, continuous anatomical prediction or accuracy claim.
- Menu retains its profile and seven settings destinations without introducing
  a replacement feature directory. Quick Guide is second-to-last and Legal &
  Support is the bottom item. Existing navigation customization is intact.
- Simulator sliders and switches now expose explicit web ARIA values and checked
  state alongside their native accessibility props. Previews remain write-free.
- New capture provenance checks match source fingerprints, actual HTTP-served
  export bytes, screenshot hashes and rebuilt videos. Older avatar/menu media
  cannot pass current validation by merely reusing an output filename.
- Group Schedule now uses the personal calendar's date-card/action/grid order.
  Day, Week, Month, filters and group reminder preferences remain accessible in
  its options sheet. Day is the initial view on especially narrow screens.
- Personal and group notes share one formatting toolbar. Group notes support
  bold, italic, headings, lists, quotes, links, image-only notes and image
  previews, with a save/discard guard. Images stay private to eligible group
  members; blocked relationships and ownership are enforced by database rules.
- Group image uploads acquire a short server-side staging lease before upload.
  Bounded cleanup handles abandoned/replaced images, preserves shared media,
  and cannot reuse retired paths. Account reset/deletion leases fence writes.
- Guided setup no longer installs trackers based on interests or borrows demo
  activity. Its short prompts open the same real tracker picker, edit mode and
  log screen used after setup. Classic retains its five-page form. Optional
  unchanged profile fields do not create measurement history.
- Every global tutorial opt-out uses one atomic completion action, including
  Quick Guide. An untouched empty guide gets the same starter trackers as a
  normal skip; existing logs, custom trackers and other personal work survive.
- A real-account refresh does not fill unknown body-fat/lean-mass fields or
  peer profiles from demo defaults. Legacy repair requires an exact reserved
  fixture identity and unchanged content; edited fixtures and their referenced
  parent tasks/plans are preserved. Explicit demo mode keeps its full sample.

## Verification and delivery

The following avatar restoration checks were completed before the additional
layout/setup requests; final integration results are recorded separately below.

- Avatar browser matrix: **16/16** at 320, 390 and 1440 CSS pixels, zero runtime
  errors, 50 captured views and representative visual review including supported
  high-weight/high-fat boundaries. Ten exercised sprite files matched original bytes; all 16
  simulation runs preserved the 710-entry demo ledger and profile exactly.
  Evidence: `store/exports/avatar-artwork-web/report.json`.
- A separate 390-pixel network pass completed **8/8**. Each initial Status render
  requested only its selected original PNG (24,037 encoded response bytes for
  male, 24,783 for female), with no earlier sprite preloads. This observed local
  transfer behavior, not a mobile-device benchmark or million-user load test.
  Evidence: `store/exports/avatar-artwork-web-network-390/report.json`.
- General usability **21/21**, onboarding **12/12**, group calendar **9/9**,
  each across the same three widths, with no recorded runtime errors. These
  include compact Menu navigation, Guided/Classic differences and persisted
  Skip all tutorials. Total with the avatar matrix: **58/58**.
- Avatar calculations, simulator guards, tutorial engine/curriculum, menu
  regression, TypeScript and focused ESLint checks passed. Expo Doctor passed
  18/18; cloud configuration and the configured dependency audit passed.
- The iOS JavaScript/Hermes structural export passed with 455 bundled assets,
  including the original body artwork. It is not a signed iOS binary or device
  test. The frozen web export passed and its served bytes were verified for
  capture.
- The refreshed 29 JPEG sources, 56 PNG deliverables and three montage masters
  passed partial media validation. The 102-second feature tour uses the
  restored silhouette and compact Menu; its Menu caption now describes profile
  and settings rather than the removed directory.

Pending the newly recorded full walkthrough, complete release gate and
independent deployment/build checks. Release URLs and artifact identities will
be recorded after those checks, not inferred from the previous release.

The additional Group Notes image feature requires migration
`202609080011_group_note_images.sql` and the authenticated `group-note-media`
cleanup function, reviewed and applied before client deployment. No account
reset, paid API or paywall is introduced. Physical-device notifications,
background health import, native
accessibility and store/legal/moderation sign-offs remain the release gates
documented in `store/README.md`; a web pass is not a signed-device certification.

### Final backend verification

- Migration `202609080011` was applied to the linked project; all **115** local
  and remote migrations matched afterward, with no unmatched versions.
- `group-note-media` was deployed and independently listed as **ACTIVE**,
  version **1**, function ID `84c29af8-54cd-4624-a09b-1a84e74d912a`.
- A live unauthenticated request returned **401 authentication_required**.
  Authenticated upload/reset scenarios were exercised in isolated SQL/client
  fixtures, not by modifying a real user's production account.
- Independent PostgreSQL-compatible fixture runs cover staged ownership,
  publication, block rules, revision conflicts, bounded abandoned-upload
  cleanup, retired path reuse, shared references and reset/deletion guards.

### Final client integration checks

- Clean-account onboarding: **44/44** focused tests, including exact legacy
  fixture repair, edited-data preservation, neutral real-account hydration,
  changed-only Classic measurements and deferred signed-in health prompts.
- Onboarding browser matrix: **24/24** at 320, 390 and 1440 CSS pixels, with no
  runtime errors. This uses the actual clean-account creation snapshot in a
  local browser fixture; it is not a remote signup or native permission test.
- General usability: **33/33** at the same widths, with no runtime errors. This
  includes the final menu ordering, main header geometry, rich group-note
  format/save/reopen, browser image selection/removal, draft guards, challenge
  profile navigation, safety-card spacing and workout Done controls.
- Group calendar: **12/12** at the same widths, covering compact default views,
  view switching, event editing, empty slots, filters and reminder preferences.
- Updated iOS structural export: **2,661 native modules**, **455 assets**, a
  **13.1 MB Hermes bundle**, and the embedded rich-editor DOM bundle exported.
  This precedes only the final menu-row reorder; no native integration changed.
- Translation coverage: **2,971/2,971** detected UI keys across seven translated
  catalogs. Expo Doctor: **18/18**. Cloud configuration and the configured
  production dependency audit passed. Complete release gate remains pending
  the final continuous walkthrough and full marketing validation.
