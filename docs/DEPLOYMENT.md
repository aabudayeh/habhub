# Production deployment

Paceboard can still run without credentials, but accounts, cross-device sync, real friend groups, private cloud media, and account deletion require Supabase.

## 1. Create the Supabase project

Create a project, then copy its project URL and **publishable key** from the Connect panel. Never expose the service-role key in the Expo app.

```powershell
Copy-Item .env.example .env
```

Fill in at least:

```text
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Apply every migration and deploy the authenticated deletion function:

```powershell
pnpm.cmd dlx supabase@latest login
pnpm.cmd dlx supabase@latest link --project-ref YOUR_PROJECT_REF
pnpm.cmd dlx supabase@latest db push --dry-run
pnpm.cmd dlx supabase@latest db push
pnpm.cmd dlx supabase@latest functions deploy delete-account
```

The fifth migration adds revisioned account sync, registered devices, realtime group invalidation, idempotent photo/message writes, and RLS-backed group access to private Storage objects. The sixth adds health-source provenance, connection/cursor storage, deduplication constraints, and owner-only RLS.

## 2. Configure authentication

In Supabase Authentication > URL Configuration, set the final web Site URL and allow these redirects:

```text
paceboard://auth-callback
http://localhost:8081/auth-callback
https://YOUR_WEB_DOMAIN/auth-callback
```

For reliable production email, configure a custom SMTP provider. Email/password, sign-up, password reset, and magic links work after email is enabled.

Google and Apple buttons additionally require their providers to be enabled in Supabase. Use the callback URL shown by Supabase when creating the Google/Apple OAuth client. Apple sign-in also requires the corresponding Apple Developer configuration.

## 3. Test the cloud path locally

Restart Expo after changing `.env`:

```powershell
pnpm.cmd start
```

Test with two different accounts:

1. Create an account on device/browser A.
2. Create a **cloud group** and copy its invite code.
3. Join that code from account B.
4. Log an exact-value group metric, a status-only metric, a private metric, a chat image, and a progress photo.
5. Confirm B sees only the authorized versions.
6. Sign into A from a second device and confirm account changes synchronize.
7. Test export, sign-out, and account deletion.

## 4. Configure EAS

Log in and attach the project to your Expo account:

```powershell
pnpm.cmd dlx eas-cli@latest login
pnpm.cmd dlx eas-cli@latest init
pnpm.cmd dlx eas-cli@latest build:configure
pnpm.cmd dlx eas-cli@latest update:configure
```

Add the two public Supabase values to each EAS environment you use. They are public client configuration, not server secrets:

```powershell
pnpm.cmd dlx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value https://YOUR_PROJECT.supabase.co --visibility plaintext
pnpm.cmd dlx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value YOUR_PUBLISHABLE_KEY --visibility plaintext
pnpm.cmd dlx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://YOUR_PROJECT.supabase.co --visibility plaintext
pnpm.cmd dlx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value YOUR_PUBLISHABLE_KEY --visibility plaintext
```

Add the legal/support URL variables from `.env.example` before store submission.

## 5. Build and deploy

Health sync is already configured in `app.json`. It requires a new native EAS build and will not work in Expo Go. Test Apple Health on a physical iPhone. On Android, test Health Connect on Android 8+; Android 14 includes it in the system, while older supported versions may require the Health Connect app.

Before distributing the Android production build, complete Google Play's Health Connect declaration for every requested read category. Confirm Samsung Health, MyFitnessPal, or Google Fit is allowed to write into Health Connect if you want its data to appear. On iOS, allow compatible apps to write into Apple Health and grant Paceboard read access when prompted.

Run the release checks:

```powershell
pnpm.cmd validate:cloud
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd export:web
```

Android preview:

```powershell
pnpm.cmd dlx eas-cli@latest build --profile preview --platform android
```

iOS preview:

```powershell
pnpm.cmd dlx eas-cli@latest build --profile preview --platform ios
```

Production store binaries:

```powershell
pnpm.cmd dlx eas-cli@latest build --profile production --platform all
pnpm.cmd dlx eas-cli@latest submit --profile production --platform android
pnpm.cmd dlx eas-cli@latest submit --profile production --platform ios
```

Static web hosting:

```powershell
pnpm.cmd export:web
pnpm.cmd dlx eas-cli@latest deploy --prod
```

You may instead upload `dist/` to another static host. Add that exact domain to the Supabase redirect allowlist.

## 6. Store-launch responsibilities

Before public release:

- Replace `app.paceboard.mobile` if you want an identifier owned by your domain. Do this before distributing test builds.
- Provide final icons, screenshots, store copy, privacy policy, terms, and a support URL.
- Complete Apple/Google health and nutrition disclosures before enabling device-health imports.
- Configure database backups and a staging Supabase project.
- Review consent, data retention, deletion, incident response, and processor agreements for health-related data.
- Test deep links, OAuth, email confirmation, offline conflicts, large text, photos, RLS boundaries, and deletion on physical iOS and Android devices.

## Troubleshooting

- `pnpm is not recognized`: install Node.js, then run `corepack enable`, or `npm install -g pnpm`.
- PowerShell blocks `pnpm.ps1`: use `pnpm.cmd` as shown above.
- “Apply the latest Supabase migrations”: run `supabase db push`, then restart the app.
- OAuth returns to the browser: verify `paceboard://auth-callback` is allowlisted and rebuild after changing the app scheme.
- A friend cannot see a photo: confirm the photo is group-visible; private Storage URLs are generated only when relational RLS grants access.
