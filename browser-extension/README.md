# HabHub Companion for Chrome and Edge

The side panel opens HabHub's dedicated companion dashboard: the Today card,
to-dos, filtered/reorderable trackers, active timers and today's schedule. It
uses the same Supabase-backed account as the mobile app, so changes use the
existing offline-first sync path. The small toolbar popup keeps fast links to
the full timer, to-do, schedule and website pages.

## Install locally

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this `browser-extension` folder.
4. Pin **HabHub Companion** to the browser toolbar.

The production companion page is `https://habhub.expo.app/extension.html`.

If the public HabHub URL changes, edit `DEFAULT_APP_URL` in `config.js` before
loading the extension. Chrome and Edge may refuse to embed a site when an
organization enforces framing restrictions; the full-website buttons remain a
reliable fallback.
