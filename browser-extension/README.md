# HabHub for Chrome and Edge

Version 0.3.4 opens the complete HabHub app as-is in a normal 400 x 560 toolbar
popup, including HabHub's own navigation. There is no extension-specific mode
bar or secondary browser surface: the popup is the same app users open on the
web.

The popup embeds the normal HabHub `/` route and uses the app's existing
authenticated, offline-first sync. The extension does not carry a service key,
duplicate account data, or perform a second competing snapshot write. It runs
only while the popup is open.

## Install locally

1. Extract `habhub-companion-extension.zip` to a permanent folder.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the extracted `browser-extension`
   folder (the folder containing `manifest.json`).
5. Pin **HabHub** to the browser toolbar.
6. Click the HabHub icon to open the complete app in the popup.

Sign in inside the popup or at `https://habhub.expo.app` with the same account
used on the phone.

If the public HabHub URL changes, edit `DEFAULT_APP_URL` in `config.js` and the
matching `host_permissions`/`frame-src` values in `manifest.json` before loading
the extension. No Supabase service key or other private credential belongs in
this directory.
