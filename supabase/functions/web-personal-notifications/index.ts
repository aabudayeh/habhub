import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

import { constantTimeEqual } from "../_shared/google-health-crypto.ts";

type ScheduledNotification = {
  user_id: string;
  schedule_key: string;
  category: "tracker" | "todo" | "calendar" | "cycle" | "gym" | "timer" | "fasting";
  title: string;
  body: string;
  data: Record<string, unknown>;
  expires_at: string;
  attempt_count: number;
};

type Target = {
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: number | null;
  preferences: Record<string, unknown>;
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function authorized(request: Request) {
  const secret = Deno.env.get("PERSONAL_NOTIFICATION_WORKER_SECRET")?.trim();
  if (!secret || secret.length < 32) return false;
  return constantTimeEqual(
    request.headers.get("Authorization") ?? "",
    `Bearer ${secret}`,
  );
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedLimit(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(100, Math.floor(parsed)))
    : 50;
}

function preferenceAllowed(
  settings: Record<string, unknown>,
  category: ScheduledNotification["category"],
) {
  if (settings.pushEnabled === false) return false;
  if (category === "todo") return settings.todoReminders !== false;
  if (category === "cycle")
    return (
      settings.cyclePredictions !== false || settings.cyclePhaseUpdates === true
    );
  if (category === "gym") return settings.gymReminders !== false;
  if (category === "timer") return true;
  return settings.reminders !== false;
}

function vapidDetails() {
  const publicKey = Deno.env.get("WEB_PUSH_VAPID_PUBLIC_KEY")?.trim();
  const privateKey = Deno.env.get("WEB_PUSH_VAPID_PRIVATE_KEY")?.trim();
  const subject = Deno.env.get("WEB_PUSH_VAPID_SUBJECT")?.trim();
  if (
    !publicKey ||
    !privateKey ||
    !subject ||
    !/^[A-Za-z0-9_-]{80,100}$/.test(publicKey) ||
    !/^[A-Za-z0-9_-]{40,80}$/.test(privateKey) ||
    !validVapidSubject(subject)
  )
    throw new Error("Web Push VAPID secrets are missing or invalid");
  return { publicKey, privateKey, subject };
}

function validVapidSubject(subject: string) {
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(subject)) return true;
  try {
    const parsed = new URL(subject);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname !== "localhost" &&
      parsed.hostname !== "127.0.0.1"
    );
  } catch {
    return false;
  }
}

function base64UrlBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(
    normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    ),
  );
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function validTarget(target: Target) {
  if (
    !/^[A-Za-z0-9_-]{40,200}$/.test(target.p256dh) ||
    !/^[A-Za-z0-9_-]{8,100}$/.test(target.auth)
  )
    return false;
  try {
    const endpoint = new URL(target.endpoint);
    const host = endpoint.hostname.toLowerCase().replace(/\.$/, "");
    const nonPublic =
      !host.includes(".") ||
      host.includes(":") ||
      /^[0-9.]+$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|corp|test|invalid|example)$/.test(
        host,
      );
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.hash ||
      (endpoint.port && endpoint.port !== "443") ||
      nonPublic
    )
      return false;
    const publicKey = base64UrlBytes(target.p256dh);
    const auth = base64UrlBytes(target.auth);
    if (publicKey.length !== 65 || publicKey[0] !== 4 || auth.length !== 16)
      return false;
    await crypto.subtle.importKey(
      "raw",
      publicKey,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    return true;
  } catch {
    return false;
  }
}

async function topicFor(userId: string, scheduleKey: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${userId}:${scheduleKey}`),
    ),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
    .slice(0, 32);
}

async function send(
  target: Target,
  event: ScheduledNotification,
  topic: string,
  details: ReturnType<typeof vapidDetails>,
) {
  if (!(await validTarget(target))) return "stale" as const;
  if (target.expirationTime && target.expirationTime <= Date.now())
    return "stale" as const;
  const expiresAt = new Date(event.expires_at).getTime();
  const ttl = Math.max(
    0,
    Math.min(24 * 60 * 60, Math.ceil((expiresAt - Date.now()) / 1000)),
  );
  try {
    await webpush.sendNotification(
      {
        endpoint: target.endpoint,
        expirationTime: target.expirationTime,
        keys: { p256dh: target.p256dh, auth: target.auth },
      },
      JSON.stringify({
        title: event.title.slice(0, 120),
        body: event.body.slice(0, 220),
        data: objectRecord(event.data),
        tag: topic,
      }),
      { TTL: ttl, urgency: "high", topic, vapidDetails: details },
    );
    return "accepted" as const;
  } catch (error) {
    const status = Number(objectRecord(error).statusCode);
    if (status === 404 || status === 410) return "stale" as const;
    throw new Error(
      Number.isFinite(status)
        ? `Web Push gateway failed: ${status}`
        : "Web Push gateway failed",
    );
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!(await authorized(request))) return json({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return json({ error: "Worker is not configured" }, 503);
  const admin = createClient(url, service);
  let payload: Record<string, unknown> = {};
  try {
    payload = objectRecord(await request.json());
  } catch {
    payload = {};
  }
  const leaseOwner = crypto.randomUUID();
  const { data, error } = await admin.rpc(
    "claim_due_web_personal_notifications",
    { p_limit: boundedLimit(payload.limit), p_lease_owner: leaseOwner },
  );
  if (error) return json({ error: "Could not claim reminders" }, 500);
  const events = (data ?? []) as ScheduledNotification[];
  if (!events.length) return json({ claimed: 0, accepted: 0 });

  let accepted = 0;
  let retried = 0;
  const details = vapidDetails();
  for (const event of events) {
    try {
      const [{ data: subscriptions, error: subscriptionError }, { data: prior, error: priorError }] =
        await Promise.all([
          admin
            .from("web_push_subscriptions")
            .select("endpoint, p256dh, auth, expiration_time, preferences")
            .eq("user_id", event.user_id),
          admin
            .from("web_personal_notification_acceptances")
            .select("endpoint")
            .eq("user_id", event.user_id)
            .eq("schedule_key", event.schedule_key),
        ]);
      if (subscriptionError) throw subscriptionError;
      if (priorError) throw priorError;
      const alreadyAccepted = new Set(
        (prior ?? []).map((item) => String(item.endpoint)),
      );
      const targets: Target[] = (subscriptions ?? []).map((item) => ({
        endpoint: String(item.endpoint),
        p256dh: String(item.p256dh),
        auth: String(item.auth),
        expirationTime: Number.isFinite(Number(item.expiration_time))
          ? Number(item.expiration_time)
          : null,
        preferences: objectRecord(item.preferences),
      }));
      const eligible = targets.filter(
        (target) =>
          !alreadyAccepted.has(target.endpoint) &&
          preferenceAllowed(target.preferences, event.category),
      );
      const topic = await topicFor(event.user_id, event.schedule_key);
      let transient: unknown;
      for (let offset = 0; offset < eligible.length; offset += 20) {
        const batch = eligible.slice(offset, offset + 20);
        const outcomes = await Promise.allSettled(
          batch.map((target) => send(target, event, topic, details)),
        );
        const terminal = outcomes.flatMap((outcome, index) =>
          outcome.status === "fulfilled" ? [batch[index].endpoint] : [],
        );
        if (terminal.length) {
          const acceptance = await admin
            .from("web_personal_notification_acceptances")
            .upsert(
              terminal.map((endpoint) => ({
                user_id: event.user_id,
                schedule_key: event.schedule_key,
                endpoint,
              })),
              {
                onConflict: "user_id,schedule_key,endpoint",
                ignoreDuplicates: true,
              },
            );
          if (acceptance.error) throw acceptance.error;
        }
        const stale = outcomes.flatMap((outcome, index) =>
          outcome.status === "fulfilled" && outcome.value === "stale"
            ? [batch[index].endpoint]
            : [],
        );
        if (stale.length) {
          const cleanup = await admin
            .from("web_push_subscriptions")
            .delete()
            .in("endpoint", stale);
          if (cleanup.error) throw cleanup.error;
        }
        const failed = outcomes.find(
          (outcome): outcome is PromiseRejectedResult =>
            outcome.status === "rejected",
        );
        if (failed) transient = failed.reason;
      }
      if (transient) throw transient;
      const completed = await admin
        .from("web_personal_notification_schedule")
        .update({
          dispatched_at: new Date().toISOString(),
          lease_owner: null,
          lease_until: null,
          last_error: eligible.length ? "gateway_accepted" : "preference_suppressed",
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", event.user_id)
        .eq("schedule_key", event.schedule_key)
        .eq("lease_owner", leaseOwner);
      if (completed.error) throw completed.error;
      accepted += eligible.length;
    } catch (reason) {
      retried += 1;
      const delaySeconds = Math.min(
        3600,
        30 * 2 ** Math.max(0, Math.min(7, event.attempt_count - 1)),
      );
      await admin
        .from("web_personal_notification_schedule")
        .update({
          next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
          lease_owner: null,
          lease_until: null,
          last_error:
            reason instanceof Error ? reason.message.slice(0, 500) : "delivery_failed",
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", event.user_id)
        .eq("schedule_key", event.schedule_key)
        .eq("lease_owner", leaseOwner);
    }
  }

  return json({ claimed: events.length, accepted, retried });
});
