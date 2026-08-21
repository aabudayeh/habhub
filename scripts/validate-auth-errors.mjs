import assert from "node:assert/strict";
import fs from "node:fs";

import {
  AUTH_SERVICE_UNAVAILABLE_MESSAGE,
  isAuthServiceUnavailableError,
  readableAuthError,
} from "../src/domain/authErrors.ts";
import {
  cachedAuthIdentityPayload,
  parseCachedAuthIdentity,
  parseSupabaseStoredAuthUser,
  supabaseAuthStorageKey,
} from "../src/domain/offlineAuth.ts";

const cloudflareBody = `<!DOCTYPE html>
<html><head><title>supabase.co | 521: Web server is down</title></head></html>`;

for (const error of [
  cloudflareBody,
  new Error(cloudflareBody),
  { status: 521, message: "request failed" },
  { statusCode: "521", message: "request failed" },
  { message: "Unexpected response", cause: { code: 521 } },
  { message: "Error code 521" },
]) {
  assert.equal(isAuthServiceUnavailableError(error), true);
  assert.equal(readableAuthError(error), AUTH_SERVICE_UNAVAILABLE_MESSAGE);
}

assert.equal(
  readableAuthError(new Error("Failed to fetch")),
  "HabHub could not reach the account service. Check your connection and try again.",
);
assert.equal(
  readableAuthError(new Error("Invalid login credentials")),
  "Invalid login credentials",
);
assert.equal(
  isAuthServiceUnavailableError({
    status: 401,
    message: "Invalid login credentials",
  }),
  false,
);
const cyclicCause = { status: 401, message: "Invalid login credentials" };
cyclicCause.cause = cyclicCause;
assert.equal(isAuthServiceUnavailableError(cyclicCause), false);

const cachedUser = {
  id: "11111111-1111-4111-8111-111111111111",
  aud: "authenticated",
  role: "authenticated",
  email: "offline@example.test",
  app_metadata: { provider: "email" },
  user_metadata: { display_name: "Offline" },
  created_at: "2026-08-01T10:00:00.000Z",
};
const restoredCachedUser = parseCachedAuthIdentity(
  cachedAuthIdentityPayload(cachedUser),
);
assert.equal(restoredCachedUser?.id, cachedUser.id);
assert.equal(restoredCachedUser?.email, cachedUser.email);
assert.deepEqual(restoredCachedUser?.user_metadata, cachedUser.user_metadata);
assert.equal(
  parseSupabaseStoredAuthUser(
    JSON.stringify({
      access_token: "must-not-be-returned",
      refresh_token: "must-not-be-returned",
      user: cachedUser,
    }),
  )?.id,
  cachedUser.id,
  "the first upgraded offline launch may recover only the user from Supabase storage",
);
assert.equal(parseCachedAuthIdentity("{}"), null);
assert.equal(parseSupabaseStoredAuthUser("damaged"), null);
assert.equal(
  supabaseAuthStorageKey("https://project-ref.supabase.co"),
  "sb-project-ref-auth-token",
);

const authSource = fs.readFileSync("src/auth/AuthProvider.tsx", "utf8");
assert.match(authSource, /parseSupabaseStoredAuthUser/);
assert.match(authSource, /networkUnavailableRef\.current && cachedBootstrapUser/);
assert.match(authSource, /networkReachability\(/);
assert.match(authSource, /const networkConfirmedAvailable =/);
assert.match(authSource, /user: session\?\.user \?\? offlineUser/);
assert.match(authSource, /NATIVE_SESSION_WAIT_MS = 1200/);
assert.match(
  authSource,
  /!networkConfirmedAvailable \|\|[\s\S]{0,100}session \|\|[\s\S]{0,100}!offlineUser/,
  "offline cached identity must revalidate only after connectivity is confirmed",
);
assert.match(authSource, /reconnectSessionRef\.current/);
assert.match(
  authSource,
  /const \{ data, error \} = await supabase\.auth\.getSession\(\)[\s\S]{0,900}?setSession\(restored\)[\s\S]{0,900}?setStatus\('signedOut'\)/,
  "reconnect must restore a real session or accept an authoritative online sign-out",
);
assert.match(
  authSource,
  /queuePriorIdentityCleanup\(\)[\s\S]{0,100}?previousUserIdRef\.current = null/,
  "authoritative reconnect sign-out must fence notification identity cleanup first",
);
assert.doesNotMatch(
  authSource,
  /setTimeout\([\s\S]{0,100}setStatus\('signedOut'\)[\s\S]{0,40}8000/,
  "a stalled session read must not force a cached native account to sign out",
);

console.log(
  "Auth validation passed: safe errors and cached offline identity startup are covered.",
);
