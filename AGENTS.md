# MetricRally repository instructions

- The app targets Expo SDK 54 and React Native 0.81.
- Keep iOS, Android, and web behavior working from the same TypeScript codebase.
- Put pure calculation logic in `src/domain` and keep it independent of React Native.
- Treat privacy values as data-access rules, not merely display preferences.
- Never evaluate user formulas with `eval` or `Function`; use the safe parser.
- Run `pnpm typecheck`, `pnpm lint`, and `pnpm export:web` after material changes.
- Preserve the credential-free demo mode. Supabase is enabled only when both public environment variables exist.
- New database tables must have row-level security policies in the same migration.
