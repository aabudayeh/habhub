import { createClient } from "npm:@supabase/supabase-js@2";
import { revokeGoogleToken } from "../_shared/google-health-api.ts";
import { constantTimeEqual, decryptSecret } from "../_shared/google-health-crypto.ts";
import { noStoreHeaders } from "../_shared/google-health-http.ts";
import {
  syncGoogleHealthUser,
  type GoogleHealthDateRange,
} from "../_shared/google-health-sync.ts";
import {
  currentDateForProfile,
  googleHealthWebhookEventRange,
} from "../_shared/google-health-webhook-range.ts";
import { readBoundedJson } from "../_shared/google-health-request.ts";

type QueueRow = {
  id: string;
  health_user_id: string;
  data_type: string;
  job_kind?: "webhook" | "initial" | "catchup";
  connection_generation: number | null;
  attempt_count: number;
  payload: Record<string, unknown>;
  created_at: string;
};

type RevocationRow = {
  id: string;
  user_id: string;
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  encryption_key_version: number;
  attempt_count: number;
};

// Provider webhooks remain the low-latency path. This bounded hourly sweep
// keeps closed PWAs current when a notification is delayed or lost.
const BACKGROUND_CATCHUP_MS = 60 * 60_000;

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...noStoreHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function configuredWorkerSecrets() {
  const values = new Set<string>();
  const current = Deno.env.get("GOOGLE_HEALTH_WORKER_SECRET")?.trim();
  if (current) values.add(current);
  const rotating = Deno.env.get("GOOGLE_HEALTH_WORKER_SECRETS")?.trim();
  if (rotating) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rotating);
    } catch {
      throw new Error("GOOGLE_HEALTH_WORKER_SECRETS must be a JSON array");
    }
    if (!Array.isArray(parsed) || parsed.length > 2 || parsed.some((value) =>
      typeof value !== "string" || !value.trim()))
      throw new Error("GOOGLE_HEALTH_WORKER_SECRETS must contain one or two values");
    for (const value of parsed) values.add(value.trim());
  }
  return [...values].slice(0, 2);
}

async function authorizedWorker(value: string) {
  const expected = configuredWorkerSecrets();
  if (!expected.length) return false;
  let matches = false;
  for (const candidate of expected)
    matches = await constantTimeEqual(value, `Bearer ${candidate}`) || matches;
  return matches;
}

function safeWorkerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/not_connected|no rows|PGRST116/i.test(message)) return "connection_missing";
  if (/reauthorization|invalid_grant|revoked|expired/i.test(message)) return "reauthorization_required";
  if (/rate_limited|429|quota/i.test(message)) return "rate_limited";
  if (/sync_busy/i.test(message)) return "sync_busy";
  return "sync_failed";
}

function mergeRange(
  ranges: Map<string, GoogleHealthDateRange>,
  dataType: string,
  incoming: GoogleHealthDateRange | undefined,
) {
  if (!incoming) return;
  const current = ranges.get(dataType);
  ranges.set(dataType, current ? {
    fromDate: current.fromDate < incoming.fromDate ? current.fromDate : incoming.fromDate,
    throughDate: current.throughDate > incoming.throughDate ? current.throughDate : incoming.throughDate,
  } : incoming);
}

function queuedRetryTypes(event: QueueRow) {
  const values = Array.isArray(event.payload?.dataTypes)
    ? event.payload.dataTypes
    : [];
  return values.filter((value): value is string =>
    typeof value === "string" && /^[a-z0-9-]{1,80}$/.test(value)
  );
}

function isProviderNotification(event: QueueRow) {
  // Treat an omitted discriminator as webhook for a safe rolling deployment
  // while PostgREST refreshes the follow-up migration's added columns.
  return !event.job_kind || event.job_kind === "webhook";
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const authorization = request.headers.get("Authorization") ?? "";
  try {
    if (!await authorizedWorker(authorization)) return json({ error: "unauthorized" }, 401);
  } catch {
    return json({ error: "configuration" }, 503);
  }
  let limit = 10;
  if (request.body) {
    let body: unknown;
    try {
      body = await readBoundedJson(request, 8192, { allowEmpty: true });
    } catch (error) {
      const oversized = error instanceof Error && error.message === "request_too_large";
      return json({ error: oversized ? "request_too_large" : "invalid_request" }, oversized ? 413 : 400);
    }
    if (body !== undefined && (!body || typeof body !== "object" || Array.isArray(body)))
      return json({ error: "invalid_request" }, 400);
    const requested = Number((body as { limit?: unknown } | undefined)?.limit);
    if (Number.isFinite(requested))
      limit = Math.min(25, Math.max(1, Math.floor(requested)));
  }
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "configuration" }, 503);
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const oauthStateCleanup = await admin.rpc("purge_expired_google_health_oauth_states");
  if (oauthStateCleanup.error) return json({ error: "oauth_state_cleanup_unavailable" }, 503);
  const staged = await admin.rpc("stage_expired_google_health_grants", { p_limit: limit });
  if (staged.error) return json({ error: "staged_grants_unavailable" }, 503);
  // At most two 15-second provider revocations may precede notification work;
  // an upstream outage therefore cannot consume the whole Edge invocation.
  const revocationLimit = Math.min(limit, 2);
  const claimedRevocations = await admin.rpc("claim_google_health_revocations", {
    p_limit: revocationLimit,
  });
  if (claimedRevocations.error) return json({ error: "revocation_queue_unavailable" }, 503);
  let revoked = 0;
  let revocationRetried = 0;
  for (const credential of (claimedRevocations.data ?? []) as RevocationRow[]) {
    try {
      const token = await decryptSecret({
        ciphertext: credential.refresh_token_ciphertext,
        iv: credential.refresh_token_iv,
        keyVersion: credential.encryption_key_version,
      }, { purpose: "refresh-token", userId: credential.user_id });
      await revokeGoogleToken(token);
      const purged = await admin.from("google_health_revocation_queue").delete().eq("id", credential.id);
      if (purged.error) throw purged.error;
      revoked += 1;
    } catch {
      const delayed = await admin.from("google_health_revocation_queue").update({
        // Revocation credentials are never silently dead-lettered: a
        // multi-day Google/network outage must not strand a live grant.
        status: "pending",
        claimed_at: null,
        available_at: new Date(
          Date.now() + Math.min(1440, 2 ** Math.min(credential.attempt_count, 11)) * 60_000,
        ).toISOString(),
        last_error: "revocation_failed",
      }).eq("id", credential.id);
      if (delayed.error) console.error("Google Health revocation retry state failed");
      revocationRetried += 1;
    }
  }
  const markerCleanup = await admin.rpc("release_google_health_privacy_markers_if_clean", {
    p_user_id: null,
  });
  if (markerCleanup.error) return json({ error: "privacy_marker_cleanup_unavailable" }, 503);
  const runtime = await admin.from("google_health_runtime_config")
    .select("enabled")
    .eq("singleton", true)
    .maybeSingle();
  if (runtime.error) return json({ error: "runtime_configuration_unavailable" }, 503);
  if (runtime.data?.enabled !== true) {
    return json({
      enabled: false,
      oauthStatesPurged: Number(oauthStateCleanup.data ?? 0),
      stagedExpiredGrants: Number(staged.data ?? 0),
      privacyMarkersReleased: Number(markerCleanup.data ?? 0),
      revoked,
      revocationRetried,
      catchupsStaged: 0,
      claimed: 0,
      completed: 0,
      retried: 0,
      dead: 0,
    });
  }
  // The RPC enforces a global one-account-per-minute staging limit even when
  // cron and a low-latency webhook/connection nudge overlap. A staging fault
  // must not delay already-durable provider notifications.
  const catchup = await admin.rpc("stage_due_google_health_catchup");
  const catchupsStaged = catchup.error ? 0 : Number(catchup.data ?? 0);
  if (catchup.error) console.error("Google Health catch-up staging failed");
  const { data, error } = await admin.rpc("claim_google_health_webhook_events", { p_limit: limit });
  if (error) return json({ error: "queue_unavailable" }, 503);
  const rows = (data ?? []) as QueueRow[];
  const byHealthUser = new Map<string, QueueRow[]>();
  for (const row of rows)
    byHealthUser.set(row.health_user_id, [...(byHealthUser.get(row.health_user_id) ?? []), row]);

  let completed = 0;
  let retried = 0;
  let dead = 0;
  for (const [healthUserId, events] of byHealthUser) {
    const { data: connection, error: connectionError } = await admin.from("google_health_connections")
      .select("user_id,status,refresh_token_ciphertext,connection_generation")
      .eq("health_user_id", healthUserId)
      .maybeSingle();
    const failures = new Map<string, string>();
    const retryTypes = new Map<string, string[]>();
    if (connectionError) {
      for (const event of events) failures.set(event.id, "database_unavailable");
    } else if (!connection?.user_id || connection.status === "disconnected" || !connection.refresh_token_ciphertext) {
      for (const event of events) failures.set(event.id, "connection_missing");
    } else {
      const generation = Number(connection.connection_generation);
      const providerEvents = events.filter(isProviderNotification);
      const serverJobs = events.filter((event) =>
        !isProviderNotification(event) && Number(event.connection_generation) === generation
      );
      // A reconnect invalidates an old synthetic job. Provider notifications
      // remain valid because health_user_id is stable for the Google account.
      const work = [...providerEvents, ...serverJobs];
      if (work.length) {
        const profile = await admin.from("profiles")
          .select("timezone")
          .eq("id", connection.user_id)
          .maybeSingle();
        if (profile.error) {
          for (const event of work) failures.set(event.id, "database_unavailable");
        } else try {
          const latestAllowedDate = currentDateForProfile(new Date(), profile.data?.timezone);
          const fullAccountSync = serverJobs.some((event) => queuedRetryTypes(event).length === 0);
          const notifiedTypes = fullAccountSync
            ? undefined
            : new Set([
              ...providerEvents.map((event) => event.data_type),
              ...serverJobs.flatMap(queuedRetryTypes),
            ]);
          const ranges = new Map<string, GoogleHealthDateRange>();
          for (const event of providerEvents) mergeRange(
            ranges,
            event.data_type,
            googleHealthWebhookEventRange(event, latestAllowedDate),
          );
          // Active energy has no webhook type. An activity signal is the
          // closest official trigger, so reconcile it alongside that event.
          const webhookHasActivity = providerEvents.some((event) =>
            event.data_type === "steps" || event.data_type === "exercise"
          );
          if (webhookHasActivity) {
            notifiedTypes?.add("active-energy-burned");
            mergeRange(
              ranges,
              "active-energy-burned",
              ranges.get("steps") ?? ranges.get("exercise"),
            );
          }
          const result = await syncGoogleHealthUser(
            admin,
            connection.user_id,
            notifiedTypes,
            ranges.size ? { ranges } : undefined,
          );
          const errorsByType = new Map(result.errors.map((item) => [item.dataType, item.code]));
          const activeEnergyError = errorsByType.get("active-energy-burned");
          for (const event of providerEvents) {
            const typeError = errorsByType.get(event.data_type) ??
              ((event.data_type === "steps" || event.data_type === "exercise")
                ? activeEnergyError
                : undefined);
            if (typeError) failures.set(event.id, typeError);
          }
          for (const event of serverJobs) {
            if (!result.errors.length) continue;
            failures.set(event.id, result.errors[0].code);
            retryTypes.set(event.id, result.errors.map((item) => item.dataType));
          }
          if (serverJobs.length && serverJobs.every((event) => !failures.has(event.id))) {
            const scheduled = await admin.from("google_health_connections").update({
              next_catchup_at: new Date(Date.now() + BACKGROUND_CATCHUP_MS).toISOString(),
            })
              .eq("user_id", connection.user_id)
              .eq("status", "connected")
              .eq("connection_generation", generation)
              .select("user_id")
              .maybeSingle();
            if (scheduled.error || !scheduled.data) {
              for (const event of serverJobs)
                failures.set(event.id, scheduled.error ? "database_unavailable" : "connection_missing");
            }
          }
        } catch (error) {
          const failure = safeWorkerError(error);
          for (const event of work) failures.set(event.id, failure);
        }
      }
      // Synthetic jobs from an older connection generation are intentionally
      // absent from `work`; they have no work and are acknowledged below.
    }
    const completedIds = events.filter((event) => !failures.has(event.id)).map((event) => event.id);
    if (completedIds.length) {
      const result = await admin.from("google_health_webhook_queue").update({
        status: "completed",
        claimed_at: null,
        completed_at: new Date().toISOString(),
        last_error: null,
        payload: {},
      }).in("id", completedIds);
      if (result.error) console.error("Google Health completion acknowledgement failed");
      else completed += completedIds.length;
    }
    for (const event of events.filter((item) => failures.has(item.id))) {
      const failure = failures.get(event.id)!;
      const ageMs = Date.now() - Date.parse(event.created_at);
      const terminal = failure === "connection_missing" ||
        failure === "reauthorization_required" || ageMs >= 8 * 24 * 60 * 60_000;
      const delayMinutes = Math.min(360, 2 ** Math.min(event.attempt_count, 8)) + Math.random();
      const result = await admin.from("google_health_webhook_queue").update({
        status: terminal ? "dead" : "pending",
        claimed_at: null,
        available_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
        completed_at: terminal ? new Date().toISOString() : null,
        last_error: failure,
        ...(terminal
          ? { payload: {} }
          : isProviderNotification(event)
            ? {}
            : retryTypes.has(event.id)
              ? { payload: { dataTypes: retryTypes.get(event.id) } }
              : {}),
      }).eq("id", event.id);
      if (result.error) console.error("Google Health retry state failed");
      else if (terminal) dead += 1;
      else retried += 1;
    }
  }
  // Payloads are stripped on terminal state, while the notification hash is
  // retained for one year to reject captured signed-message replays well past
  // Google's seven-day retry horizon.
  const retentionCutoff = new Date(Date.now() - 365 * 24 * 60 * 60_000).toISOString();
  const retained = await admin.from("google_health_webhook_queue")
    .delete()
    .in("status", ["completed", "dead"])
    .lt("completed_at", retentionCutoff);
  if (retained.error) console.error("Google Health queue retention cleanup failed");
  return json({
    oauthStatesPurged: Number(oauthStateCleanup.data ?? 0),
    stagedExpiredGrants: Number(staged.data ?? 0),
    privacyMarkersReleased: Number(markerCleanup.data ?? 0),
    revoked,
    revocationRetried,
    catchupsStaged,
    claimed: rows.length,
    completed,
    retried,
    dead,
  });
});
