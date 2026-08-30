import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const jsonHeaders = { "Content-Type": "application/json" };

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: jsonHeaders });
}

function positiveLimit(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(500, Math.floor(parsed)))
    : 100;
}

async function dispatchEvent(
  functionsUrl: string,
  serviceRoleKey: string,
  eventKey: string,
) {
  const response = await fetch(`${functionsUrl}/send-push`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ eventKey }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || (body && body.retryable === true))
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : `Push dispatcher returned ${response.status}.`,
    );
  return body;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const configuredSecret =
    Deno.env.get("CHALLENGE_NOTIFICATION_WORKER_SECRET") ?? "";
  const bearer = (request.headers.get("Authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!configuredSecret || bearer !== configuredSecret)
    return json({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRoleKey)
    return json({ error: "Supabase worker configuration is incomplete." }, 500);

  const payload = await request.json().catch(() => ({}));
  const limit = positiveLimit(payload?.limit);
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const staged = await admin.rpc("stage_group_challenge_notifications", {
    p_limit: limit,
  });
  if (staged.error) return json({ error: staged.error.message }, 500);
  // Always drain the shared durable outbox, not only rows inserted by this
  // challenge staging call. Social interactions dispatch immediately from the
  // actor's client, while this bounded hourly pass guarantees a transient
  // provider/network failure remains retryable even if that client closes.
  const pending = await admin
    .from("push_dispatch_events")
    .select("event_key")
    .is("dispatched_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);
  if (pending.error) return json({ error: pending.error.message }, 500);
  const eventKeys = [
    ...new Set(
      [...(pending.data ?? []), ...(staged.data ?? [])]
        .map((row: { event_key?: unknown }) => row.event_key)
        .filter((value: unknown): value is string =>
          typeof value === "string" && value.length > 0
        ),
    ),
  ].slice(0, limit);

  let dispatched = 0;
  const failed: { eventKey: string; error: string }[] = [];
  // Keep batches deliberately small so one provider slowdown cannot exhaust
  // the worker invocation. Canonical event keys make every retry idempotent.
  for (let index = 0; index < eventKeys.length; index += 8) {
    const batch = eventKeys.slice(index, index + 8);
    await Promise.all(
      batch.map(async (eventKey) => {
        try {
          await dispatchEvent(`${url}/functions/v1`, serviceRoleKey, eventKey);
          dispatched += 1;
        } catch (error) {
          failed.push({
            eventKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );
  }

  return json({ staged: eventKeys.length, dispatched, failed });
});
