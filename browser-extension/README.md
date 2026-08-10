# HabHub Live Companion for Chrome and Edge

Version 0.3.0 opens as a normal 400 x 560 toolbar popup. It contains HabHub's
live Today surface: the featured card, to-dos, filterable/reorderable trackers,
active timers, and today's schedule. The expand button in the popup opens the
same dashboard in a full-height browser side panel, and the external-link
button opens the complete HabHub website.

The popup and side panel embed HabHub's dedicated `/extension` app surface.
That surface uses the same authenticated, offline-first snapshot merge and
Supabase realtime subscription as the mobile app and website. The extension
does not carry a service key, duplicate account data, or perform a second
competing snapshot write. It runs only while its popup or side panel is open.

The companion uses a nonce-bound, origin-checked readiness handshake. It only
reveals the live dashboard after the route confirms a signed-in account and a
hydrated local workspace. Signed-out, onboarding, loading, offline, and route
errors are shown explicitly; a generic document load is never reported as a
ready companion.

## Install locally

1. Extract `habhub-companion-extension.zip` to a permanent folder.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the extracted `browser-extension`
   folder (the folder containing `manifest.json`).
5. Pin **HabHub Live Companion** to the browser toolbar.
6. Click the HabHub icon to open the normal popup.

Use the middle toolbar button to expand into the side panel. Use the right-hand
button to open the full website. Sign in to `https://habhub.expo.app` with the
same account used on the phone. If the companion asks you to sign in, open the
sign-in page once, then click refresh or reopen the popup.

The production companion page is `https://habhub.expo.app/extension`.

If the public HabHub URL changes, edit `DEFAULT_APP_URL` in `config.js` and the
matching `host_permissions`/`frame-src` values in `manifest.json` before loading
the extension. No Supabase service key or other private credential belongs in
this directory.
