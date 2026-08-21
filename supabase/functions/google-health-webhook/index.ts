import { createClient } from "npm:@supabase/supabase-js@2";
import { constantTimeEqual, sha256Hex } from "../_shared/google-health-crypto.ts";
import { noStoreHeaders } from "../_shared/google-health-http.ts";
import { googleHealthWebhookDataTypes } from "../_shared/google-health-sync.ts";
import { verifyGoogleHealthWebhookSignature } from "../_shared/google-health-webhook-signature.ts";

const MAX_BODY_BYTES = 256 * 1024;
const supportedTypes = new Set(googleHealthWebhookDataTypes);

function configuredAuthorizations() {
  const values = new Set<string>();
  const current = Deno.env.get("GOOGLE_HEALTH_WEBHOOK_AUTHORIZATION")?.trim();
  if (current) values.add(current);
  const rotating = Deno.env.get("GOOGLE_HEALTH_WEBHOOK_AUTHORIZATIONS")?.trim();
  if (rotating) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rotating);
    } catch {
      throw new Error("GOOGLE_HEALTH_WEBHOOK_AUTHORIZATIONS must be a JSON array");
    }
    if (!Array.isArray(parsed) || parsed.length > 2 || parsed.some((value) =>
      typeof value !== "string" || !value.trim()))
      throw new Error("GOOGLE_HEALTH_WEBHOOK_AUTHORIZATIONS must contain one or two values");
    for (const value of parsed) values.add(value.trim());
  }
  return [...values].slice(0, 2);
}

async function authorizedWebhook(value: string) {
  const expected = configuredAuthorizations();
  if (!expected.length) return false;
  let matches = false;
  for (const candidate of expected)
    matches = await constantTimeEqual(value, candidate) || matches;
  return matches;
}

function response(status: number) {
  return new Response(null, { status, headers: noStoreHeaders });
}

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function startWorker() {
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
  }).then((result) => result.body?.cancel()).catch(() => undefined);
  const edgeRuntime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(work);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return response(405);
  const authorization = request.headers.get("Authorization") ?? "";
  try {
    if (!await authorizedWebhook(authorization)) return response(401);
  } catch {
    return response(503);
  }
  const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return response(413);
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.length > MAX_BODY_BYTES) return response(413);
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return response(400);
  }
  // Google deliberately omits the signature from subscriber verification;
  // the exact configured Authorization value is the required proof here.
  if (payload.type === "verification") return response(201);

  const signature = request.headers.get("GOOGLE-HEALTH-API-SIGNATURE") ?? "";
  try {
    if (!signature || !await verifyGoogleHealthWebhookSignature(body, signature))
      return response(403);
  } catch {
    return response(503);
  }
  const data = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : undefined;
  const healthUserId = String(data?.healthUserId ?? "");
  const dataType = String(data?.dataType ?? "");
  const operation = String(data?.operation ?? "");
  if (
    data?.version !== "1" ||
    !/^[A-Za-z0-9-]{1,63}$/.test(healthUserId) ||
    !supportedTypes.has(dataType) ||
    !["UPSERT", "DELETE"].includes(operation) ||
    !Array.isArray(data.intervals) ||
    data.intervals.length > 256
  ) return response(400);

  const admin = adminClient();
  const runtime = await admin.from("google_health_runtime_config")
    .select("enabled")
    .eq("singleton", true)
    .maybeSingle();
  if (runtime.error || runtime.data?.enabled !== true) return response(503);
  const notificationHash = await sha256Hex(body);
  const queued = {
    notification_hash: notificationHash,
    health_user_id: healthUserId,
    data_type: dataType,
    operation,
    payload,
    status: "pending",
    available_at: new Date().toISOString(),
  };
  const { error } = await admin.from("google_health_webhook_queue").insert(queued);
  if (error && error.code !== "23505") return response(503);
  // The unique hash is also a one-year replay ledger. Pending work is retried
  // by the queue itself; completed/dead duplicates are acknowledged without
  // reviving quota-consuming provider reads.

  // The durable insert is complete. The 204 is returned immediately; this is
  // only a low-latency nudge, while pg_cron remains the retry/drain authority.
  startWorker();
  return response(204);
});
