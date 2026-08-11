import assert from "node:assert/strict";

import {
  AUTH_SERVICE_UNAVAILABLE_MESSAGE,
  isAuthServiceUnavailableError,
  readableAuthError,
} from "../src/domain/authErrors.ts";

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

console.log(
  "Auth error validation passed: gateway HTML and HTTP 521 stay out of account UI.",
);
