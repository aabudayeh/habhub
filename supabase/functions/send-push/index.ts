import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// This server function intentionally touches several internal tables without
// a generated database schema. An explicit untyped admin client prevents
// ReturnType from collapsing generic table results to `never` as the Supabase
// client type definitions evolve.
type AdminClient = SupabaseClient<any>;

type PushCategory =
  | "chat"
  | "metric"
  | "lead"
  | "winner"
  | "membership"
  | "challenge";
type Audience =
  | "admins"
  | "user"
  | "group"
  | "group_including_sender"
  | "challenge_participants";
type RequestPayload = {
  eventKey?: unknown;
  clientMessageId?: unknown;
  groupId?: unknown;
};
type CanonicalEvent = {
  eventKey: string;
  groupId: string;
  category: PushCategory;
  eventType: string;
  audience: Audience;
  recipientId?: string;
  metricId?: string;
  title: string;
  body: string;
  titles?: Record<string, string>;
  bodies?: Record<string, string>;
  data: Record<string, string>;
  dispatcherId?: string;
  outboxId?: string;
  outboxCreatedAt?: string;
  requestedLegacyEventKey?: string;
  expiresAt?: string;
};
type PushTicket = {
  id?: string;
  status?: string;
  message?: string;
  details?: { error?: string };
};
type ExpoPushTarget = {
  kind: "expo";
  userId: string;
  token: string;
  preferences: Record<string, unknown>;
};
type WebPushTarget = {
  kind: "web";
  userId: string;
  token: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: number | null;
  preferences: Record<string, unknown>;
};
type PushTarget = ExpoPushTarget | WebPushTarget;
type DevicePushTokenRow = {
  user_id: string;
  token: string;
  preferences: unknown;
};
type WebPushSubscriptionRow = {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expiration_time: number | string | null;
  preferences: unknown;
};
type StoredPushEvent = {
  id: string;
  event_key: string;
  group_id: string;
  dispatcher_id: string;
  category: PushCategory;
  event_type: string;
  audience: Audience;
  recipient_id: string | null;
  metric_slug: string | null;
  title: string;
  body: string;
  data: unknown;
  created_at: string;
  expires_at: string;
  dispatched_at: string | null;
  attempt_count: number;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
const legacyPreMutationMembershipEvents = new Set([
  "membership_left",
  "membership_removed",
  "membership_request_withdrawn",
  "membership_request_declined",
]);
const legacyClaimAdoptionWindowMs = 2 * 60 * 1000;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: cors });
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);

  let claimedEvent: string | undefined;
  let canonical: CanonicalEvent | undefined;
  let admin: AdminClient | undefined;
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    admin = createClient(url, service);
    const auth = request.headers.get("Authorization") ?? "";
    const bearer = auth.replace(/^Bearer\s+/i, "");
    // Scheduled server workers may dispatch only an already-committed
    // canonical outbox row. A service-role request can never synthesize chat
    // or legacy copy, audiences, routes, or recipients from request payload.
    const internalServiceRequest = Boolean(service) && bearer === service;
    let requesterId: string | undefined;
    if (!internalServiceRequest) {
      const {
        data: { user },
        error: userError,
      } = await admin.auth.getUser(bearer);
      if (userError || !user) return json({ error: "Unauthorized" }, 401);
      requesterId = user.id;
    }

    // The acceptance ledger is only a short retry checkpoint. Opportunistic
    // indexed retention avoids an unbounded server-only table without cron.
    const acceptanceRetention = await admin
      .from("push_token_dispatch_acceptances")
      .delete()
      .lt(
        "accepted_at",
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      );
    if (acceptanceRetention.error && !isMissingOutboxError(acceptanceRetention.error))
      throw acceptanceRetention.error;

    const requestPayload = (await request.json()) as RequestPayload;
    const eventKey = normalizedString(requestPayload.eventKey, 240);
    if (!eventKey) return json({ error: "A valid event key is required" }, 400);

    const clientMessageId = normalizedString(
      requestPayload.clientMessageId,
      180,
    );
    if (eventKey.startsWith("message:") || clientMessageId) {
      if (!requesterId)
        return json({ error: "Server workers cannot dispatch chat payloads" }, 403);
      const groupId = normalizedUuid(requestPayload.groupId);
      if (!groupId || !clientMessageId)
        return json(
          { error: "Committed message identity is required" },
          400,
        );
      const messageResult = await canonicalChatEvent(
        admin,
        requesterId,
        groupId,
        clientMessageId,
        eventKey,
      );
      if ("response" in messageResult) return messageResult.response;
      canonical = messageResult.event;
    } else {
      const { data: exactStored, error: storedError } = await admin
        .from("push_dispatch_events")
        .select(
          "id, event_key, group_id, dispatcher_id, category, event_type, audience, recipient_id, metric_slug, title, body, data, created_at, expires_at, dispatched_at, attempt_count",
        )
        .eq("event_key", eventKey)
        .maybeSingle();
      // Required rollout order installs the expand migration before this Edge
      // version and activates emitters only afterward. The missing-table guard
      // is defensive; canonical legacy bridges still derive every field from
      // committed base tables and never accept client copy or audiences.
      if (storedError && !isMissingOutboxError(storedError)) throw storedError;
      let stored: StoredPushEvent | null = exactStored
        ? (exactStored as StoredPushEvent)
        : null;
      if (
        stored &&
        !internalServiceRequest &&
        !(await canDispatchStoredEvent(admin, stored as StoredPushEvent, requesterId!))
      )
        return json({ error: "Push event dispatcher is not authorized" }, 403);
      if (!stored) {
        if (internalServiceRequest)
          return json(
            { error: "Canonical push event is not committed yet", retryable: true },
            409,
          );
        const legacy = await legacyMembershipCanonicalEvent(
          admin,
          requesterId!,
          eventKey,
          requestPayload.groupId,
        );
        if (legacy.recognized && !legacy.row)
          // Old remove/leave clients invoke before their membership mutation.
          // Their bounded retry will find the trigger-owned row post-commit.
          return json({ sent: 0, retryable: true, accepted: false });
        stored = legacy.row ?? null;
        if (!legacy.recognized) {
          const committed = await legacyCommittedCanonicalEvent(
            admin,
            requesterId!,
            eventKey,
            requestPayload.groupId,
          );
          if (committed.recognized && !committed.row)
            return json({ sent: 0, retryable: true, accepted: false });
          stored = committed.row ?? null;
          if (!committed.recognized) {
            const derived = await legacyCompetitionCanonicalEvent(
              admin,
              requesterId!,
              eventKey,
              requestPayload.groupId,
            );
            if (derived.recognized && !derived.row)
              return json({ sent: 0, retryable: true, accepted: false });
            stored = derived.row ?? null;
          }
        }
      }
      if (!stored)
        return json(
          { error: "Canonical push event is not committed yet", retryable: true },
          409,
        );
      canonical = {
        eventKey: stored.event_key,
        groupId: stored.group_id,
        category: stored.category as PushCategory,
        eventType: stored.event_type,
        audience: stored.audience as Audience,
        recipientId: stored.recipient_id ?? undefined,
        metricId: stored.metric_slug ?? undefined,
        title: stored.title,
        body: stored.body,
        data: stringRecord(stored.data),
        dispatcherId: stored.dispatcher_id,
        outboxId: stored.id || undefined,
        outboxCreatedAt: stored.created_at,
        requestedLegacyEventKey:
          stored.event_key !== eventKey ? eventKey : undefined,
        expiresAt: stored.expires_at,
      };
      if (
        canonical.category === "challenge" &&
        (canonical.eventType === "challenge_accepted" ||
          canonical.eventType === "challenge_invitation")
      ) {
        const copy = challengePushCopy(
          canonical.eventType === "challenge_accepted"
            ? "accepted"
            : "started",
          canonical.eventType === "challenge_accepted"
            ? canonical.data.acceptingName
            : undefined,
        );
        canonical.titles = copy.titles;
        canonical.bodies = copy.bodies;
      }
      if (stored.dispatched_at)
        return json({ sent: 0, deduplicated: true, accepted: true });
      if (stored.id) {
        const attemptUpdate = await admin
          .from("push_dispatch_events")
          .update({
            attempt_count: Number(stored.attempt_count ?? 0) + 1,
            last_error: null,
          })
          .eq("id", stored.id);
        if (attemptUpdate.error) throw attemptUpdate.error;
      }
      if (
        canonical.expiresAt &&
        new Date(canonical.expiresAt).getTime() <= Date.now()
      ) {
        await markCanonicalEventAccepted(admin, canonical, "expired");
        return json({ sent: 0, stale: true, accepted: false });
      }
    }

    const preMutationMembershipEvent =
      canonical.category === "membership" &&
      legacyPreMutationMembershipEvents.has(canonical.eventType);
    if (
      preMutationMembershipEvent &&
      canonical.dispatcherId &&
      canonical.outboxCreatedAt
    ) {
      const memberId = normalizedUuid(canonical.data.memberId);
      const triggerPrefix = memberId
        ? `${canonical.eventType.replaceAll("_", "-")}:${canonical.groupId}:${memberId}:`
        : "";
      const triggerSuffix = triggerPrefix
        ? canonical.eventKey.slice(triggerPrefix.length)
        : "";
      const legacyPrefix = memberId
        ? `${
            canonical.eventType === "membership_left" ||
            canonical.eventType === "membership_request_withdrawn"
              ? "membership-left"
              : "membership-removed"
          }:${canonical.groupId}:${memberId}:`
        : "";
      const outboxCreatedAt = new Date(canonical.outboxCreatedAt).getTime();
      const triggerOwned =
        canonical.eventKey.startsWith(triggerPrefix) &&
        normalizedUuid(triggerSuffix) !== undefined;
      if (
        memberId &&
        triggerOwned &&
        Number.isFinite(outboxCreatedAt)
      ) {
        const { data: recentLegacyClaims, error: legacyClaimError } = await admin
          .from("push_events")
          .select("event_key, sender_id, created_at")
          .eq("sender_id", canonical.dispatcherId)
          .like("event_key", `${legacyPrefix}%`)
          .gte(
            "created_at",
            new Date(
              outboxCreatedAt - legacyClaimAdoptionWindowMs,
            ).toISOString(),
          )
          .lte("created_at", canonical.outboxCreatedAt)
          .order("created_at", { ascending: false })
          .limit(8);
        if (legacyClaimError) throw legacyClaimError;
        const matchingLegacyClaim = (recentLegacyClaims ?? []).find((claim) => {
          const claimedAt = new Date(claim.created_at).getTime();
          const claimedEventAt = Number(
            String(claim.event_key).slice(legacyPrefix.length),
          );
          return (
            Number.isFinite(claimedAt) &&
            Number.isFinite(claimedEventAt) &&
            Math.abs(claimedEventAt - claimedAt) <=
              legacyClaimAdoptionWindowMs
          );
        });
        if (matchingLegacyClaim) {
          await markCanonicalEventAccepted(
            admin,
            canonical,
            "legacy_claim_adopted",
          );
          return json({ sent: 0, deduplicated: true, accepted: true });
        }
      }
    }

    if (canonical.requestedLegacyEventKey) {
      const { data: legacyClaim, error: legacyClaimError } = await admin
        .from("push_events")
        .select("created_at")
        .eq("event_key", canonical.requestedLegacyEventKey)
        .maybeSingle();
      if (legacyClaimError) throw legacyClaimError;
      const legacyClaimAt = legacyClaim?.created_at
        ? new Date(legacyClaim.created_at).getTime()
        : Number.NaN;
      const outboxCreatedAt = canonical.outboxCreatedAt
        ? new Date(canonical.outboxCreatedAt).getTime()
        : Number.NaN;
      const legacyPreMutationClaim =
        preMutationMembershipEvent &&
        Number.isFinite(legacyClaimAt) &&
        Number.isFinite(outboxCreatedAt) &&
        legacyClaimAt <= outboxCreatedAt &&
        outboxCreatedAt - legacyClaimAt <= legacyClaimAdoptionWindowMs;
      const legacyNonMembershipClaim =
        canonical.category !== "membership" &&
        Number.isFinite(legacyClaimAt) &&
        Number.isFinite(outboxCreatedAt) &&
        legacyClaimAt <= outboxCreatedAt;
      if (legacyPreMutationClaim || legacyNonMembershipClaim) {
        await markCanonicalEventAccepted(admin, canonical, "legacy_claim_adopted");
        return json({ sent: 0, deduplicated: true, accepted: true });
      }
    }

    const { data: claimed, error: claimError } = await admin
      .from("push_events")
      .upsert(
        {
          event_key: canonical.eventKey,
          sender_id: canonical.dispatcherId ?? requesterId!,
        },
        { onConflict: "event_key", ignoreDuplicates: true },
      )
      .select("event_key");
    if (claimError) throw claimError;
    if (!claimed?.length) {
      const { data: priorClaim, error: priorClaimError } = await admin
        .from("push_events")
        .select("created_at")
        .eq("event_key", canonical.eventKey)
        .maybeSingle();
      if (priorClaimError) throw priorClaimError;
      if (
        priorClaim?.created_at &&
        Date.now() - new Date(priorClaim.created_at).getTime() > 2 * 60 * 1000
      )
        await releaseClaim(admin, canonical.eventKey);
      // The canonical outbox/message row is still pending, so another claim
      // is either in flight or stale. Never mislabel a ticket claim as a
      // completed delivery; a later durable drain will retry safely.
      return json({
        sent: 0,
        deduplicated: true,
        retryable: true,
        accepted: false,
      });
    }
    claimedEvent = canonical.eventKey;

    const recipientIds = await canonicalRecipients(
      admin,
      canonical,
      canonical.dispatcherId ?? requesterId!,
    );
    if (!recipientIds.length) {
      await markCanonicalEventAccepted(admin, canonical, "no_recipients");
      return json({ sent: 0, accepted: true });
    }
    const chatNicknames = await recipientChatNicknames(
      admin,
      canonical,
      recipientIds,
    );

    const { data: tokens, error: tokenError } = await admin
      .from("device_push_tokens")
      .select("user_id, token, preferences, platform")
      .in("user_id", recipientIds);
    if (tokenError) throw tokenError;
    const webSubscriptionResult = await admin
      .from("web_push_subscriptions")
      .select("user_id, endpoint, p256dh, auth, expiration_time, preferences")
      .in("user_id", recipientIds);
    if (
      webSubscriptionResult.error &&
      !isMissingWebPushSubscriptionsError(webSubscriptionResult.error)
    )
      throw webSubscriptionResult.error;
    const targets: PushTarget[] = [
      ...((tokens ?? []) as DevicePushTokenRow[]).map((item) => ({
        kind: "expo" as const,
        userId: item.user_id as string,
        token: item.token as string,
        preferences: objectRecord(item.preferences),
      })),
      ...(webSubscriptionResult.error
        ? []
        : (
            (webSubscriptionResult.data ?? []) as WebPushSubscriptionRow[]
          ).map((item) => {
            const expirationTime = Number(item.expiration_time);
            return {
              kind: "web" as const,
              userId: item.user_id as string,
              token: item.endpoint as string,
              endpoint: item.endpoint as string,
              p256dh: item.p256dh as string,
              auth: item.auth as string,
              expirationTime: Number.isFinite(expirationTime)
                ? expirationTime
                : null,
              preferences: objectRecord(item.preferences),
            };
          })),
    ];
    if (!targets.length) {
      await releaseClaim(admin, canonical.eventKey);
      claimedEvent = undefined;
      return json({ sent: 0, retryable: true, accepted: false });
    }

    // Quiet hours intentionally suppress live group activity. Delayed delivery
    // would require per-recipient queues because one event can span time zones.
    const preferenceEligible = targets.filter(
      (item) =>
        preferenceAllowed(item.preferences ?? {}, canonical!) &&
        !inQuietHours(item.preferences ?? {}),
    );
    const { data: priorAcceptances, error: acceptanceReadError } =
      preferenceEligible.length
        ? await admin
            .from("push_token_dispatch_acceptances")
            .select("token")
            .eq("event_key", canonical.eventKey)
            .in(
              "token",
              preferenceEligible.map((item) => item.token),
            )
        : { data: [], error: null };
    if (acceptanceReadError) throw acceptanceReadError;
    const alreadyAccepted = new Set(
      (priorAcceptances ?? []).map((item) => item.token as string),
    );
    const eligible = preferenceEligible.filter(
      (item) => !alreadyAccepted.has(item.token),
    );
    const expoEligible = eligible.filter(
      (item): item is ExpoPushTarget => item.kind === "expo",
    );
    const webEligible = eligible.filter(
      (item): item is WebPushTarget => item.kind === "web",
    );
    const messages = expoEligible.map((item) => {
      const recipientEvent = eventForPushRecipient(
        canonical!,
        item.userId,
        chatNicknames,
      );
      const language = pushLanguage(item.preferences ?? {});
      return {
        to: item.token,
        sound: "default",
        channelId: "paceboard",
        priority: "high",
        title: pushPreview(
          recipientEvent.titles?.[language] ??
          recipientEvent.titles?.en ??
          recipientEvent.title,
          120,
        ),
        body: pushPreview(
          recipientEvent.bodies?.[language] ??
          recipientEvent.bodies?.en ??
          recipientEvent.body,
          220,
        ),
        data: recipientEvent.data,
      };
    });

    let acceptedTicketCount = 0;
    if (messages.length) {
      for (let offset = 0; offset < messages.length; offset += 100) {
        const batch = messages.slice(offset, offset + 100);
        const response = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(batch),
        });
        if (!response.ok)
          throw new Error(`Expo push failed: ${response.status}`);
        const ticketPayload = (await response.json()) as {
          data?: PushTicket[];
          errors?: unknown[];
        };
        if (ticketPayload.errors?.length)
          throw new Error("Expo rejected the push batch");
        const tickets = ticketPayload.data ?? [];
        if (tickets.length !== batch.length)
          throw new Error("Expo push ticket count mismatch");
        const acceptedTokens = tickets.flatMap((ticket, index) =>
          ticket.status === "ok" ? [batch[index].to] : [],
        );
        const staleTokens = tickets.flatMap((ticket, index) =>
          ticket.status === "error" &&
          ticket.details?.error === "DeviceNotRegistered"
            ? [expoEligible[offset + index]?.token]
            : [],
        ).filter((token): token is string => Boolean(token));
        const terminalTokens = [...acceptedTokens, ...staleTokens];
        if (terminalTokens.length) {
          const acceptanceWrite = await admin
            .from("push_token_dispatch_acceptances")
            .upsert(
              terminalTokens.map((token) => ({
                event_key: canonical!.eventKey,
                token,
              })),
              { onConflict: "event_key,token", ignoreDuplicates: true },
            );
          if (acceptanceWrite.error) throw acceptanceWrite.error;
        }
        acceptedTicketCount += acceptedTokens.length;
        if (staleTokens.length) {
          const staleCleanup = await admin
            .from("device_push_tokens")
            .delete()
            .in("token", staleTokens);
          if (staleCleanup.error) throw staleCleanup.error;
        }
        const transient = tickets.find(
          (ticket) =>
            ticket.status === "error" &&
            ticket.details?.error !== "DeviceNotRegistered",
        );
        if (transient)
          throw new Error(transient.message || "Expo push delivery failed");
      }
    }

    if (webEligible.length) {
      const topic = await webPushTopic(canonical.eventKey);
      const vapidDetails = webPushVapidDetails();
      for (let offset = 0; offset < webEligible.length; offset += 20) {
        const batch = webEligible.slice(offset, offset + 20);
        const outcomes = await Promise.allSettled(
          batch.map((target) =>
            sendWebPushTarget(
              target,
              eventForPushRecipient(
                canonical!,
                target.userId,
                chatNicknames,
              ),
              topic,
              vapidDetails,
            ),
          ),
        );
        const acceptedTokens = outcomes.flatMap((outcome, index) =>
          outcome.status === "fulfilled" && outcome.value === "accepted"
            ? [batch[index].token]
            : [],
        );
        const staleTokens = outcomes.flatMap((outcome, index) =>
          outcome.status === "fulfilled" && outcome.value === "stale"
            ? [batch[index].token]
            : [],
        );
        const terminalTokens = [...acceptedTokens, ...staleTokens];
        if (terminalTokens.length) {
          const acceptanceWrite = await admin
            .from("push_token_dispatch_acceptances")
            .upsert(
              terminalTokens.map((token) => ({
                event_key: canonical!.eventKey,
                token,
              })),
              { onConflict: "event_key,token", ignoreDuplicates: true },
            );
          if (acceptanceWrite.error) throw acceptanceWrite.error;
        }
        if (staleTokens.length) {
          const staleCleanup = await admin
            .from("web_push_subscriptions")
            .delete()
            .in("endpoint", staleTokens);
          if (staleCleanup.error) throw staleCleanup.error;
        }
        acceptedTicketCount += acceptedTokens.length;
        const transient = outcomes.find(
          (outcome): outcome is PromiseRejectedResult =>
            outcome.status === "rejected",
        );
        if (transient)
          throw transient.reason instanceof Error
            ? transient.reason
            : new Error("Web Push delivery failed");
      }
    }

    // `sent` is retained for old clients, but `accepted` is deliberately
    // gateway acceptance/suppression rather than a handset delivery receipt.
    await markCanonicalEventAccepted(
      admin,
      canonical,
      messages.length || webEligible.length
        ? "gateway_accepted"
        : "preference_suppressed",
    );
    return json({ sent: acceptedTicketCount, accepted: true });
  } catch (error) {
    let outboxUpdateError: unknown;
    if (admin && canonical?.outboxId) {
      const outboxUpdate = await admin
        .from("push_dispatch_events")
        .update({
          last_error: error instanceof Error ? error.message : String(error),
        })
        .eq("id", canonical.outboxId);
      outboxUpdateError = outboxUpdate.error;
    }
    let releaseError: unknown;
    if (admin && claimedEvent) {
      try {
        await releaseClaim(admin, claimedEvent);
      } catch (reason) {
        releaseError = reason;
      }
    }
    return json(
      {
        error: error instanceof Error ? error.message : String(error),
        claimReleaseError: releaseError
          ? releaseError instanceof Error
            ? releaseError.message
            : String(releaseError)
          : undefined,
        outboxUpdateError: outboxUpdateError
          ? outboxUpdateError instanceof Error
            ? outboxUpdateError.message
            : String(outboxUpdateError)
          : undefined,
      },
      500,
    );
  }
});

async function canonicalChatEvent(
  admin: AdminClient,
  senderId: string,
  groupId: string,
  clientMessageId: string,
  eventKey: string,
): Promise<{ event: CanonicalEvent } | { response: Response }> {
  // Keep the deployed client identity stable. The authenticated sender and
  // committed relational row are verified separately before this key is used.
  const expectedEventKey = `message:${groupId}:${clientMessageId}`;
  if (eventKey !== expectedEventKey)
    return { response: json({ error: "Message event identity is invalid" }, 403) };
  const { data: membership, error: membershipError } = await admin
    .from("group_members")
    .select("status")
    .eq("group_id", groupId)
    .eq("user_id", senderId)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (membership?.status !== "active")
    return { response: json({ error: "Active group membership required" }, 403) };
  const { data: stored, error: messageError } = await admin
    .from("messages")
    .select(
      "created_at, content, conversation_id, recipient_id, image_path, metadata, push_dispatched_at",
    )
    .eq("group_id", groupId)
    .eq("sender_id", senderId)
    .eq("client_generated_id", clientMessageId)
    .maybeSingle();
  if (messageError) throw messageError;
  if (!stored)
    return {
      response: json(
        { error: "Message is not committed yet", retryable: true },
        409,
      ),
    };
  if (stored.push_dispatched_at)
    return {
      response: json({ sent: 0, deduplicated: true, accepted: true }),
    };
  if (Date.now() - new Date(stored.created_at).getTime() > 15 * 60 * 1000) {
    await markMessageAccepted(admin, groupId, senderId, clientMessageId);
    return { response: json({ sent: 0, stale: true, accepted: false }) };
  }
  const [{ data: profile }, { data: group }] = await Promise.all([
    admin.from("profiles").select("display_name").eq("id", senderId).maybeSingle(),
    admin.from("groups").select("name").eq("id", groupId).maybeSingle(),
  ]);
  const senderName = profile?.display_name?.trim() || "A friend";
  const groupName = group?.name?.trim() || "Your group";
  const direct = Boolean(stored.recipient_id);
  const preview = canonicalChatPreview(stored.content, stored.metadata);
  const text = preview.text;
  const fallbackBodies = preview.fallback
    ? Object.fromEntries(
        Object.entries(localizedChatFallback(preview.fallback)).map(
          ([language, value]) => [
            language,
            direct ? value : `${senderName}: ${value}`,
          ],
        ),
      )
    : undefined;
  return {
    event: {
      eventKey,
      groupId,
      category: "chat",
      eventType: direct ? "direct_message" : "group_message",
      audience: direct ? "user" : "group",
      recipientId: stored.recipient_id ?? undefined,
      title: pushPreview(
        direct
          ? `Direct message from ${senderName}`
          : `Group message in ${groupName}`,
        120,
      ),
      body: pushPreview(direct ? text : `${senderName}: ${text}`, 220),
      bodies: fallbackBodies,
      data: {
        route: "/chat",
        category: "chat",
        groupId,
        messageId: clientMessageId,
        senderId,
        senderName,
        conversationType: direct ? "direct" : "group",
        ...(direct ? { recipient: senderId } : {}),
        conversationId:
          stored.conversation_id || (direct ? `direct:${senderId}` : `group:${groupId}`),
      },
    },
  };
}

async function legacyMembershipCanonicalEvent(
  admin: AdminClient,
  dispatcherId: string,
  eventKey: string,
  requestedGroupId: unknown,
): Promise<{ recognized: boolean; row?: StoredPushEvent }> {
  const mapping: Record<string, string[]> = {
    "membership-request": ["membership_request"],
    "membership-joined": ["membership_joined"],
    "membership-approved": ["membership_approved"],
    "membership-left": [
      "membership_left",
      "membership_request_withdrawn",
    ],
    "membership-removed": [
      "membership_removed",
      "membership_request_declined",
    ],
  };
  const parts = eventKey.split(":");
  const eventTypes = mapping[parts[0] ?? ""];
  if (!eventTypes) return { recognized: false };
  const groupId = normalizedUuid(requestedGroupId);
  const subjectId = normalizedUuid(parts[2]);
  const suffix = parts[3] ?? "";
  const timestamp = Number(suffix);
  const legacyDate = /^\d{4}-\d{2}-\d{2}$/.test(suffix)
    ? Date.parse(`${suffix}T12:00:00Z`)
    : Number.NaN;
  const requestOrJoin = [
    "membership-request",
    "membership-joined",
  ].includes(parts[0] ?? "");
  const boundedIdentityTime =
    (Number.isFinite(timestamp) &&
      Math.abs(Date.now() - timestamp) <= 48 * 60 * 60 * 1000) ||
    (requestOrJoin &&
      Number.isFinite(legacyDate) &&
      Math.abs(Date.now() - legacyDate) <= 60 * 60 * 60 * 1000);
  const actorIsSubject = [
    "membership-request",
    "membership-joined",
    "membership-left",
  ].includes(parts[0] ?? "");
  if (
    parts.length !== 4 ||
    !groupId ||
    parts[1] !== groupId ||
    !subjectId ||
    !boundedIdentityTime ||
    (actorIsSubject && subjectId !== dispatcherId)
  )
    return { recognized: true };
  const { data, error } = await admin
    .from("push_dispatch_events")
    .select(
      "id, event_key, group_id, dispatcher_id, category, event_type, audience, recipient_id, metric_slug, title, body, data, created_at, expires_at, dispatched_at, attempt_count",
    )
    .eq("dispatcher_id", dispatcherId)
    .eq("group_id", groupId)
    .eq("category", "membership")
    .in("event_type", eventTypes)
    .contains("data", { memberId: subjectId })
    // A dispatched trigger row is still canonical proof: returning it lets the
    // main path deduplicate an old APK retry instead of synthesizing a second
    // legacy-key event.
    .gte(
      "created_at",
      new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    )
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && !isMissingOutboxError(error)) throw error;
  if (data)
    return { recognized: true, row: data as StoredPushEvent };

  const { data: dispatchConfiguration, error: configurationError } = await admin
    .from("push_dispatch_configuration")
    .select("emitters_active, updated_at")
    .eq("singleton", true)
    .maybeSingle();
  if (configurationError) throw configurationError;
  const { data: transition, error: transitionError } = await admin
    .from("group_membership_transitions")
    .select("event_type, created_at")
    .eq("actor_id", dispatcherId)
    .eq("group_id", groupId)
    .eq("member_id", subjectId)
    .in("event_type", eventTypes)
    .gte(
      "created_at",
      new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (transitionError) throw transitionError;
  if (!transition) return { recognized: true };
  // A transition committed during the expand window has no outbox and remains
  // valid even if activation wins the race before an old APK retry. Newer
  // transitions must use their transaction-owned trigger row exclusively.
  if (
    dispatchConfiguration?.emitters_active === true &&
    new Date(transition.created_at).getTime() >=
      new Date(dispatchConfiguration.updated_at).getTime()
  )
    return { recognized: true };

  const [
    { data: group, error: groupError },
    { data: subject, error: subjectError },
  ] = await Promise.all([
    admin.from("groups").select("name").eq("id", groupId).maybeSingle(),
    admin
      .from("profiles")
      .select("display_name")
      .eq("id", subjectId)
      .maybeSingle(),
  ]);
  if (groupError) throw groupError;
  if (subjectError) throw subjectError;
  if (!group || !subject) return { recognized: true };

  const groupName = group.name?.trim() || "your group";
  const memberName = subject.display_name?.trim() || "A member";
  const eventType = String(transition.event_type);
  let audience: Audience;
  let recipientId: string | null = null;
  let title: string;
  let body: string;
  let route: string;
  if (eventType === "membership_request") {
    audience = "admins";
    title = `${memberName} wants to join`;
    body = `Review the request for ${groupName}.`;
    route = "/group-settings";
  } else if (eventType === "membership_joined") {
    audience = "admins";
    title = `${memberName} joined`;
    body = `${memberName} is now in ${groupName}.`;
    route = "/group-settings";
  } else if (eventType === "membership_approved") {
    audience = "user";
    recipientId = subjectId;
    title = `Welcome to ${groupName}`;
    body = "Your request was approved. Tap to open the group.";
    route = "/group";
  } else if (eventType === "membership_left") {
    audience = "admins";
    title = `${memberName} left`;
    body = `${memberName} left ${groupName}.`;
    route = "/group-settings";
  } else if (eventType === "membership_request_withdrawn") {
    audience = "admins";
    title = `${memberName} withdrew a join request`;
    body = `The join request for ${groupName} was withdrawn.`;
    route = "/group-settings";
  } else if (eventType === "membership_request_declined") {
    audience = "user";
    recipientId = subjectId;
    title = "Join request updated";
    body = `Your request to join ${groupName} was declined.`;
    route = "/groups";
  } else {
    audience = "user";
    recipientId = subjectId;
    title = "Group membership updated";
    body = `You are no longer in ${groupName}.`;
    route = "/groups";
  }
  return {
    recognized: true,
    row: await storeCanonicalLegacyEvent(admin, {
      event_key: eventKey,
      group_id: groupId,
      dispatcher_id: dispatcherId,
      category: "membership",
      event_type: eventType,
      audience,
      recipient_id: recipientId,
      metric_slug: null,
      title,
      body,
      data: {
        route,
        groupId,
        memberId: subjectId,
        membershipEvent: eventType,
      },
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    }),
  };
}

async function legacyCommittedCanonicalEvent(
  admin: AdminClient,
  dispatcherId: string,
  eventKey: string,
  requestedGroupId: unknown,
): Promise<{ recognized: boolean; row?: StoredPushEvent }> {
  const groupId = normalizedUuid(requestedGroupId);
  if (!groupId) return { recognized: false };
  if (eventKey.startsWith("entry:")) {
    const prefix = `entry:${groupId}:${dispatcherId}:`;
    if (!eventKey.startsWith(prefix)) return { recognized: true };
    const clientGeneratedId = eventKey.slice(prefix.length);
    if (!clientGeneratedId) return { recognized: true };
    const { data: membership, error: membershipError } = await admin
      .from("group_members")
      .select("status")
      .eq("group_id", groupId)
      .eq("user_id", dispatcherId)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (membership?.status !== "active") return { recognized: true };
    const { data: entry, error: entryError } = await admin
      .from("metric_entries")
      .select("metric_id, local_date, recorded_at, visibility, source_provider")
      .eq("user_id", dispatcherId)
      .eq("client_generated_id", clientGeneratedId)
      .maybeSingle();
    if (entryError) throw entryError;
    if (
      !entry ||
      entry.source_provider === "google_health" ||
      entry.visibility === "private" ||
      !Number.isFinite(new Date(entry.recorded_at).getTime()) ||
      new Date(entry.recorded_at).getTime() < Date.now() - 15 * 60 * 1000
    )
      return { recognized: true };
    const { data: metric, error: metricError } = await admin
      .from("metric_definitions")
      .select("slug, name, group_id")
      .eq("id", entry.metric_id)
      .eq("group_id", groupId)
      .maybeSingle();
    if (metricError) throw metricError;
    if (!metric) return { recognized: true };
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", dispatcherId)
      .maybeSingle();
    if (profileError) throw profileError;
    return {
      recognized: true,
      row: await storeCanonicalLegacyEvent(admin, {
        event_key: eventKey,
        group_id: groupId,
        dispatcher_id: dispatcherId,
        category: "metric",
        event_type: "metric_entry",
        audience: "group",
        recipient_id: null,
        metric_slug: metric.slug,
        title: pushPreview(
          `${profile?.display_name?.trim() || "A member"} logged ${metric.name}`,
          120,
        ),
        body: `A shared ${metric.name} update was added.`,
        data: {
          route: `/day/${entry.local_date}`,
          groupId,
          metricId: metric.slug,
          entryId: clientGeneratedId,
        },
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }),
    };
  }

  const started = /^challenge-started:([0-9a-f-]{36})$/i.exec(eventKey);
  const accepted =
    /^challenge-accepted:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(eventKey);
  if (!started && !accepted) return { recognized: false };
  const challengeId = normalizedUuid(started?.[1] ?? accepted?.[1]);
  const acceptingUserId = normalizedUuid(accepted?.[2]);
  if (!challengeId || (accepted && acceptingUserId !== dispatcherId))
    return { recognized: true };
  const { data: membership, error: membershipError } = await admin
    .from("group_members")
    .select("status")
    .eq("group_id", groupId)
    .eq("user_id", dispatcherId)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (membership?.status !== "active") return { recognized: true };
  const { data: challenge, error: challengeError } = await admin
    .from("group_challenges")
    .select(
      "group_id, creator_id, participant_ids, accepted_participant_ids, created_at, updated_at, deleted_at",
    )
    .eq("id", challengeId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (challengeError) throw challengeError;
  if (!challenge || challenge.deleted_at) return { recognized: true };
  const acceptedIds = Array.isArray(challenge.accepted_participant_ids)
    ? challenge.accepted_participant_ids
    : [];
  const valid = started
    ? challenge.creator_id === dispatcherId &&
      Date.now() - new Date(challenge.created_at).getTime() <= 30 * 60 * 1000
    : acceptedIds.includes(dispatcherId) &&
      Date.now() - new Date(challenge.updated_at).getTime() <= 30 * 60 * 1000;
  if (!valid) return { recognized: true };
  let acceptingName: string | undefined;
  if (accepted) {
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("display_name")
      .eq("id", dispatcherId)
      .maybeSingle();
    if (profileError) throw profileError;
    acceptingName = profile?.display_name?.trim() || undefined;
  }
  return {
    recognized: true,
    row: await storeCanonicalLegacyEvent(admin, {
      event_key: eventKey,
      group_id: groupId,
      dispatcher_id: dispatcherId,
      category: "challenge",
      event_type: started ? "challenge_started" : "challenge_accepted",
      audience: started ? "challenge_participants" : "user",
      recipient_id: started ? null : challenge.creator_id,
      metric_slug: null,
      title: started ? "Challenge started" : "Challenge accepted",
      body: started
        ? "Open HabHub to accept or decline."
        : acceptingName
          ? `${acceptingName} accepted your challenge.`
          : "A friend accepted your challenge.",
      data: {
        route: "/challenges",
        groupId,
        challengeId,
        challengeEvent: started ? "started" : "accepted",
        ...(acceptingName ? { acceptingName } : {}),
      },
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),
  };
}

async function legacyCompetitionCanonicalEvent(
  admin: AdminClient,
  dispatcherId: string,
  eventKey: string,
  requestedGroupId: unknown,
): Promise<{ recognized: boolean; row?: StoredPushEvent }> {
  const parts = eventKey.split(":");
  if (!["lead", "winner"].includes(parts[0] ?? ""))
    return { recognized: false };
  const groupId = normalizedUuid(requestedGroupId);
  if (!groupId || parts[1] !== groupId) return { recognized: true };
  const { data: membership, error: membershipError } = await admin
    .from("group_members")
    .select("status")
    .eq("group_id", groupId)
    .eq("user_id", dispatcherId)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (membership?.status !== "active") return { recognized: true };

  if (parts[0] === "lead") {
    const claimedSenderId = normalizedUuid(parts[2]);
    const metricSlug = normalizedString(parts[3], 120);
    const claimedLeaderId = normalizedUuid(parts[4]);
    const sourceAndTimeSuffix = parts.slice(5).join(":");
    if (
      claimedSenderId !== dispatcherId ||
      !metricSlug ||
      !claimedLeaderId ||
      !sourceAndTimeSuffix
    )
      return { recognized: true };
    const { data: metric, error: metricError } = await admin
      .from("metric_definitions")
      .select("id, name, slug")
      .eq("group_id", groupId)
      .eq("slug", metricSlug)
      .is("archived_at", null)
      .maybeSingle();
    if (metricError) throw metricError;
    if (!metric) return { recognized: true };
    const { data: recentEntries, error: entryError } = await admin
      .from("metric_entries")
      .select("id, client_generated_id, updated_at, source_provider")
      .eq("metric_id", metric.id)
      .eq("user_id", dispatcherId)
      .eq("visibility", "group")
      .gte(
        "updated_at",
        new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      )
      .order("updated_at", { ascending: false })
      .limit(50);
    if (entryError) throw entryError;
    // Legacy keys use ':' separators even though client-generated entry ids
    // may themselves contain ':'. Match committed candidates by longest
    // prefix instead of trusting a lossy split position.
    const entry = (recentEntries ?? [])
      .filter((candidate) => {
        if (candidate.source_provider === "google_health") return false;
        const sourceId = String(candidate.client_generated_id ?? "");
        return (
          sourceId.length > 0 &&
          (sourceAndTimeSuffix === sourceId ||
            sourceAndTimeSuffix.startsWith(`${sourceId}:`))
        );
      })
      .sort(
        (left, right) =>
          String(right.client_generated_id).length -
          String(left.client_generated_id).length,
    )[0];
    if (!entry) return { recognized: true };
    const canonicalKey = `lead:${groupId}:${dispatcherId}:${entry.id}:${new Date(entry.updated_at).getTime()}`;
    return {
      recognized: true,
      row: await storeCanonicalLegacyEvent(admin, {
        event_key: canonicalKey,
        group_id: groupId,
        dispatcher_id: dispatcherId,
        category: "lead",
        event_type: "leaderboard_activity",
        audience: "group_including_sender",
        recipient_id: null,
        metric_slug: metricSlug,
        title: "Lead changed",
        body: `New ${metric.name} activity changed first place. Open the Leaderboard for the latest standings.`,
        data: {
          route: "/group",
          groupId,
          metricId: metricSlug,
        },
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }),
    };
  }

  const periodType = parts[2];
  const anchor = parts[3];
  if (!["day", "week", "month"].includes(periodType ?? "") || !anchor)
    return { recognized: true };
  const [
    { data: profile, error: profileError },
    { data: snapshot, error: snapshotError },
  ] =
    await Promise.all([
      admin
        .from("profiles")
        .select("timezone")
        .eq("id", dispatcherId)
        .maybeSingle(),
      admin
        .from("user_snapshots")
        .select("payload")
        .eq("user_id", dispatcherId)
        .maybeSingle(),
    ]);
  if (profileError) throw profileError;
  if (snapshotError) throw snapshotError;
  const today = localDateKey(profile?.timezone || "UTC");
  const snapshotPayload = objectRecord(snapshot?.payload);
  const snapshotSettings = objectRecord(snapshotPayload.settings);
  const configuredWeekStart = Number(snapshotSettings.weekStartsOn ?? 1);
  const weekStart = Number.isInteger(configuredWeekStart)
    ? Math.max(0, Math.min(6, configuredWeekStart))
    : 1;
  const currentWeekAnchor = offsetDateKey(
    today,
    -((dateWeekday(today) - weekStart + 7) % 7),
  );
  const valid =
    (periodType === "day" && anchor === offsetDateKey(today, -1)) ||
    (periodType === "week" &&
      today === currentWeekAnchor &&
      anchor === offsetDateKey(currentWeekAnchor, -7)) ||
    (periodType === "month" &&
      today.endsWith("-01") &&
      anchor === previousMonthKey(today));
  if (!valid) return { recognized: true };
  const title =
    periodType === "day"
      ? "Yesterday's group results"
      : periodType === "week"
        ? "Last week's group results"
        : "Last month's group results";
  return {
    recognized: true,
    row: await storeCanonicalLegacyEvent(admin, {
      event_key: eventKey,
      group_id: groupId,
      dispatcher_id: dispatcherId,
      category: "winner",
      event_type: "period_results",
      audience: "group_including_sender",
      recipient_id: null,
      metric_slug: null,
      title,
      body: "Open HabHub to see the final Leaderboard results.",
      data: {
        route: "/badges",
        groupId,
        periodType: periodType!,
        periodAnchor: anchor,
      },
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),
  };
}

async function storeCanonicalLegacyEvent(
  admin: AdminClient,
  input: Record<string, unknown>,
) {
  const boundedInput = {
    ...input,
    title: pushPreview(String(input.title ?? "HabHub"), 120),
    body: pushPreview(
      String(input.body ?? "Open HabHub for the latest update."),
      500,
    ),
  };
  const inserted = await admin
    .from("push_dispatch_events")
    .upsert(boundedInput, { onConflict: "event_key", ignoreDuplicates: true })
    .select(
      "id, event_key, group_id, dispatcher_id, category, event_type, audience, recipient_id, metric_slug, title, body, data, created_at, expires_at, dispatched_at, attempt_count",
    )
    .maybeSingle();
  if (inserted.error) {
    if (isMissingOutboxError(inserted.error))
      return syntheticStoredEvent(boundedInput);
    throw inserted.error;
  }
  if (inserted.data) return inserted.data as StoredPushEvent;
  const existing = await admin
    .from("push_dispatch_events")
    .select(
      "id, event_key, group_id, dispatcher_id, category, event_type, audience, recipient_id, metric_slug, title, body, data, created_at, expires_at, dispatched_at, attempt_count",
    )
    .eq("event_key", String(input.event_key))
    .maybeSingle();
  if (existing.error) {
    if (isMissingOutboxError(existing.error)) return syntheticStoredEvent(input);
    throw existing.error;
  }
  return (existing.data as StoredPushEvent | null) ?? undefined;
}

function isMissingOutboxError(error: unknown) {
  const value = objectRecord(error);
  const code = String(value.code ?? "");
  const message = [value.message, value.details, value.hint]
    .filter((part) => typeof part === "string")
    .join(" ");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /push_dispatch_events.*(?:does not exist|schema cache|not find)/i.test(
      message,
    )
  );
}

function isMissingWebPushSubscriptionsError(error: unknown) {
  const value = objectRecord(error);
  const code = String(value.code ?? "");
  const message = [value.message, value.details, value.hint]
    .filter((part) => typeof part === "string")
    .join(" ");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /web_push_subscriptions.*(?:does not exist|schema cache|not find)/i.test(
      message,
    )
  );
}

function webPushVapidDetails() {
  const publicKey = normalizedString(
    Deno.env.get("WEB_PUSH_VAPID_PUBLIC_KEY"),
    120,
  );
  const privateKey = normalizedString(
    Deno.env.get("WEB_PUSH_VAPID_PRIVATE_KEY"),
    100,
  );
  const subject = normalizedString(
    Deno.env.get("WEB_PUSH_VAPID_SUBJECT"),
    300,
  );
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
    const value = new URL(subject);
    return (
      value.protocol === "https:" &&
      value.hostname !== "localhost" &&
      value.hostname !== "127.0.0.1"
    );
  } catch {
    return false;
  }
}

async function webPushTopic(eventKey: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(eventKey)),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
    .slice(0, 32);
}

async function sendWebPushTarget(
  target: WebPushTarget,
  event: CanonicalEvent,
  topic: string,
  vapidDetails: ReturnType<typeof webPushVapidDetails>,
) {
  if (!(await validWebPushTarget(target))) return "stale" as const;
  if (target.expirationTime && target.expirationTime <= Date.now())
    return "stale" as const;
  const language = pushLanguage(target.preferences);
  const expiresAt = event.expiresAt
    ? new Date(event.expiresAt).getTime()
    : Date.now() + 24 * 60 * 60 * 1000;
  const ttl = Math.max(
    0,
    Math.min(
      24 * 60 * 60,
      Math.ceil((expiresAt - Date.now()) / 1000),
    ),
  );
  const payload = JSON.stringify({
    title: pushPreview(
      event.titles?.[language] ?? event.titles?.en ?? event.title,
      120,
    ),
    body: pushPreview(
      event.bodies?.[language] ?? event.bodies?.en ?? event.body,
      220,
    ),
    data: event.data,
    tag: topic,
  });
  try {
    await webpush.sendNotification(
      {
        endpoint: target.endpoint,
        expirationTime: target.expirationTime,
        keys: {
          p256dh: target.p256dh,
          auth: target.auth,
        },
      },
      payload,
      {
        TTL: ttl,
        urgency: "high",
        topic,
        vapidDetails,
      },
    );
    return "accepted" as const;
  } catch (error) {
    const statusCode = Number(objectRecord(error).statusCode);
    if (statusCode === 404 || statusCode === 410) return "stale" as const;
    throw new Error(
      Number.isFinite(statusCode)
        ? `Web Push gateway failed: ${statusCode}`
        : "Web Push gateway failed",
    );
  }
}

async function validWebPushTarget(target: WebPushTarget) {
  if (
    !/^[A-Za-z0-9_-]{40,200}$/.test(target.p256dh) ||
    !/^[A-Za-z0-9_-]{8,100}$/.test(target.auth)
  )
    return false;
  try {
    const endpoint = new URL(target.endpoint);
    const hostname = endpoint.hostname.toLowerCase().replace(/\.$/, "");
    const nonPublicHostname =
      !hostname.includes(".") ||
      hostname.includes(":") ||
      /^[0-9.]+$/.test(hostname) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|corp|test|invalid|example)$/.test(
        hostname,
      );
    if (!(
      endpoint.protocol === "https:" &&
      !endpoint.username &&
      !endpoint.password &&
      !endpoint.hash &&
      (!endpoint.port || endpoint.port === "443") &&
      !nonPublicHostname
    ))
      return false;
    const publicKey = base64UrlByteArray(target.p256dh);
    const authSecret = base64UrlByteArray(target.auth);
    if (
      publicKey.length !== 65 ||
      publicKey[0] !== 4 ||
      authSecret.length !== 16
    )
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

function base64UrlByteArray(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function syntheticStoredEvent(input: Record<string, unknown>): StoredPushEvent {
  return {
    id: "",
    event_key: String(input.event_key),
    group_id: String(input.group_id),
    dispatcher_id: String(input.dispatcher_id),
    category: input.category as PushCategory,
    event_type: String(input.event_type),
    audience: input.audience as Audience,
    recipient_id:
      typeof input.recipient_id === "string" ? input.recipient_id : null,
    metric_slug:
      typeof input.metric_slug === "string" ? input.metric_slug : null,
    title: String(input.title),
    body: String(input.body),
    data: input.data ?? {},
    created_at: new Date().toISOString(),
    expires_at:
      typeof input.expires_at === "string"
        ? input.expires_at
        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    dispatched_at: null,
    attempt_count: 0,
  };
}

async function canDispatchStoredEvent(
  admin: AdminClient,
  event: StoredPushEvent,
  userId: string,
) {
  if (event.dispatcher_id === userId) return true;
  if (event.category !== "winner") return false;
  const { data: membership, error } = await admin
    .from("group_members")
    .select("status")
    .eq("group_id", event.group_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return membership?.status === "active";
}

async function recipientChatNicknames(
  admin: AdminClient,
  event: CanonicalEvent,
  recipientIds: string[],
) {
  const senderId = normalizedUuid(event.data.senderId);
  if (event.category !== "chat" || !senderId || !recipientIds.length)
    return new Map<string, string>();
  // Nicknames are private aliases owned by the notification recipient. Resolve
  // them after the authorized audience is known so one member's alias is never
  // reused for another member's notification.
  const { data, error } = await admin
    .from("group_member_aliases")
    .select("owner_user_id, nickname")
    .eq("group_id", event.groupId)
    .eq("subject_user_id", senderId)
    .in("owner_user_id", recipientIds);
  if (error) throw error;
  return new Map(
    (
      (data ?? []) as { owner_user_id: unknown; nickname: unknown }[]
    ).flatMap((row) => {
        const ownerId = normalizedUuid(row.owner_user_id);
        const nickname = normalizedString(row.nickname, 80);
        return ownerId && nickname ? [[ownerId, nickname] as const] : [];
      }),
  );
}

function eventForPushRecipient(
  event: CanonicalEvent,
  recipientId: string,
  chatNicknames: ReadonlyMap<string, string>,
): CanonicalEvent {
  if (event.category !== "chat") return event;
  const nickname = chatNicknames.get(recipientId);
  if (!nickname) return event;
  const profileName = event.data.senderName;
  const direct = event.eventType === "direct_message";
  const profilePrefix = profileName ? `${profileName}:` : "";
  const body =
    !direct && profilePrefix && event.body.startsWith(profilePrefix)
      ? `${nickname}:${event.body.slice(profilePrefix.length)}`
      : event.body;
  const bodies = event.bodies
    ? Object.fromEntries(
        Object.entries(event.bodies).map(([language, value]) => [
          language,
          !direct && profilePrefix && value.startsWith(profilePrefix)
            ? `${nickname}:${value.slice(profilePrefix.length)}`
            : value,
        ]),
      )
    : undefined;
  return {
    ...event,
    title: direct ? `Direct message from ${nickname}` : event.title,
    body,
    // User-authored copy has no localized variants. Attachment/image fallbacks
    // do, and their sender prefix is rewritten for this recipient's nickname.
    titles: undefined,
    bodies,
    data: { ...event.data, senderName: nickname },
  };
}

async function canonicalRecipients(
  admin: AdminClient,
  event: CanonicalEvent,
  senderId: string,
) {
  let challengeParticipantIds: Set<string> | undefined;
  if (event.category === "challenge") {
    const challengeId = normalizedUuid(event.data.challengeId);
    if (!challengeId) return [];
    const { data: challenge, error: challengeError } = await admin
      .from("group_challenges")
      .select("participant_ids")
      .eq("id", challengeId)
      .eq("group_id", event.groupId)
      .is("deleted_at", null)
      .maybeSingle();
    if (challengeError) throw challengeError;
    if (!challenge) return [];
    challengeParticipantIds = new Set(
      Array.isArray(challenge.participant_ids)
        ? challenge.participant_ids
        : [],
    );
  }
  if (event.audience === "user") {
    if (!event.recipientId) return [];
    if (event.category !== "challenge") return [event.recipientId];
    if (!challengeParticipantIds?.has(event.recipientId)) return [];
    const { data: membership, error } = await admin
      .from("group_members")
      .select("status")
      .eq("group_id", event.groupId)
      .eq("user_id", event.recipientId)
      .maybeSingle();
    if (error) throw error;
    return membership?.status === "active" ? [event.recipientId] : [];
  }
  let query = admin
    .from("group_members")
    .select("user_id, role")
    .eq("group_id", event.groupId)
    .eq("status", "active");
  if (event.audience !== "group_including_sender")
    query = query.neq("user_id", senderId);
  if (event.audience === "admins")
    query = query.in("role", ["owner", "admin"]);
  const { data: members, error } = await query;
  if (error) throw error;
  let ids = (members ?? []).map((member) => member.user_id as string);
  if (event.audience === "challenge_participants") {
    ids = ids.filter((id) => challengeParticipantIds?.has(id));
  }
  return [...new Set(ids)];
}

async function markCanonicalEventAccepted(
  admin: AdminClient,
  event: CanonicalEvent,
  outcome: string,
) {
  if (event.outboxId) {
    const updated = await admin
      .from("push_dispatch_events")
      .update({
        dispatched_at: new Date().toISOString(),
        last_error: outcome,
      })
      .eq("id", event.outboxId);
    if (updated.error) throw updated.error;
  }
  if (event.category === "chat") {
    const messageId = event.data.messageId;
    const senderId = event.data.senderId;
    if (messageId && senderId)
      await markMessageAccepted(
        admin,
        event.groupId,
        senderId,
        messageId,
      );
  }
}

async function markMessageAccepted(
  admin: AdminClient,
  groupId: string,
  senderId: string,
  messageId: string,
) {
  const updated = await admin
    .from("messages")
    .update({ push_dispatched_at: new Date().toISOString() })
    .eq("group_id", groupId)
    .eq("sender_id", senderId)
    .eq("client_generated_id", messageId);
  if (updated.error) throw updated.error;
}

async function releaseClaim(
  admin: AdminClient,
  eventKey: string,
) {
  const released = await admin
    .from("push_events")
    .delete()
    .eq("event_key", eventKey);
  if (released.error) throw released.error;
}

function preferenceAllowed(
  settings: Record<string, unknown>,
  event: CanonicalEvent,
) {
  if (settings.pushEnabled === false) return false;
  const mutedGroups = Array.isArray(settings.mutedGroupIds)
    ? settings.mutedGroupIds
    : [];
  if (mutedGroups.includes(event.groupId)) return false;
  const groupPreferences = objectRecord(settings.groupPreferencesByGroup);
  const groupPreference = objectRecord(groupPreferences[event.groupId]);
  if (event.category !== "chat" && groupPreference.enabled === false)
    return false;
  const conversationId = event.data.conversationId;
  const mutedChats = Array.isArray(settings.mutedConversationIds)
    ? settings.mutedConversationIds
    : [];
  if (
    event.category === "chat" &&
    (settings.chatMessages === false ||
      (conversationId && mutedChats.includes(conversationId)))
  )
    return false;
  if (event.category === "membership" && settings.groupMembership === false)
    return false;
  if (
    event.category === "lead" &&
    (groupPreference.leadChanges ?? settings.leadChanges ?? true) === false
  )
    return false;
  if (event.category === "winner" && settings.badgesAndWinners === false)
    return false;
  if (
    (event.eventType === "social_reaction" ||
      event.eventType === "social_comment") &&
    (groupPreference.socialReactions ?? settings.socialReactions ?? true) ===
      false
  )
    return false;
  if (event.category === "challenge") {
    // Legacy token rows used the badges/winners switch for challenges. Once a
    // new client writes the dedicated field it becomes fully independent.
    const challengeEnabled =
      settings.challenges ?? settings.badgesAndWinners ?? true;
    if (challengeEnabled === false) return false;
    if (
      [
        "challenge_started",
        "challenge_invitation",
        "challenge_accepted",
        "challenge_all_accepted",
      ].includes(event.eventType) &&
      groupPreference.challengeUpdates === false
    )
      return false;
    if (
      event.eventType === "challenge_standing" &&
      groupPreference.challengeStandings === false
    )
      return false;
    if (
      event.eventType === "challenge_reminder" &&
      groupPreference.challengeReminders === false
    )
      return false;
    if (
      event.eventType === "challenge_result" &&
      groupPreference.challengeResults === false
    )
      return false;
  }
  if (
    event.category === "metric" &&
    event.eventType !== "social_reaction" &&
    event.eventType !== "social_comment" &&
    (groupPreference.trackerUpdates ??
      groupPreference.progressUpdates ??
      settings.groupMetricActivity ??
      true) === false
  )
    return false;
  if (
    (event.category === "metric" || event.category === "lead") &&
    Array.isArray(groupPreference.memberIds) &&
    (!event.dispatcherId || !groupPreference.memberIds.includes(event.dispatcherId))
  )
    return false;
  if (event.category !== "metric" && event.category !== "lead") return true;
  if (!event.metricId) return true;
  const ids = Array.isArray(groupPreference.metricIds)
    ? groupPreference.metricIds
    : settings.metricIds;
  // Absent is the legacy all-metrics default; an explicit empty array means
  // the current UI selection intentionally chose no tracker alerts.
  return !Array.isArray(ids) || ids.includes(event.metricId);
}

function challengePushCopy(
  event: "started" | "accepted",
  acceptingName?: string,
) {
  if (event === "accepted") {
    const name = acceptingName?.trim();
    return {
      titles: {
        en: "Challenge accepted",
        es: "Reto aceptado",
        sv: "Utmaning accepterad",
        de: "Challenge angenommen",
        fr: "Défi accepté",
      },
      bodies: {
        en: name ? `${name} accepted your challenge.` : "A friend accepted your challenge.",
        es: name ? `${name} aceptó tu reto.` : "Un amigo aceptó tu reto.",
        sv: name ? `${name} accepterade din utmaning.` : "En vän accepterade din utmaning.",
        de: name ? `${name} hat deine Challenge angenommen.` : "Ein Freund hat deine Challenge angenommen.",
        fr: name ? `${name} a accepté votre défi.` : "Un ami a accepté votre défi.",
      },
    };
  }
  return {
    titles: {
      en: "Challenge started",
      es: "Reto iniciado",
      sv: "Utmaning startad",
      de: "Challenge gestartet",
      fr: "Défi lancé",
    },
    bodies: {
      en: "Open HabHub to accept or decline.",
      es: "Abre HabHub para aceptar o rechazar.",
      sv: "Öppna HabHub för att acceptera eller avböja.",
      de: "Öffne HabHub, um anzunehmen oder abzulehnen.",
      fr: "Ouvrez HabHub pour accepter ou refuser.",
    },
  };
}

function pushLanguage(settings: Record<string, unknown>) {
  const language = String(settings.language || "en");
  return ["en", "ar", "es", "zh-Hans", "sv", "de", "ru", "fr"].includes(
    language,
  )
    ? language
    : "en";
}

function inQuietHours(settings: Record<string, unknown>) {
  if (settings.quietHoursEnabled !== true) return false;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: String(settings.timezone || "UTC"),
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const now =
      Number(parts.find((part) => part.type === "hour")?.value || 0) * 60 +
      Number(parts.find((part) => part.type === "minute")?.value || 0);
    const minutes = (value: unknown) => {
      const [hour, minute] = String(value || "")
        .split(":")
        .map(Number);
      return Number.isFinite(hour) && Number.isFinite(minute)
        ? hour * 60 + minute
        : 0;
    };
    const start = minutes(settings.quietHoursStart);
    const end = minutes(settings.quietHoursEnd);
    return start === end
      ? false
      : start < end
        ? now >= start && now < end
        : now >= start || now < end;
  } catch {
    return false;
  }
}

function normalizedString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function pushPreview(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function canonicalChatPreview(content: unknown, metadata: unknown): {
  text: string;
  fallback?: "attachment" | "image";
} {
  const source = typeof content === "string" ? content : "";
  const attachmentLinks = source.match(
    /habhub:\/\/(?:recap|challenge|metric-log)\?[^\s]*/gi,
  );
  const visibleText = source
    .replace(/habhub:\/\/(?:recap|challenge|metric-log)\?[^\s]*/gi, "")
    .trim();
  const messageMetadata = objectRecord(metadata);
  const hasAttachment =
    Boolean(attachmentLinks?.length) ||
    Boolean(messageMetadata.todoAttachment);
  if (visibleText)
    return {
      text: `${visibleText}${hasAttachment ? " · Attachment" : ""}`,
    };
  return hasAttachment
    ? { text: "Shared an attachment", fallback: "attachment" }
    : { text: "Sent an image", fallback: "image" };
}

function localizedChatFallback(kind: "attachment" | "image") {
  if (kind === "attachment")
    return {
      en: "Shared an attachment",
      ar: "شارك مرفقًا",
      es: "Compartió un archivo adjunto",
      "zh-Hans": "分享了一个附件",
      sv: "Delade en bilaga",
      de: "Hat einen Anhang geteilt",
      ru: "Поделился вложением",
      fr: "A partagé une pièce jointe",
    };
  return {
    en: "Sent an image",
    ar: "أرسل صورة",
    es: "Envió una imagen",
    "zh-Hans": "发送了一张图片",
    sv: "Skickade en bild",
    de: "Hat ein Bild gesendet",
    ru: "Отправлено изображение",
    fr: "A envoyé une image",
  };
}

function normalizedUuid(value: unknown) {
  const normalized = normalizedString(value, 36);
  return normalized &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      normalized,
    )
    ? normalized
    : undefined;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function localDateKey(timeZone: string, instant = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const value = (kind: "year" | "month" | "day") =>
      parts.find((part) => part.type === kind)?.value;
    const year = value("year");
    const month = value("month");
    const day = value("day");
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // A damaged legacy timezone should not authorize a wider date window.
  }
  return instant.toISOString().slice(0, 10);
}

function offsetDateKey(date: string, days: number) {
  const instant = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(instant.getTime())) return "";
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

function dateWeekday(date: string) {
  const instant = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(instant.getTime()) ? instant.getUTCDay() : 0;
}

function previousMonthKey(date: string) {
  const instant = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  if (!Number.isFinite(instant.getTime())) return "";
  instant.setUTCMonth(instant.getUTCMonth() - 1);
  return instant.toISOString().slice(0, 7);
}

function stringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
      typeof item === "string" ? [[key, item]] : [],
    ),
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
