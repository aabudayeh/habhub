# HabHub Live Companion for Chrome and Edge

Clicking the HabHub toolbar icon opens a real side-panel companion rather than
redirecting you to another tab. The panel contains the synced Today hero,
to-dos, filterable/reorderable trackers, active timers with start/pause controls,
and today's schedule.

The panel embeds HabHub's dedicated `/extension` app surface. That surface
uses the same authenticated, offline-first snapshot merge and Supabase realtime
subscription as the mobile app and website. Keeping one shared data layer is
important: the extension does not carry a service key, duplicate account data,
or perform a second competing snapshot write. It also does not keep hidden
mobile pages mounted. The dashboard runs only while its browser panel is open.
An explicit route-ready handshake prevents a generic Expo error page from being
shown as a successfully loaded companion.

## Install locally

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this `browser-extension` folder.
4. Pin **HabHub Companion** to the browser toolbar.
5. Click the HabHub icon. The live companion opens in the browser side panel.

Sign in to `https://habhub.expo.app` with the same account used on the phone.
Chrome and Edge share that HabHub web session with the companion when host
access is allowed. If the panel asks you to sign in, use its **Open HabHub sign
in** action once, then press refresh in the panel.

The production companion page is `https://habhub.expo.app/extension`.

If the public HabHub URL changes, edit `DEFAULT_APP_URL` in `config.js` and the
matching `host_permissions`/`frame-src` values in `manifest.json` before loading
the extension. No Supabase service key or other private credential belongs in
this directory.
