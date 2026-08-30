import { supabase } from "@/src/lib/supabase";
import { flushPendingGroupPushEvents } from "@/src/cloud/groupCloud";
import {
  type ChallengeVisualIcon,
  GoalSchedule,
  GroupChallenge,
} from "@/src/types";
import {
  challengeSettlementKey,
  type ResolvedChallengePlacement,
} from "@/src/domain/groupChallenges";
import {
  assertPushDeliveryComplete,
  dispatchPushWithBoundedRetry,
} from "@/src/domain/pushDelivery";

type GroupChallengeRow = {
  id: string;
  group_id: string;
  creator_id: string;
  metric_slug: string;
  title: string | null;
  visual_icon?: ChallengeVisualIcon | null;
  visual_image_path?: string | null;
  /** Short-lived client-only signed URL; never returned by the table itself. */
  visual_image_uri?: string;
  audience?: "group" | "public";
  participant_limit?: number | null;
  target_value: number | string | null;
  local_date: string;
  end_date: string;
  participant_ids?: string[];
  accepted_participant_ids?: string[];
  declined_participant_ids?: string[];
  participant_count?: number;
  accepted_count?: number;
  viewer_participation?: GroupChallenge["viewerParticipation"];
  eligible_to_join?: boolean;
  is_full?: boolean;
  recurrence: GoalSchedule | null;
  created_at: string;
  updated_at: string;
};

export type SaveGroupChallengeInput = {
  id?: string;
  groupId: string;
  metricId: string;
  title?: string;
  visualIcon?: ChallengeVisualIcon;
  /** Existing stable path, explicit null to remove, or undefined for a new row. */
  visualImageStoragePath?: string | null;
  /** A newly selected local URI to upload before publishing the stable path. */
  visualImageUploadUri?: string;
  /** Used only to remove a replaced creator-owned object after a successful save. */
  previousVisualImageStoragePath?: string;
  audience?: "group" | "public";
  participantLimit?: number;
  target?: number;
  localDate: string;
  endDate?: string;
  participantIds: string[];
  recurrence?: GoalSchedule;
};

export type GroupChallengeResponse = "accepted" | "declined";

export type ChallengeViewerStanding = {
  challengeId: string;
  occurrenceDate: string;
  total?: number;
  standingPosition?: number;
  competitorCount: number;
  /** Server-finalized win eligibility; rank #1 alone is not sufficient. */
  winner: boolean;
};

export type ChallengeStanding = {
  userId: string;
  displayName: string;
  total: number;
  standingPosition: number;
  competitorCount: number;
  syncedAt?: string;
};

export type ChallengeUserPreference = {
  challengeId: string;
  userId: string;
  hidden: boolean;
  pinned: boolean;
  withdrawnAt?: string;
  updatedAt: string;
};

type ChallengeUserPreferenceRow = {
  challenge_id: string;
  user_id: string;
  hidden: boolean;
  pinned: boolean;
  withdrawn_at: string | null;
  updated_at: string;
};

function preferenceFromRow(
  row: ChallengeUserPreferenceRow,
): ChallengeUserPreference {
  return {
    challengeId: row.challenge_id,
    userId: row.user_id,
    hidden: row.hidden,
    pinned: row.pinned,
    withdrawnAt: row.withdrawn_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

function challengeCloudError(error: unknown) {
  if (error && typeof error === "object") {
    const row = error as Record<string, unknown>;
    const message = [row.message, row.details, row.hint]
      .filter((value): value is string => typeof value === "string" && Boolean(value))
      .join(" · ");
    if (message) return new Error(message);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function fromRow(row: GroupChallengeRow): GroupChallenge {
  return {
    id: row.id,
    groupId: row.group_id,
    creatorId: row.creator_id,
    metricId: row.metric_slug,
    title: row.title?.trim() || undefined,
    visualIcon: row.visual_icon ?? undefined,
    visualImageStoragePath: row.visual_image_path ?? undefined,
    audience: row.audience ?? "group",
    participantLimit: row.participant_limit ?? undefined,
    target:
      row.target_value === null || row.target_value === undefined
        ? undefined
        : Number(row.target_value),
    localDate: row.local_date,
    endDate: row.end_date || row.local_date,
    participantIds: [...new Set(row.participant_ids ?? [])],
    acceptedParticipantIds: [
      ...new Set(row.accepted_participant_ids ?? row.participant_ids ?? []),
    ],
    declinedParticipantIds: [
      ...new Set(row.declined_participant_ids ?? []),
    ],
    participantCount: row.participant_count,
    acceptedParticipantCount: row.accepted_count,
    viewerParticipation: row.viewer_participation,
    eligibleToJoin: row.eligible_to_join,
    isFull: row.is_full,
    recurrence: row.recurrence ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const MEDIA_BUCKET = "paceboard-media";
const CHALLENGE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

function challengeVisualSchemaUnavailable(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  const code = typeof row.code === "string" ? row.code : "";
  const message = [row.message, row.details, row.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return (
    code === "42883" ||
    code === "PGRST202" ||
    /list_challenge_visuals|visual_icon|visual_image_path/i.test(message)
  );
}

async function challengeRowsWithVisuals(rows: GroupChallengeRow[]) {
  if (!supabase || rows.length === 0) return rows;
  let resolvedRows = rows;
  if (rows.some((row) => !("visual_icon" in row))) {
    const { data, error } = await supabase.rpc("list_challenge_visuals", {
      p_challenge_ids: rows.map((row) => row.id),
    });
    if (error && !challengeVisualSchemaUnavailable(error))
      throw challengeCloudError(error);
    if (!error) {
      const visuals = new Map(
        ((data ?? []) as Pick<
          GroupChallengeRow,
          "id" | "visual_icon" | "visual_image_path"
        >[]).map((row) => [row.id, row]),
      );
      resolvedRows = rows.map((row) => ({
        ...row,
        ...visuals.get(row.id),
      }));
    }
  }
  const paths = [
    ...new Set(
      resolvedRows
        .map((row) => row.visual_image_path)
        .filter((path): path is string => Boolean(path)),
    ),
  ];
  const signedByPath = new Map<string, string>();
  if (paths.length) {
    const { data, error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrls(paths, 60 * 60);
    if (error) throw challengeCloudError(error);
    for (const item of data ?? [])
      if (item.path && item.signedUrl)
        signedByPath.set(item.path, item.signedUrl);
  }
  return resolvedRows.map((row) => ({
    ...row,
    visual_image_uri: row.visual_image_path
      ? signedByPath.get(row.visual_image_path)
      : undefined,
  })) as (GroupChallengeRow & { visual_image_uri?: string })[];
}

async function challengesFromRows(rows: GroupChallengeRow[]) {
  const resolved = await challengeRowsWithVisuals(rows);
  return resolved.map((row) => ({
    ...fromRow(row),
    visualImageUri: row.visual_image_uri,
  }));
}

export async function loadGroupChallenges(groupId: string) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("group_challenges")
    .select(
      "id, group_id, creator_id, metric_slug, title, visual_icon, visual_image_path, audience, participant_limit, target_value, local_date, end_date, participant_ids, accepted_participant_ids, declined_participant_ids, recurrence, created_at, updated_at",
    )
    .eq("group_id", groupId)
    .is("deleted_at", null)
    .order("local_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw challengeCloudError(error);
  return challengesFromRows((data as GroupChallengeRow[] | null) ?? []);
}

/** Participant-scoped catalogue across every group the account belongs to.
 * RLS still requires an explicit invitation/join and active membership for
 * non-public rows; this only removes the active-group client filter. */
export async function loadMyChallenges() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("group_challenges")
    .select(
      "id, group_id, creator_id, metric_slug, title, visual_icon, visual_image_path, audience, participant_limit, target_value, local_date, end_date, participant_ids, accepted_participant_ids, declined_participant_ids, recurrence, created_at, updated_at",
    )
    .is("deleted_at", null)
    .order("local_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw challengeCloudError(error);
  return challengesFromRows((data as GroupChallengeRow[] | null) ?? []);
}

/**
 * A bounded discovery read for Group settings. The RPC verifies active group
 * membership server-side and returns only challenges that have not finished;
 * the normal participant-scoped Leaderboard query above remains unchanged.
 */
export async function loadActiveGroupChallenges(groupId: string) {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("list_active_group_challenges", {
    p_group_id: groupId,
  });
  if (error) throw challengeCloudError(error);
  return challengesFromRows((data as GroupChallengeRow[] | null) ?? []);
}

/** Bounded public catalogue. It deliberately returns counts/caller state, not
 * another challenge's UUID roster, until the viewer explicitly joins. */
export async function loadPublicChallenges() {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("list_public_challenges");
  if (error) throw challengeCloudError(error);
  return challengesFromRows((data as GroupChallengeRow[] | null) ?? []);
}

/** Only the signed-in participant's own value/rank is returned. The scorer
 * remains server-side so public challenges never expose another account's
 * exact total outside an authorized group Leaderboard. */
export type ChallengeOccurrenceRequest = {
  challengeId: string;
  occurrenceDate: string;
};

export async function loadChallengeViewerStandings(
  requests: readonly ChallengeOccurrenceRequest[],
) {
  if (!supabase || requests.length === 0) return [];
  const unique = [
    ...new Map(
      requests.map((request) => [
        challengeSettlementKey(request.challengeId, request.occurrenceDate),
        request,
      ]),
    ).values(),
  ];
  const rows: {
    challenge_id: string;
    occurrence_date: string;
    viewer_total: number | string | null;
    standing_position: number | string | null;
    competitor_count: number | string;
    viewer_winner: boolean | null;
  }[] = [];
  for (let index = 0; index < unique.length; index += 50) {
    const chunk = unique.slice(index, index + 50);
    const { data, error } = await supabase.rpc("list_my_challenge_standings", {
      p_challenge_ids: chunk.map((request) => request.challengeId),
      p_occurrence_dates: chunk.map((request) => request.occurrenceDate),
    });
    if (error) throw challengeCloudError(error);
    rows.push(...((data ?? []) as typeof rows));
  }
  return rows.map((row): ChallengeViewerStanding => ({
    challengeId: row.challenge_id,
    occurrenceDate: row.occurrence_date,
    total:
      row.viewer_total === null ? undefined : Number(row.viewer_total),
    standingPosition:
      row.standing_position === null
        ? undefined
        : Number(row.standing_position),
    competitorCount: Number(row.competitor_count ?? 0),
    winner: row.viewer_winner === true,
  }));
}

/** Full standings for bounded group challenges; public challenges return the
 * deterministic top 100 plus the signed-in viewer when they rank below it. */
export async function loadChallengeStandings(
  challengeId: string,
  occurrenceDate: string,
) {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc(
    "list_challenge_standings",
    {
      p_challenge_id: challengeId,
      p_occurrence_date: occurrenceDate,
    },
  );
  if (error) throw challengeCloudError(error);
  return ((data ?? []) as {
    user_id: string;
    display_name: string;
    total: number | string;
    standing_position: number | string;
    competitor_count: number | string;
    synced_at: string | null;
  }[]).map((row): ChallengeStanding => ({
    userId: row.user_id,
    displayName: row.display_name,
    total: Number(row.total),
    standingPosition: Number(row.standing_position),
    competitorCount: Number(row.competitor_count),
    syncedAt: row.synced_at ?? undefined,
  }));
}

/** Immutable, server-settled placements used for XP, profiles, and recaps. */
export async function loadChallengeResultPlacements(
  requests: readonly ChallengeOccurrenceRequest[],
) {
  if (!supabase || requests.length === 0) return [];
  const unique = [
    ...new Map(
      requests.map((request) => [
        challengeSettlementKey(request.challengeId, request.occurrenceDate),
        request,
      ]),
    ).values(),
  ];
  const rows: {
    challenge_id: string;
    occurrence_date: string;
    user_id: string;
    total: number | string;
    standing_position: number | string;
    competitor_count: number | string;
    winner: boolean;
  }[] = [];
  for (let index = 0; index < unique.length; index += 50) {
    const chunk = unique.slice(index, index + 50);
    const { data, error } = await supabase.rpc(
      "list_challenge_result_placements",
      {
        p_challenge_ids: chunk.map((request) => request.challengeId),
        p_occurrence_dates: chunk.map((request) => request.occurrenceDate),
      },
    );
    if (error) throw challengeCloudError(error);
    rows.push(...((data ?? []) as typeof rows));
  }
  const grouped = new Map<string, ResolvedChallengePlacement>();
  for (const row of rows) {
    const key = challengeSettlementKey(
      row.challenge_id,
      row.occurrence_date,
    );
    const placement = grouped.get(key) ?? {
      challengeId: row.challenge_id,
      localDate: row.occurrence_date,
      placements: [],
    };
    placement.placements.push({
      memberId: row.user_id,
      standingPosition: Number(row.standing_position),
      competitorCount: Number(row.competitor_count),
      winner: row.winner === true,
      value: Number(row.total),
    });
    grouped.set(key, placement);
  }
  return [...grouped.values()];
}

/** Durable finalized group results. Unlike the notification feed, this read is
 * not truncated by newer activity, so old badges and recaps remain stable. */
export async function loadGroupChallengeResultPlacements(groupId: string) {
  if (!supabase) return [];
  type PlacementRow = {
    challenge_id: string;
    occurrence_date: string;
    user_id: string;
    total: number | string;
    standing_position: number | string;
    competitor_count: number | string;
    winner: boolean;
  };
  const rows: PlacementRow[] = [];
  // Group challenges are capped at 50 participants. Twenty complete
  // occurrences therefore remain within PostgREST's common 1,000-row cap.
  const pageSize = 20;
  let beforeOccurrenceDate: string | null = null;
  let beforeChallengeId: string | null = null;
  let previousCursor: string | undefined;
  for (;;) {
    const { data, error } = await supabase.rpc(
      "list_group_challenge_result_placements",
      {
        p_group_id: groupId,
        p_before_occurrence_date: beforeOccurrenceDate,
        p_before_challenge_id: beforeChallengeId,
        p_page_size: pageSize,
      },
    );
    if (error) throw challengeCloudError(error);
    const page = (data ?? []) as PlacementRow[];
    if (!page.length) break;
    rows.push(...page);
    const occurrenceCount = new Set(
      page.map((row) =>
        challengeSettlementKey(row.challenge_id, row.occurrence_date),
      ),
    ).size;
    if (occurrenceCount < pageSize) break;
    const last = page[page.length - 1];
    const cursor = challengeSettlementKey(
      last.challenge_id,
      last.occurrence_date,
    );
    if (cursor === previousCursor)
      throw new Error("Challenge result pagination did not advance.");
    previousCursor = cursor;
    beforeOccurrenceDate = last.occurrence_date;
    beforeChallengeId = last.challenge_id;
  }
  const grouped = new Map<string, ResolvedChallengePlacement>();
  for (const row of rows) {
    const key = challengeSettlementKey(row.challenge_id, row.occurrence_date);
    const placement = grouped.get(key) ?? {
      challengeId: row.challenge_id,
      localDate: row.occurrence_date,
      placements: [],
    };
    placement.placements.push({
      memberId: row.user_id,
      standingPosition: Number(row.standing_position),
      competitorCount: Number(row.competitor_count),
      value: Number(row.total),
      winner: row.winner === true,
    });
    grouped.set(key, placement);
  }
  return [...grouped.values()];
}

export async function loadChallengeUserPreferences() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("group_challenge_user_preferences")
    .select(
      "challenge_id, user_id, hidden, pinned, withdrawn_at, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw challengeCloudError(error);
  return ((data ?? []) as ChallengeUserPreferenceRow[]).map(preferenceFromRow);
}

export async function saveChallengeUserPreference(
  challengeId: string,
  input: { hidden: boolean; pinned: boolean },
) {
  if (!supabase) throw new Error("Sign in to customize this challenge.");
  const { data, error } = await supabase.rpc("set_my_challenge_preference", {
    p_challenge_id: challengeId,
    p_hidden: input.hidden,
    p_pinned: input.pinned,
  });
  if (error) throw challengeCloudError(error);
  return preferenceFromRow(data as ChallengeUserPreferenceRow);
}

export async function withdrawFromGroupChallenge(challengeId: string) {
  if (!supabase) throw new Error("Sign in to withdraw from this challenge.");
  const { data, error } = await supabase.rpc("withdraw_from_group_challenge", {
    p_challenge_id: challengeId,
  });
  if (error) throw challengeCloudError(error);
  return preferenceFromRow(data as ChallengeUserPreferenceRow);
}

function challengeImageInfo(uri: string, contentType: string | null) {
  const normalized = contentType?.toLowerCase() ?? "";
  if (normalized.includes("png") || /\.png(?:$|\?)/i.test(uri))
    return { extension: "png", contentType: "image/png" };
  if (normalized.includes("webp") || /\.webp(?:$|\?)/i.test(uri))
    return { extension: "webp", contentType: "image/webp" };
  if (
    normalized.includes("heic") ||
    normalized.includes("heif") ||
    /\.hei[cf](?:$|\?)/i.test(uri)
  )
    return { extension: "heic", contentType: "image/heic" };
  return { extension: "jpg", contentType: "image/jpeg" };
}

async function uploadChallengeVisual(uri: string) {
  if (!supabase) throw new Error("Sign in to upload a challenge image.");
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error("Sign in to upload a challenge image.");
  const response = await fetch(uri);
  if (!response.ok) throw new Error("Could not read the selected challenge image.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > CHALLENGE_IMAGE_MAX_BYTES)
    throw new Error("Challenge images must be smaller than 8 MB.");
  const info = challengeImageInfo(uri, response.headers.get("content-type"));
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${userId}/account/challenge/${nonce}.${info.extension}`;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, bytes, {
    contentType: info.contentType,
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw challengeCloudError(error);
  return path;
}

async function removeChallengeVisual(path: string | undefined) {
  if (!supabase || !path) return;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).remove([path]);
  if (error) throw challengeCloudError(error);
}

async function saveChallengeRow(
  input: SaveGroupChallengeInput,
  visualImagePath: string | null,
) {
  if (!supabase) throw new Error("Sign in to create a shared challenge.");
  const operation = input.audience === "public"
    ? "save_public_challenge"
    : "save_group_challenge";
  const parameters = {
    p_challenge_id: input.id ?? null,
    p_group_id: input.groupId,
    p_metric_slug: input.metricId,
    p_title: input.title?.trim() || null,
    p_target_value: input.target ?? null,
    p_local_date: input.localDate,
    p_end_date: input.endDate ?? input.localDate,
    p_participant_ids: input.participantIds,
    p_recurrence: input.recurrence ?? null,
    p_visual_icon: input.visualIcon ?? null,
    p_visual_image_path: visualImagePath,
    ...(operation === "save_public_challenge"
      ? { p_participant_limit: input.participantLimit ?? null }
      : {}),
  };
  const { data, error } = await supabase.rpc(operation, parameters);
  if (error) throw challengeCloudError(error);
  return data as GroupChallengeRow;
}

export async function saveGroupChallenge(input: SaveGroupChallengeInput) {
  if (!supabase) throw new Error("Sign in to create a shared challenge.");
  let uploadedPath: string | undefined;
  try {
    // Upload to a fresh owner-only object first. The relational RPC then
    // validates and publishes that exact path atomically; a rejected save can
    // remove the unreferenced object without ever exposing a ghost challenge.
    if (input.visualImageUploadUri)
      uploadedPath = await uploadChallengeVisual(input.visualImageUploadUri);
    const row = await saveChallengeRow(
      input,
      uploadedPath ?? input.visualImageStoragePath ?? null,
    );
    if (
      input.previousVisualImageStoragePath &&
      input.previousVisualImageStoragePath !== row.visual_image_path
    )
      await removeChallengeVisual(input.previousVisualImageStoragePath).catch(
        () => undefined,
      );
    const saved = (await challengesFromRows([row]))[0];
    return input.visualImageUploadUri
      ? { ...saved, visualImageUri: input.visualImageUploadUri }
      : saved;
  } catch (reason) {
    if (uploadedPath)
      await removeChallengeVisual(uploadedPath).catch(() => undefined);
    throw reason;
  }
}

export async function respondToGroupChallenge(
  id: string,
  response: GroupChallengeResponse,
) {
  if (!supabase) throw new Error("Sign in to answer a shared challenge.");
  const { data, error } = await supabase.rpc("respond_group_challenge", {
    p_challenge_id: id,
    p_accept: response === "accepted",
  });
  if (error) throw challengeCloudError(error);
  return (await challengesFromRows([data as GroupChallengeRow]))[0];
}

async function sendChallengePush(input: {
  challenge: GroupChallenge;
  eventKey: string;
  recipientId?: string;
  event: "started" | "accepted";
  title: string;
  body: string;
}) {
  const client = supabase;
  if (!client) return;
  await dispatchPushWithBoundedRetry(async () => {
    const { data, error } = await client.functions.invoke("send-push", {
      body: {
        eventKey: input.eventKey,
        groupId: input.challenge.groupId,
        category: "challenge",
        audience: "user",
        recipientId: input.recipientId,
        title: input.title,
        body: input.body,
        data: {
          route: "/challenges",
          groupId: input.challenge.groupId,
          challengeId: input.challenge.id,
          challengeEvent: input.event,
        },
      },
    });
    if (error) throw error;
    assertPushDeliveryComplete(data);
  });
}

export async function sendGroupChallengeStartedPush(
  challenge: GroupChallenge,
) {
  // One authenticated edge invocation fans out only to the server-verified
  // invite list. This stays O(1) in client/network work for large groups.
  await sendChallengePush({
    challenge,
    eventKey: `challenge-started:${challenge.id}`,
    event: "started",
    title: "Challenge started",
    body: "Open HabHub to accept or decline.",
  });
}

export async function sendGroupChallengeAcceptedPush(
  challenge: GroupChallenge,
  acceptingUserId: string,
  acceptingName: string,
) {
  await sendChallengePush({
    challenge,
    eventKey: `challenge-accepted:${challenge.id}:${acceptingUserId}`,
    recipientId: challenge.creatorId,
    event: "accepted",
    title: "Challenge accepted",
    body: `${acceptingName.trim() || "A member"} accepted your challenge.`,
  });
  // The acceptance transaction may also have staged the one-time
  // all-participants notification. Drain it immediately; the scheduled worker
  // remains the durable fallback when this device disappears or is offline.
  await flushPendingGroupPushEvents();
}

export async function deleteGroupChallenge(id: string) {
  if (!supabase) throw new Error("Sign in to delete a shared challenge.");
  const { error } = await supabase.rpc("delete_group_challenge", {
    p_challenge_id: id,
  });
  if (error) throw challengeCloudError(error);
}
