# FatSecret food search proxy

The Expo client never receives FatSecret credentials. Configure and deploy the
proxy from a local, ignored env file:

```powershell
@"
FATSECRET_CLIENT_ID=replace-me
FATSECRET_CLIENT_SECRET=replace-me
"@ | Set-Content -Encoding utf8 .env.fatsecret.local

pnpm dlx supabase secrets set --env-file .env.fatsecret.local
pnpm dlx supabase functions deploy fatsecret-food-search --no-verify-jwt
Remove-Item -LiteralPath .env.fatsecret.local
```

Basic and Premier Free credentials use the US English dataset. If FatSecret
later enables paid localization for the account, also configure:

```text
FATSECRET_SCOPE=premier localization
FATSECRET_LOCALIZATION_ENABLED=true
```

The client treats this provider as supplemental: it has a short timeout and
silently falls back to Open Food Facts, optional USDA, cached results, and
offline staples.

FatSecret Basic/Premier Free attribution is required in the product UI, on the
public website, and in the App Store / Play Store listing.
