import { createClient } from "npm:@supabase/supabase-js@2";

import { constantTimeEqual } from "../_shared/google-health-crypto.ts";

type ReceiptQueueRow = {
  ticket_id: string;
  event_key: string;
  delivery_action: "poll" | "resend";
  attempt_count: number;
  action_attempt_count: number;
};

type ReceiptOutcome = {
  ticketId: string;
  status:
    | "provider_accepted"
    | "retry"
    | "terminal_error"
    | "resend"
    | "resend_complete";
  errorCode?: string;
  errorMessage?: string;
};

type ResendResult = {
  eventKey: string;
  complete: boolean;
  message?: string;
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

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function boundedLimit(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(100, Math.floor(parsed)))
    : 100;
}

async function authorized(request: Request) {
  const secret = Deno.env.get("PERSONAL_NOTIFICATION_WORKER_SECRET")?.trim();
  if (!secret || secret.length < 32 || secret.length > 512 || /\s/.test(secret))
    return false;
  return constantTimeEqual(
    request.headers.get("Authorization") ?? "",
    `Bearer ${secret}`,
  );
}

function expoHeaders() {
  const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN")?.trim();
  return {
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

function retryOutcome(
  ticketId: string,
  errorCode: string,
  errorMessage: string,
): ReceiptOutcome {
  return {
    ticketId,
    status: "retry",
    errorCode: normalizedText(errorCode, 120),
    errorMessage: normalizedText(errorMessage, 500),
  };
}

function rateLimitedOutcome(
  ticketId: string,
  errorMessage: string,
): ReceiptOutcome {
  return {
    ticketId,
    status: "resend",
    errorCode: "MessageRateExceeded",
    errorMessage:
      normalizedText(errorMessage, 500) ??
      "Expo rate-limited provider delivery; canonical resend is required.",
  };
}

function sendPushFunctionUrl(supabaseUrl: string) {
  try {
    const parsed = new URL(supabaseUrl);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      !/^[a-z0-9-]+[.]supabase[.]co$/.test(parsed.hostname)
    )
      return undefined;
    return `${parsed.origin}/functions/v1/send-push`;
  } catch {
    return undefined;
  }
}

async function resendCanonicalEvent(
  sendPushUrl: string,
  serviceRoleKey: string,
  receiptLeaseOwner: string,
  eventKey: string,
): Promise<ResendResult> {
  try {
    const response = await fetch(sendPushUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ eventKey, receiptLeaseOwner }),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = objectRecord(await response.json().catch(() => ({})));
    const safelyComplete =
      response.ok && (payload.accepted === true || payload.stale === true);
    return {
      eventKey,
      complete: safelyComplete,
      ...(!safelyComplete
        ? {
            message: normalizedText(payload.error, 420) ??
              `Canonical resend returned HTTP ${response.status}.`,
          }
        : {}),
    };
  } catch (error) {
    return {
      eventKey,
      complete: false,
      message:
        error instanceof Error
          ? normalizedText(error.message, 420)
          : "Canonical resend request failed.",
    };
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

Deno.serve(async (request) => {
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  if (!(await authorized(request))) return json({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return json({ error: "Worker is not configured" }, 503);

  let requestPayload: Record<string, unknown> = {};
  try {
    requestPayload = objectRecord(await request.json());
  } catch {
    requestPayload = {};
  }

  const admin = createClient(url, service);
  const leaseOwner = crypto.randomUUID();
  const { data: claimedData, error: claimError } = await admin.rpc(
    "claim_due_expo_push_receipts",
    {
      p_limit: boundedLimit(requestPayload.limit),
      p_lease_owner: leaseOwner,
    },
  );
  if (claimError) return json({ error: "Could not claim Expo receipts" }, 500);

  const claimed = (claimedData ?? []) as ReceiptQueueRow[];
  if (!claimed.length)
    return json({
      claimed: 0,
      providerAccepted: 0,
      terminalErrors: 0,
      resendQueued: 0,
      resendCompleted: 0,
      retried: 0,
    });

  const pollRows = claimed.filter((item) => item.delivery_action === "poll");
  const resendRows = claimed.filter(
    (item) => item.delivery_action === "resend",
  );
  const outcomes: ReceiptOutcome[] = [];
  let requestFailure: string | undefined;
  if (pollRows.length) {
    try {
      const response = await fetch(
        "https://exp.host/--/api/v2/push/getReceipts",
        {
          method: "POST",
          headers: expoHeaders(),
          body: JSON.stringify({
            ids: pollRows.map((item) => item.ticket_id),
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );
      const payload = objectRecord(await response.json().catch(() => ({})));
      if (!response.ok)
        throw new Error(
          `Expo receipt request failed with HTTP ${response.status}`,
        );
      if (Array.isArray(payload.errors) && payload.errors.length)
        throw new Error("Expo rejected the receipt request");

      const receipts = objectRecord(payload.data);
      outcomes.push(
        ...pollRows.map((item): ReceiptOutcome => {
          if (!Object.hasOwn(receipts, item.ticket_id))
            return retryOutcome(
              item.ticket_id,
              "ReceiptNotReady",
              "Expo has not published this provider receipt yet.",
            );

          const receipt = objectRecord(receipts[item.ticket_id]);
          if (receipt.status === "ok")
            return { ticketId: item.ticket_id, status: "provider_accepted" };
          if (receipt.status === "error") {
            const details = objectRecord(receipt.details);
            const errorCode =
              normalizedText(details.error, 120) ??
              "UnknownExpoReceiptError";
            const errorMessage =
              normalizedText(receipt.message, 500) ??
              "Expo reported a terminal provider delivery error.";
            return errorCode === "MessageRateExceeded"
              ? rateLimitedOutcome(item.ticket_id, errorMessage)
              : {
                  ticketId: item.ticket_id,
                  status: "terminal_error",
                  errorCode,
                  errorMessage,
                };
          }
          return retryOutcome(
            item.ticket_id,
            "MalformedReceipt",
            "Expo returned an unrecognized provider receipt.",
          );
        }),
      );
    } catch (error) {
      requestFailure =
        error instanceof Error ? error.message : "Expo receipt request failed";
      outcomes.push(
        ...pollRows.map((item) =>
          retryOutcome(
            item.ticket_id,
            "ReceiptRequestFailed",
            requestFailure!,
          ),
        ),
      );
    }
  }

  if (resendRows.length) {
    const sendPushUrl = sendPushFunctionUrl(url);
    const eventKeys = [...new Set(resendRows.map((item) => item.event_key))];
    const results = sendPushUrl
      ? await mapWithConcurrency(eventKeys, 20, (eventKey) =>
          resendCanonicalEvent(sendPushUrl, service, leaseOwner, eventKey),
        )
      : eventKeys.map((eventKey) => ({
          eventKey,
          complete: false,
          message: "Canonical resend function URL is invalid.",
        }));
    const byEventKey = new Map(
      results.map((result) => [result.eventKey, result]),
    );
    outcomes.push(
      ...resendRows.map((item): ReceiptOutcome => {
        const result = byEventKey.get(item.event_key);
        return result?.complete
          ? { ticketId: item.ticket_id, status: "resend_complete" }
          : retryOutcome(
              item.ticket_id,
              "CanonicalResendFailed",
              result?.message ?? "Canonical resend request failed.",
            );
      }),
    );
  }

  const { data: settlementData, error: settlementError } = await admin.rpc(
    "settle_expo_push_receipts",
    { p_lease_owner: leaseOwner, p_outcomes: outcomes },
  );
  if (settlementError)
    return json({ error: "Could not settle Expo receipts" }, 500);

  const settlement = objectRecord(settlementData);
  const providerAccepted = outcomes.filter(
    (outcome) => outcome.status === "provider_accepted",
  ).length;
  const terminalErrors = outcomes.filter(
    (outcome) => outcome.status === "terminal_error",
  ).length;
  const resendTransitions = outcomes.filter(
    (outcome) => outcome.status === "resend",
  ).length;
  const retried = outcomes.filter(
    (outcome) => outcome.status === "retry",
  ).length;
  return json(
    {
      claimed: claimed.length,
      providerAccepted,
      terminalErrors,
      resendTransitions,
      resendQueued: Number(settlement.resendQueued ?? 0),
      resendCompleted: Number(settlement.resendCompleted ?? 0),
      retried,
      invalidatedTokens: Number(settlement.invalidatedTokens ?? 0),
      ...(requestFailure ? { error: "Expo receipt request will be retried" } : {}),
    },
    requestFailure ? 502 : 200,
  );
});
