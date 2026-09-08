# HabHub 1.0.21: original avatar and simpler Menu

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
  a replacement feature directory. Existing navigation customization is intact.
- Simulator sliders and switches now expose explicit web ARIA values and checked
  state alongside their native accessibility props. Previews remain write-free.
- New capture provenance checks match source fingerprints, actual HTTP-served
  export bytes, screenshot hashes and rebuilt videos. Older avatar/menu media
  cannot pass current validation by merely reusing an output filename.

## Verification and delivery

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

No database migration, user-data reset, new paid API or paywall is part of this
correction. Physical-device notifications, background health import, native
accessibility and store/legal/moderation sign-offs remain the release gates
documented in `store/README.md`; a web pass is not a signed-device certification.
