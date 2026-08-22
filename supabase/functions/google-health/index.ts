import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  exchangeAuthorizationCode,
  getGoogleHealthIdentity,
  revokeGoogleToken,
} from "../_shared/google-health-api.ts";
import {
  callbackLocation,
  GOOGLE_HEALTH_SCOPES,
  googleHealthConfig,
  safeReturnTo,
} from "../_shared/google-health-config.ts";
import {
  decryptSecret,
  encryptSecret,
  randomBase64Url,
  sha256Bytes,
  sha256Hex,
  base64UrlEncode,
} from "../_shared/google-health-crypto.ts";
import { connectionStatus, syncGoogleHealthUser } from "../_shared/google-health-sync.ts";
import { corsHeaders, jsonResponse, noStoreHeaders } from "../_shared/google-health-http.ts";
import { readBoundedJson } from "../_shared/google-health-request.ts";

type AdminClient = SupabaseClient;
type Action =
  | "status"
  | "connect"
  | "complete"
  | "sync"
  | "disconnect"
  | "delete"
  | "updateEntry"
  | "dismissEntry"
  | "updateMetricVisibility";

const AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) throw new Error("Supabase server configuration is missing");
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function startGoogleHealthWorker() {
  const url = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const secret = Deno.env.get("GOOGLE_HEALTH_WORKER_SECRET")?.trim();
  if (!url || !secret) return;
  const work = fetch(`${url}/functions/v1/google-health-worker`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ limit: 10 }),
  }).then((response) => response.body?.cancel()).catch(() => undefined);
  const edgeRuntime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(work);
}

async function authenticatedUser(request: Request) {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = request.headers.get("Authorization");
  if (!url || !anonKey || !authorization) return undefined;
  const caller = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await caller.auth.getUser();
  return error ? undefined : data.user;
}

function redirect(location: string) {
  return new Response(null, {
    status: 303,
    headers: { ...noStoreHeaders, Location: location },
  });
}

function completionLocation(returnTo: string, completionToken: string) {
  const url = new URL(returnTo);
  url.searchParams.delete("google_health");
  url.searchParams.delete("reason");
  url.hash = new URLSearchParams({
    google_health: "pending",
    completion: completionToken,
  }).toString();
  return url.toString();
}

function safeFailureReason(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /(?:GOOGLE_HEALTH_(?:CLIENT_ID|CLIENT_SECRET|OAUTH_REDIRECT_URI|WEB_ORIGIN|ALLOWED_REDIRECT_ORIGINS|TOKEN_ENCRYPTION_KEY(?:S|_VERSION)?)|Supabase server configuration|must be an absolute URL|must use HTTPS|encryption key version .* unavailable|No Google Health encryption key)/i.test(message)
  )
    return "configuration";
  if (/token|authorization code|offline refresh/i.test(message)) return "exchange_failed";
  return "provider_error";
}

async function consumeState(admin: AdminClient, rawState: string) {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(rawState)) return undefined;
  const stateHash = await sha256Hex(rawState);
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("google_health_oauth_states")
    .update({ consumed_at: now })
    .eq("state_hash", stateHash)
    .is("consumed_at", null)
    .gt("expires_at", now)
    .select("user_id,verifier_ciphertext,verifier_iv,verifier_key_version,return_to,connection_generation")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function durablyRevokePlainToken(admin: AdminClient, userId: string, token: string) {
  let revocationId: string | undefined;
  try {
    const encrypted = await encryptSecret(token, { purpose: "refresh-token", userId });
    const queued = await admin.from("google_health_revocation_queue").insert({
      user_id: userId,
      refresh_token_ciphertext: encrypted.ciphertext,
      refresh_token_iv: encrypted.iv,
      encryption_key_version: encrypted.keyVersion,
    }).select("id").single();
    if (queued.error) throw queued.error;
    revocationId = queued.data.id;
  } catch {
    // Still attempt immediate revoke. No credential material is logged.
  }
  try {
    await revokeGoogleToken(token);
    if (revocationId)
      await admin.from("google_health_revocation_queue").delete().eq("id", revocationId);
  } catch {
    // A successfully staged encrypted token remains for scheduled retry.
  }
}

async function callback(request: Request) {
  let fallback = "https://habhub.expo.app/settings";
  let exchangedRefreshToken: string | undefined;
  let callbackUserId: string | undefined;
  let callbackAdmin: AdminClient | undefined;
  try {
    const config = googleHealthConfig();
    fallback = `${config.webOrigin}/settings`;
    const url = new URL(request.url);
    const rawState = url.searchParams.get("state") ?? "";
    const admin = adminClient();
    callbackAdmin = admin;
    const state = await consumeState(admin, rawState);
    if (!state) return redirect(callbackLocation(fallback, "error", "invalid_state"));
    callbackUserId = state.user_id;
    const returnTo = safeReturnTo(state.return_to, config);
    const providerError = url.searchParams.get("error");
    if (providerError)
      return redirect(callbackLocation(
        returnTo,
        "error",
        providerError === "access_denied" ? "access_denied" : "provider_error",
      ));
    const code = url.searchParams.get("code");
    if (!code || code.length > 4096)
      return redirect(callbackLocation(returnTo, "error", "exchange_failed"));

    const codeVerifier = await decryptSecret({
      ciphertext: state.verifier_ciphertext,
      iv: state.verifier_iv,
      keyVersion: state.verifier_key_version,
    }, { purpose: "oauth-state", userId: state.user_id, context: await sha256Hex(rawState) });
    const tokens = await exchangeAuthorizationCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      codeVerifier,
      redirectUri: config.oauthRedirectUri,
    });
    exchangedRefreshToken = tokens.refresh_token;
    const identity = await getGoogleHealthIdentity(tokens.access_token);
    const encrypted = await encryptSecret(
      tokens.refresh_token,
      { purpose: "refresh-token", userId: state.user_id },
    );
    const connectedAt = new Date();
    if (typeof tokens.scope !== "string")
      throw new Error("Google token response did not identify granted scopes");
    const requestedScopes = new Set<string>(GOOGLE_HEALTH_SCOPES);
    const grantedScopes = [...new Set(tokens.scope.split(/\s+/).filter((scope) =>
      requestedScopes.has(scope)))] as string[];
    if (!grantedScopes.length)
      throw new Error("Google token response contained no requested scope");
    const refreshTokenExpiresAt = tokens.refresh_token_expires_in
      ? new Date(connectedAt.getTime() + tokens.refresh_token_expires_in * 1000).toISOString()
      : null;
    const completionToken = randomBase64Url(48);
    const completionHash = await sha256Hex(completionToken);
    const staged = await admin.rpc("stage_google_health_pending_grant", {
      p_user_id: state.user_id,
      p_expected_generation: state.connection_generation,
      p_completion_hash: completionHash,
      p_health_user_id: identity.healthUserId,
      p_granted_scopes: grantedScopes,
      p_ciphertext: encrypted.ciphertext,
      p_iv: encrypted.iv,
      p_key_version: encrypted.keyVersion,
      p_refresh_token_expires_at: refreshTokenExpiresAt,
      p_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    if (staged.error) throw staged.error;
    const stagedResult = staged.data as {
      staged?: unknown;
      revocationId?: unknown;
      reason?: unknown;
    } | null;
    if (stagedResult?.staged !== true) {
      // Disconnect/delete/restart won after the authorization response. The
      // RPC already kept an encrypted retry copy; revoke immediately when
      // Google is reachable, then remove only that exact queued credential.
      try {
        await revokeGoogleToken(tokens.refresh_token);
        if (typeof stagedResult?.revocationId === "string") {
          const purged = await admin.from("google_health_revocation_queue")
            .delete()
            .eq("id", stagedResult.revocationId);
          if (purged.error) throw purged.error;
        }
      } catch {
        // The autonomous worker owns the durable retry.
      }
      exchangedRefreshToken = undefined;
      return redirect(callbackLocation(
        returnTo,
        "error",
        stagedResult?.reason === "feature_disabled" ? "configuration" : "invalid_state",
      ));
    }
    exchangedRefreshToken = undefined;
    return redirect(completionLocation(returnTo, completionToken));
  } catch (error) {
    if (exchangedRefreshToken && callbackAdmin && callbackUserId)
      await durablyRevokePlainToken(callbackAdmin, callbackUserId, exchangedRefreshToken);
    return redirect(callbackLocation(fallback, "error", safeFailureReason(error)));
  }
}

async function startConnection(admin: AdminClient, userId: string, requestedReturnTo: unknown) {
  const config = googleHealthConfig();
  const returnTo = safeReturnTo(requestedReturnTo, config);
  const rawState = randomBase64Url(32);
  const verifier = randomBase64Url(64);
  const stateHash = await sha256Hex(rawState);
  const [challenge, encryptedVerifier] = await Promise.all([
    sha256Bytes(verifier).then(base64UrlEncode),
    encryptSecret(verifier, { purpose: "oauth-state", userId, context: stateHash }),
  ]);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const created = await admin.rpc("create_google_health_oauth_state", {
    p_user_id: userId,
    p_state_hash: stateHash,
    p_verifier_ciphertext: encryptedVerifier.ciphertext,
    p_verifier_iv: encryptedVerifier.iv,
    p_verifier_key_version: encryptedVerifier.keyVersion,
    p_return_to: returnTo,
    p_expires_at: expiresAt,
  });
  if (created.error) throw created.error;
  const authorizationUrl = new URL(AUTHORIZATION_URL);
  authorizationUrl.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.oauthRedirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    // This OAuth client is dedicated to Google Health.  Explicitly disable
    // incremental authorization so unrelated scopes from any historical
    // Google grant can never be silently attached to this consent flow.
    include_granted_scopes: "false",
    scope: GOOGLE_HEALTH_SCOPES.join(" "),
    state: rawState,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return authorizationUrl.toString();
}

async function detachAndRevoke(admin: AdminClient, userId: string) {
  const { data, error } = await admin.rpc("detach_google_health_connection", { p_user_id: userId });
  if (error) throw error;
  for (const credential of data ?? []) {
    if (!credential.refresh_token_ciphertext || !credential.refresh_token_iv) continue;
    try {
      const token = await decryptSecret({
        ciphertext: credential.refresh_token_ciphertext,
        iv: credential.refresh_token_iv,
        keyVersion: credential.encryption_key_version,
      }, { purpose: "refresh-token", userId });
      await revokeGoogleToken(token);
      const { error: purgeError } = await admin.from("google_health_revocation_queue")
        .delete()
        .eq("id", credential.revocation_id);
      if (purgeError) throw purgeError;
    } catch {
      // Local detachment already won transactionally and the encrypted token
      // remains in the durable server-only revocation queue for the worker.
    }
  }
  const released = await admin.rpc("release_google_health_privacy_markers_if_clean", {
    p_user_id: userId,
  });
  if (released.error) throw released.error;
}

async function deleteAndRevoke(admin: AdminClient, userId: string) {
  const result = await admin.rpc("delete_google_health_connection_data", { p_user_id: userId });
  if (result.error) throw result.error;
  const payload = (result.data ?? {}) as {
    deletedCount?: unknown;
    revocations?: Array<{
      revocation_id?: unknown;
      refresh_token_ciphertext?: unknown;
      refresh_token_iv?: unknown;
      encryption_key_version?: unknown;
    }>;
  };
  for (const credential of payload.revocations ?? []) {
    if (
      typeof credential.revocation_id !== "string" ||
      typeof credential.refresh_token_ciphertext !== "string" ||
      typeof credential.refresh_token_iv !== "string"
    ) continue;
    try {
      const token = await decryptSecret({
        ciphertext: credential.refresh_token_ciphertext,
        iv: credential.refresh_token_iv,
        keyVersion: Number(credential.encryption_key_version),
      }, { purpose: "refresh-token", userId });
      await revokeGoogleToken(token);
      const purged = await admin.from("google_health_revocation_queue")
        .delete()
        .eq("id", credential.revocation_id);
      if (purged.error) throw purged.error;
    } catch {
      // The RPC committed local deletion and an encrypted durable retry.
    }
  }
  const released = await admin.rpc("release_google_health_privacy_markers_if_clean", {
    p_user_id: userId,
  });
  if (released.error) throw released.error;
  return Number(payload.deletedCount ?? 0);
}

async function completeConnection(admin: AdminClient, userId: string, completionToken: unknown) {
  if (typeof completionToken !== "string" || !/^[A-Za-z0-9_-]{32,512}$/.test(completionToken))
    throw new Error("invalid_completion");
  const completionHash = await sha256Hex(completionToken);
  const bound = await admin.rpc("complete_google_health_connection", {
    p_user_id: userId,
    p_completion_hash: completionHash,
  });
  if (bound.error) throw bound.error;
  if (bound.data !== true) throw new Error("invalid_completion");
  // The pending -> connected transaction atomically inserted an initial job.
  // This nudge keeps first import low latency, while pg_cron and the durable
  // queue remain the retry authority if this request or worker is interrupted.
  startGoogleHealthWorker();
}

async function handleAction(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return jsonResponse(request, { error: "unauthorized" }, 401);
  const admin = adminClient();
  let body: {
    action?: Action;
    redirectUri?: unknown;
    completionToken?: unknown;
    entryId?: unknown;
    metricId?: unknown;
    visibility?: unknown;
    patch?: unknown;
  };
  try {
    const parsed = await readBoundedJson(request);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("invalid_request");
    body = parsed as typeof body;
  } catch (error) {
    return jsonResponse(
      request,
      { error: error instanceof Error && error.message === "request_too_large" ? "request_too_large" : "invalid_request" },
      error instanceof Error && error.message === "request_too_large" ? 413 : 400,
    );
  }
  const action = body.action;
  if (!action || ![
    "status", "connect", "complete", "sync", "disconnect", "delete",
    "updateEntry", "dismissEntry", "updateMetricVisibility",
  ].includes(action))
    return jsonResponse(request, { error: "invalid_action" }, 400);

  try {
    if (action === "status")
      return jsonResponse(request, { connection: await connectionStatus(admin, user.id) });
    if (action === "connect") {
      const authorizationUrl = await startConnection(admin, user.id, body.redirectUri);
      return jsonResponse(request, {
        authorizationUrl,
        connection: await connectionStatus(admin, user.id),
      });
    }
    if (action === "complete") {
      await completeConnection(admin, user.id, body.completionToken);
      return jsonResponse(request, { connection: await connectionStatus(admin, user.id) });
    }
    if (action === "sync") {
      const sync = await syncGoogleHealthUser(admin, user.id, undefined, { manual: true });
      return jsonResponse(request, {
        connection: await connectionStatus(admin, user.id),
        sync,
      });
    }

    if (action === "updateEntry" || action === "dismissEntry") {
      if (typeof body.entryId !== "string" || !body.entryId || body.entryId.length > 360)
        return jsonResponse(request, { error: "invalid_entry_mutation" }, 400);
      if (
        action === "updateEntry" &&
        (!body.patch || typeof body.patch !== "object" || Array.isArray(body.patch))
      ) return jsonResponse(request, { error: "invalid_entry_mutation" }, 400);
      const mutation = await admin.rpc("mutate_google_health_food_family", {
        p_user_id: user.id,
        p_entry_id: body.entryId,
        p_action: action === "updateEntry" ? "update" : "dismiss",
        p_patch: action === "updateEntry" ? body.patch : {},
      });
      if (mutation.error) throw mutation.error;
      const payload = mutation.data && typeof mutation.data === "object" ? mutation.data : {};
      return jsonResponse(request, {
        ...payload,
        connection: await connectionStatus(admin, user.id),
      });
    }

    if (action === "updateMetricVisibility") {
      if (
        typeof body.metricId !== "string" || !body.metricId || body.metricId.length > 160 ||
        !["private", "status", "group"].includes(String(body.visibility))
      ) return jsonResponse(request, { error: "invalid_metric_visibility" }, 400);
      const mutation = await admin.rpc("update_google_health_metric_visibility", {
        p_user_id: user.id,
        p_metric_id: body.metricId,
        p_visibility: body.visibility,
      });
      if (mutation.error) throw mutation.error;
      const payload = mutation.data && typeof mutation.data === "object" ? mutation.data : {};
      return jsonResponse(request, {
        ...payload,
        connection: await connectionStatus(admin, user.id),
      });
    }

    if (action === "disconnect") {
      await detachAndRevoke(admin, user.id);
      return jsonResponse(request, { connection: await connectionStatus(admin, user.id) });
    }

    const deletedCount = await deleteAndRevoke(admin, user.id);
    return jsonResponse(request, {
      connection: await connectionStatus(admin, user.id),
      sync: { imported: 0, deleted: deletedCount, dataTypes: [] },
    });
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    if (/invalid_completion/i.test(raw))
      return jsonResponse(request, { error: "invalid_completion" }, 400);
    if (/authorization_in_progress|already_connected/i.test(raw))
      return jsonResponse(request, { error: raw.includes("already") ? "already_connected" : "authorization_in_progress" }, 409);
    if (/sync_busy/i.test(raw)) return jsonResponse(request, { error: "sync_busy" }, 409);
    if (/rate_limited/i.test(raw)) return jsonResponse(request, { error: "rate_limited" }, 429);
    if (/google_health_(?:entry|metric)_not_found/i.test(raw))
      return jsonResponse(request, { error: /metric/i.test(raw) ? "metric_not_found" : "entry_not_found" }, 404);
    if (/google_health_account_deleting/i.test(raw))
      return jsonResponse(request, { error: "account_deleting" }, 409);
    if (/google_health_feature_disabled|feature_disabled/i.test(raw))
      return jsonResponse(request, { error: "feature_disabled" }, 503);
    if (/invalid_google_health|empty_google_health|time_fields|time_override|override_clear/i.test(raw))
      return jsonResponse(request, { error: "invalid_entry_mutation" }, 400);
    const reason = safeFailureReason(error);
    const status = reason === "configuration" ? 503 : 502;
    return jsonResponse(request, { error: reason }, status);
  }
}

Deno.serve(async (request) => {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  if (path.endsWith("/google-health/oauth/callback")) {
    if (request.method !== "GET") return new Response(null, { status: 405, headers: noStoreHeaders });
    return callback(request);
  }
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== "POST") return jsonResponse(request, { error: "method_not_allowed" }, 405);
  return handleAction(request);
});
