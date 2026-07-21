import { User } from "@supabase/supabase-js";

import {
  effectiveGoalTarget,
  formatMetricValue,
  goalProgress,
  goalReached,
  rankedMembers,
  safeMetricValue,
} from "@/src/domain/metrics";
import { supabase } from "@/src/lib/supabase";
import {
  AppState,
  ChatMessage,
  DailyMetricStatus,
  Group,
  Member,
  MetricDefinition,
  MetricEntry,
  PhotoUpdate,
} from "@/src/types";

const MEDIA_BUCKET = "paceboard-media";
const COLORS = [
  "#176B4D",
  "#3478D4",
  "#7756D9",
  "#E9A23B",
  "#D95852",
  "#2A8F86",
  "#9B6B43",
];

export function isCloudGroupId(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id,
  );
}

function requireCloud() {
  if (!supabase) throw new Error("Cloud is not configured.");
  return supabase;
}

function memberColor(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1)
    hash = ((hash << 5) - hash + id.charCodeAt(index)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] ?? "")
      .join("")
      .toUpperCase() || "P"
  );
}

function inviteCode() {
  return `PACE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function metricFromRow(row: Record<string, any>): MetricDefinition {
  const configuration = (row.configuration ?? {}) as Partial<MetricDefinition>;
  return {
    id: row.slug,
    name: row.name,
    icon: row.icon,
    color: row.color,
    unit: row.unit,
    dataType: row.data_type,
    aggregation: row.aggregation_method,
    rankingDirection: row.ranking_direction,
    goal: configuration.goal ?? { kind: "at_least", target: 1 },
    goalEnabled: configuration.goalEnabled ?? true,
    goalRange: configuration.goalRange,
    category: configuration.category ?? "other",
    healthMapping: configuration.healthMapping,
    stepFallback: configuration.stepFallback,
    manualEntry: configuration.manualEntry ?? true,
    scoreWeight: Number(row.score_weight ?? 0),
    formula: row.formula ?? undefined,
    defaultVisibility: row.default_visibility,
    sections: configuration.sections ?? {
      today: true,
      group: true,
      insights: true,
    },
    order: Number(configuration.order ?? 0),
    activeFrom:
      configuration.activeFrom ?? new Date().toISOString().slice(0, 10),
  };
}

function metricRow(groupId: string, metric: MetricDefinition) {
  return {
    group_id: groupId,
    owner_user_id: null,
    slug: metric.id,
    name: metric.name,
    icon: metric.icon,
    color: metric.color,
    unit: metric.unit,
    data_type: metric.dataType,
    aggregation_method: metric.aggregation,
    ranking_direction: metric.rankingDirection,
    formula: metric.formula ?? null,
    score_weight: metric.scoreWeight,
    default_visibility: metric.defaultVisibility,
    configuration: {
      goal: metric.goal,
      goalEnabled: metric.goalEnabled,
      goalRange: metric.goalRange,
      category: metric.category,
      healthMapping: metric.healthMapping,
      stepFallback: metric.stepFallback,
      manualEntry: metric.manualEntry,
      sections: metric.sections,
      order: metric.order,
      activeFrom: metric.activeFrom,
    },
  };
}

async function signedUrls(paths: string[]) {
  const client = requireCloud();
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return new Map<string, string>();
  const { data, error } = await client.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(unique, 60 * 60);
  if (error) throw error;
  const pairs: [string, string][] = [];
  for (const item of data ?? [])
    if (item.path && item.signedUrl) pairs.push([item.path, item.signedUrl]);
  return new Map<string, string>(pairs);
}

async function upsertMetrics(groupId: string, metrics: MetricDefinition[]) {
  const client = requireCloud();
  const { data: existing, error: existingError } = await client
    .from("metric_definitions")
    .select("id, slug")
    .eq("group_id", groupId);
  if (existingError) throw existingError;
  const removed = (existing ?? [])
    .filter((row) => !metrics.some((metric) => metric.id === row.slug))
    .map((row) => row.id);
  if (removed.length) {
    const { error } = await client
      .from("metric_definitions")
      .delete()
      .in("id", removed);
    if (error) throw error;
  }
  if (metrics.length) {
    const { error } = await client.from("metric_definitions").upsert(
      metrics.map((metric) => metricRow(groupId, metric)),
      { onConflict: "group_id,owner_user_id,slug" },
    );
    if (error) throw error;
  }
}

async function groupMembers(groupIds: string[]) {
  const client = requireCloud();
  if (!groupIds.length)
    return new Map<string, { active: Member[]; pending: Member[] }>();
  const currentMembership = await client
    .from("group_members")
    .select("group_id, user_id, role, status")
    .in("group_id", groupIds);
  let membership: { group_id: string; user_id: string; role: Member["role"]; status: string }[];
  if (currentMembership.error && /status|column/i.test(currentMembership.error.message)) {
    const legacy = await client
      .from("group_members")
      .select("group_id, user_id, role")
      .in("group_id", groupIds);
    if (legacy.error) throw legacy.error;
    membership = (legacy.data ?? []).map((row) => ({ ...row, status: "active" })) as typeof membership;
  } else {
    if (currentMembership.error) throw currentMembership.error;
    membership = (currentMembership.data ?? []) as typeof membership;
  }
  const userIds = [...new Set((membership ?? []).map((row) => row.user_id))];
  const { data: profiles, error: profileError } = userIds.length
    ? await client
        .from("profiles")
        .select("id, display_name, avatar_path")
        .in("id", userIds)
    : { data: [], error: null };
  if (profileError) throw profileError;
  const profileMap = new Map(
    (profiles ?? []).map((profile) => [profile.id, profile]),
  );
  const urls = await signedUrls(
    (profiles ?? []).map((profile) => profile.avatar_path).filter(Boolean),
  );
  const result = new Map<string, { active: Member[]; pending: Member[] }>();
  for (const membershipRow of membership ?? []) {
    const profile = profileMap.get(membershipRow.user_id);
    const name = profile?.display_name || "MetricRally member";
    const member: Member = {
      id: membershipRow.user_id,
      name,
      initials: initials(name),
      color: memberColor(membershipRow.user_id),
      role: membershipRow.role,
      avatarStoragePath: profile?.avatar_path ?? undefined,
      avatarUri: profile?.avatar_path
        ? (urls.get(profile.avatar_path) ?? undefined)
        : undefined,
    };
    const current = result.get(membershipRow.group_id) ?? {
      active: [],
      pending: [],
    };
    const key = membershipRow.status === "pending" ? "pending" : "active";
    current[key].push(member);
    result.set(membershipRow.group_id, current);
  }
  return result;
}

export async function loadCloudGroupShells(): Promise<Group[]> {
  const client = requireCloud();
  const { data: memberships, error } = await client
    .from("group_members")
    .select("group_id, role");
  if (error) throw error;
  const groupIds = (memberships ?? []).map((row) => row.group_id);
  if (!groupIds.length) return [];
  const [
    { data: rows, error: groupError },
    { data: metrics, error: metricError },
    members,
  ] = await Promise.all([
    client
      .from("groups")
      .select("id, name, invite_code, template_name, settings")
      .in("id", groupIds),
    client.from("metric_definitions").select("*").in("group_id", groupIds),
    groupMembers(groupIds),
  ]);
  if (groupError) throw groupError;
  if (metricError) throw metricError;
  return (rows ?? []).map(
    (row): Group => ({
      id: row.id,
      name: row.name,
      inviteCode: row.invite_code,
      templateName: row.template_name,
      members: members.get(row.id)?.active ?? [],
      pendingMembers: members.get(row.id)?.pending ?? [],
      requireMemberApproval: Boolean(
        (row.settings as Record<string, any>)?.requireMemberApproval,
      ),
      streakRestDaysPerWeek: Number(
        (row.settings as Record<string, any>)?.streakRestDaysPerWeek ?? 1,
      ),
      themeColor: String(
        (row.settings as Record<string, any>)?.themeColor ?? "#176B4D",
      ),
      metricConfiguration: (metrics ?? [])
        .filter((metric) => metric.group_id === row.id)
        .map(metricFromRow)
        .sort((a, b) => a.order - b.order),
    }),
  );
}

export async function createCloudGroup(
  name: string,
  metrics: MetricDefinition[],
  user: User,
  displayName?: string,
) {
  const client = requireCloud();
  if (displayName?.trim()) {
    const { error } = await client
      .from("profiles")
      .update({ display_name: displayName.trim() })
      .eq("id", user.id);
    if (error) throw error;
  }
  const { data: atomicGroupId, error: atomicError } = await client.rpc(
    "create_group_with_metrics",
    {
      group_name: name.trim(),
      metric_configuration: metrics,
      group_theme_color: "#176B4D",
    },
  );
  if (!atomicError && atomicGroupId) return atomicGroupId as string;
  if (
    atomicError &&
    !/create_group_with_metrics|schema cache|function.*does not exist/i.test(
      atomicError.message,
    )
  )
    throw atomicError;

  let created: Record<string, any> | null = null;
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    const { data, error } = await client
      .from("groups")
      .insert({
        owner_id: user.id,
        name: name.trim(),
        invite_code: inviteCode(),
        template_name: "Healthy Competition",
        settings: { streakRestDaysPerWeek: 1, themeColor: "#176B4D" },
      })
      .select("id")
      .single();
    if (!error) created = data;
    else if (!/invite_code|duplicate/i.test(error.message)) throw error;
  }
  if (!created)
    throw new Error("Could not create a unique invitation code. Try again.");
  await upsertMetrics(created.id, metrics);
  return created.id as string;
}

export async function joinCloudGroup(code: string) {
  const client = requireCloud();
  const { data, error } = await client.rpc("request_group_membership", {
    code: code.trim().toUpperCase(),
  });
  if (error) {
    if (!/request_group_membership|schema cache|does not exist/i.test(error.message))
      throw error;
    const legacy = await client.rpc("join_group_with_code", {
      code: code.trim().toUpperCase(),
    });
    if (legacy.error) throw legacy.error;
    return { groupId: legacy.data as string, status: "active" as const };
  }
  const result = data as { groupId: string; status: "active" | "pending" };
  return result;
}

export async function approveCloudGroupMember(groupId: string, userId: string) {
  const { error } = await requireCloud()
    .from("group_members")
    .update({ status: "active" })
    .eq("group_id", groupId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function removeCloudGroupMember(groupId: string, userId: string) {
  const { error } = await requireCloud()
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function leaveCloudGroup(groupId: string) {
  const client = requireCloud();
  const { data: userData } = await client.auth.getUser();
  if (!userData.user) throw new Error("Sign in before leaving a cloud group.");
  const [
    { data: group, error: groupError },
    { data: members, error: memberError },
  ] = await Promise.all([
    client.from("groups").select("owner_id").eq("id", groupId).single(),
    client
      .from("group_members")
      .select("user_id, role, joined_at")
      .eq("group_id", groupId)
      .order("joined_at"),
  ]);
  if (groupError) throw groupError;
  if (memberError) throw memberError;
  if (group.owner_id === userData.user.id) {
    const successor = (members ?? [])
      .filter((member) => member.user_id !== userData.user!.id)
      .sort(
        (a, b) => (a.role === "admin" ? -1 : 1) - (b.role === "admin" ? -1 : 1),
      )[0];
    if (!successor) {
      const { error } = await client.from("groups").delete().eq("id", groupId);
      if (error) throw error;
      return;
    }
    const { error: ownerError } = await client
      .from("groups")
      .update({ owner_id: successor.user_id })
      .eq("id", groupId);
    if (ownerError) throw ownerError;
    const { error: roleError } = await client
      .from("group_members")
      .update({ role: "owner" })
      .eq("group_id", groupId)
      .eq("user_id", successor.user_id);
    if (roleError) throw roleError;
  }
  const { error } = await client
    .from("group_members")
    .delete()
    .eq("group_id", groupId);
  if (error) throw error;
}

export async function loadCloudWorkspace(
  state: AppState,
  groupId: string,
): Promise<AppState> {
  const client = requireCloud();
  const shells = await loadCloudGroupShells();
  const group = shells.find((candidate) => candidate.id === groupId);
  if (!group)
    throw new Error("This group is unavailable or you no longer have access.");
  const groupMetrics = (group.metricConfiguration ?? []).sort(
    (a, b) => a.order - b.order,
  );
  const missingTracked = groupMetrics.filter(
    (metric) =>
      metric.sections.group &&
      (metric.scoreWeight > 0 ||
        metric.dataType === "photo" ||
        metric.dataType === "text") &&
      !state.metrics.some((personal) => personal.id === metric.id),
  );
  const personalMetrics = [
    ...state.metrics.map((personal) => {
      const shared = groupMetrics.find(
        (metric) =>
          metric.id === personal.id &&
          (metric.scoreWeight > 0 ||
            metric.dataType === "photo" ||
            metric.dataType === "text"),
      );
      return shared
        ? {
            ...shared,
            goal: personal.goal,
            goalRange: personal.goalRange,
            goalEnabled: personal.goalEnabled,
            defaultVisibility: personal.defaultVisibility,
            sections: {
              ...shared.sections,
              today: personal.sections.today,
              insights: personal.sections.insights,
            },
            order: personal.order,
            activeFrom: personal.activeFrom,
          }
        : personal;
    }),
    ...missingTracked.map((metric, index) => ({
      ...metric,
      order: state.metrics.length + index,
      sections: { ...metric.sections, today: true, insights: true },
    })),
  ];
  const { data: metricRows, error: metricError } = await client
    .from("metric_definitions")
    .select("id, slug")
    .eq("group_id", groupId);
  if (metricError) throw metricError;
  const metricIds = (metricRows ?? []).map((row) => row.id);
  const slugById = new Map((metricRows ?? []).map((row) => [row.id, row.slug]));
  const [entryResult, statusResult, messageResult, photoResult] =
    await Promise.all([
      metricIds.length
        ? client
            .from("metric_entries")
            .select("*")
            .in("metric_id", metricIds)
            .order("recorded_at")
        : Promise.resolve({ data: [], error: null }),
      client.from("daily_metric_status").select("*").eq("group_id", groupId),
      client
        .from("messages")
        .select("*")
        .eq("group_id", groupId)
        .order("created_at"),
      client
        .from("photo_updates")
        .select("*")
        .eq("group_id", groupId)
        .order("created_at", { ascending: false }),
    ]);
  if (entryResult.error) throw entryResult.error;
  if (statusResult.error) throw statusResult.error;
  if (messageResult.error) throw messageResult.error;
  if (photoResult.error) throw photoResult.error;
  const mediaIds = (photoResult.data ?? []).map(
    (photo) => photo.media_asset_id,
  );
  const { data: media, error: mediaError } = mediaIds.length
    ? await client
        .from("media_assets")
        .select("id, storage_path, captured_at")
        .in("id", mediaIds)
    : { data: [], error: null };
  if (mediaError) throw mediaError;
  const mediaById = new Map((media ?? []).map((item) => [item.id, item]));
  const paths = [
    ...(entryResult.data ?? [])
      .map((entry) => entry.image_path)
      .filter(Boolean),
    ...(messageResult.data ?? [])
      .map((message) => message.image_path)
      .filter(Boolean),
    ...(media ?? []).map((item) => item.storage_path).filter(Boolean),
  ];
  const urls = await signedUrls(paths);
  const entries: MetricEntry[] = (entryResult.data ?? []).map((entry) => ({
    id: entry.client_generated_id,
    metricId: slugById.get(entry.metric_id) ?? entry.metric_id,
    userId: entry.user_id,
    value: entry.value as number | boolean | string,
    localDate: entry.local_date,
    recordedAt: entry.recorded_at,
    visibility: entry.visibility,
    source: entry.source,
    label: entry.label ?? undefined,
    note: entry.note ?? undefined,
    nutrition: entry.nutrition ?? undefined,
    sourceProvider: entry.source_provider ?? undefined,
    sourceRecordId: entry.source_record_id ?? undefined,
    sourceOrigin: entry.source_origin ?? undefined,
    sourceUpdatedAt: entry.source_updated_at ?? undefined,
    imageStoragePath: entry.image_path ?? undefined,
    imageUri: entry.image_path
      ? (urls.get(entry.image_path) ?? undefined)
      : undefined,
  }));
  const dailyMetricStatuses: DailyMetricStatus[] = (
    statusResult.data ?? []
  ).map((status) => ({
    groupId,
    metricId: slugById.get(status.metric_id) ?? status.metric_id,
    userId: status.user_id,
    localDate: status.local_date,
    goalReached: status.goal_reached,
    scoreContribution: Number(status.score_contribution ?? 0),
  }));
  const remoteMessages: ChatMessage[] = (messageResult.data ?? []).map(
    (message) => ({
      id: message.client_generated_id ?? message.id,
      senderId: message.sender_id ?? "system",
      text: message.content,
      createdAt: message.created_at,
      kind: message.kind,
      conversationId: message.conversation_id,
      recipientId: message.recipient_id ?? undefined,
      imageStoragePath: message.image_path ?? undefined,
      imageUri: message.image_path
        ? (urls.get(message.image_path) ?? undefined)
        : undefined,
    }),
  );
  // Keep locally-created messages until their cloud upsert is visible. A realtime
  // refresh must never make a just-sent message (or offline history) disappear.
  const messagesById = new Map(
    remoteMessages.map((message) => [message.id, message]),
  );
  state.messages
    .filter(
      (message) =>
        message.senderId === state.currentUserId &&
        (message.conversationId === `group:${groupId}` ||
          Boolean(
            message.recipientId &&
              group.members.some((member) => member.id === message.recipientId),
          )),
    )
    .forEach((message) => {
      if (!messagesById.has(message.id)) messagesById.set(message.id, message);
    });
  const messages = [...messagesById.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const photos: PhotoUpdate[] = (photoResult.data ?? []).map((photo) => {
    const asset = mediaById.get(photo.media_asset_id);
    const path = asset?.storage_path;
    return {
      id: photo.client_generated_id ?? photo.id,
      userId: photo.owner_user_id,
      uri: path ? (urls.get(path) ?? "") : "",
      storagePath: path,
      caption: photo.caption,
      localDate: photo.local_date,
      createdAt: photo.created_at,
      capturedAt: asset?.captured_at ?? undefined,
      visibility: photo.visibility,
    };
  });
  return {
    ...state,
    group,
    groups: shells,
    metrics: personalMetrics,
    trackedGoalPeriods: Object.fromEntries(
      personalMetrics.map((metric) => [
        metric.id,
        state.trackedGoalPeriods[metric.id] ?? [],
      ]),
    ),
    entries,
    photos,
    messages,
    dailyMetricStatuses,
    selectedGroupMetricId: groupMetrics.some(
      (metric) => metric.id === state.selectedGroupMetricId,
    )
      ? state.selectedGroupMetricId
      : (groupMetrics[0]?.id ?? "steps"),
  };
}

export async function pushCloudWorkspace(state: AppState) {
  if (!isCloudGroupId(state.group.id)) return;
  const client = requireCloud();
  const current = state.group.members.find(
    (member) => member.id === state.currentUserId,
  );
  if (!current) return;
  const canManage = current.role === "owner" || current.role === "admin";
  const { error: profileError } = await client
    .from("profiles")
    .update({
      display_name: current.name,
      avatar_path: current.avatarStoragePath ?? null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    })
    .eq("id", state.currentUserId);
  if (profileError) throw profileError;
  const profile =
    state.energyProfiles[state.currentUserId] ?? state.settings.energyProfile;
  const { error: energyError } = await client.from("energy_profiles").upsert({
    user_id: state.currentUserId,
    age: profile.age,
    biological_sex: profile.sex,
    height_cm: profile.heightCm,
    weight_kg: profile.weightKg,
    target_weight_kg: profile.targetWeightKg,
    activity_level: profile.activityLevel,
    desired_weekly_loss_kg: profile.desiredWeeklyLossKg,
  });
  if (energyError) throw energyError;
  if (canManage) {
    const { error: groupError } = await client
      .from("groups")
      .update({
        name: state.group.name,
        template_name: state.group.templateName,
        settings: {
          streakRestDaysPerWeek: state.group.streakRestDaysPerWeek,
          themeColor: state.group.themeColor ?? "#176B4D",
          requireMemberApproval: state.group.requireMemberApproval ?? false,
        },
      })
      .eq("id", state.group.id);
    if (groupError) throw groupError;
    await upsertMetrics(state.group.id, state.group.metricConfiguration ?? []);
    if (current.role === "owner") {
      for (const member of state.group.members.filter(
        (member) => member.role !== "owner",
      )) {
        const { error } = await client
          .from("group_members")
          .update({ role: member.role })
          .eq("group_id", state.group.id)
          .eq("user_id", member.id);
        if (error) throw error;
      }
    }
  }
  const { data: metricRows, error: metricError } = await client
    .from("metric_definitions")
    .select("id, slug")
    .eq("group_id", state.group.id);
  if (metricError) throw metricError;
  const idBySlug = new Map((metricRows ?? []).map((row) => [row.slug, row.id]));
  const ownedEntries = state.entries.filter(
    (entry) =>
      entry.userId === state.currentUserId && idBySlug.has(entry.metricId),
  );
  const { data: oldEntries, error: oldEntryError } = await client
    .from("metric_entries")
    .select("client_generated_id")
    .eq("user_id", state.currentUserId)
    .in("metric_id", [...idBySlug.values()]);
  if (oldEntryError) throw oldEntryError;
  const oldEntryIds = new Set(
    (oldEntries ?? []).map((entry) => entry.client_generated_id),
  );
  const newSharedEntries = ownedEntries.filter(
    (entry) => !oldEntryIds.has(entry.id) && entry.visibility !== "private",
  );
  const currentEntryIds = new Set(ownedEntries.map((entry) => entry.id));
  const deletedEntryIds = (oldEntries ?? [])
    .map((entry) => entry.client_generated_id)
    .filter((id) => !currentEntryIds.has(id));
  if (deletedEntryIds.length) {
    const { error } = await client
      .from("metric_entries")
      .delete()
      .eq("user_id", state.currentUserId)
      .in("client_generated_id", deletedEntryIds);
    if (error) throw error;
  }
  await Promise.allSettled(
    newSharedEntries.map((entry) => {
      const metric =
        (state.group.metricConfiguration ?? []).find(
          (item) => item.id === entry.metricId,
        ) ?? state.metrics.find((item) => item.id === entry.metricId);
      return client.functions.invoke("send-push", {
        body: {
          eventKey: `entry:${state.group.id}:${entry.id}`,
          groupId: state.group.id,
          category: "metric",
          metricId: entry.metricId,
          title: `${current.name} logged ${metric?.name ?? "a metric"}`,
          body:
            entry.visibility === "group" &&
            metric &&
            typeof entry.value !== "string"
              ? formatMetricValue(metric, Number(entry.value))
              : `A shared ${metric?.name ?? "metric"} update was added.`,
          data: { route: `/day/${entry.localDate}`, metricId: entry.metricId },
        },
      });
    }),
  );
  await Promise.allSettled(
    newSharedEntries.map((entry) => {
      const metric = (state.group.metricConfiguration ?? []).find(
        (item) => item.id === entry.metricId,
      );
      if (!metric || (!metric.sections.group && metric.scoreWeight <= 0))
        return Promise.resolve();
      const currentLeader = rankedMembers(state, metric, entry.localDate)[0]
        ?.member;
      const previousState = {
        ...state,
        entries: state.entries.filter((item) => item.id !== entry.id),
      };
      const previousLeader = rankedMembers(
        previousState,
        metric,
        entry.localDate,
      )[0]?.member;
      if (
        !currentLeader ||
        currentLeader.id !== state.currentUserId ||
        !previousLeader ||
        previousLeader.id === currentLeader.id
      )
        return Promise.resolve();
      return client.functions.invoke("send-push", {
        body: {
          eventKey: `lead:${state.group.id}:${entry.id}`,
          groupId: state.group.id,
          category: "lead",
          metricId: metric.id,
          title: `${current.name} took the lead`,
          body: `${current.name} passed ${previousLeader.name} in ${metric.name}.`,
          data: { route: "/group", metricId: metric.id },
        },
      });
    }),
  );
  if (ownedEntries.length) {
    const { error } = await client.from("metric_entries").upsert(
      ownedEntries.map((entry) => ({
        client_generated_id: entry.id,
        metric_id: idBySlug.get(entry.metricId),
        user_id: state.currentUserId,
        value: entry.value,
        local_date: entry.localDate,
        recorded_at: entry.recordedAt,
        visibility: entry.visibility,
        source: entry.source,
        label: entry.label ?? null,
        note: entry.note ?? null,
        nutrition: entry.nutrition ?? null,
        image_path: entry.imageStoragePath ?? null,
        source_provider: entry.sourceProvider ?? null,
        source_record_id: entry.sourceRecordId ?? null,
        source_origin: entry.sourceOrigin ?? null,
        source_updated_at: entry.sourceUpdatedAt ?? null,
      })),
      { onConflict: "user_id,client_generated_id" },
    );
    if (error) throw error;
  }

  const statusDates = [
    ...new Set(ownedEntries.map((entry) => entry.localDate)),
  ];
  await client
    .from("daily_metric_status")
    .delete()
    .eq("group_id", state.group.id)
    .eq("user_id", state.currentUserId);
  const statuses = statusDates.flatMap((localDate) =>
    (state.group.metricConfiguration ?? [])
      .filter((metric) => metric.dataType !== "text" && idBySlug.has(metric.id))
      .map((metric) => {
        const value = safeMetricValue(
          state,
          metric,
          state.currentUserId,
          localDate,
        );
        return {
          group_id: state.group.id,
          metric_id: idBySlug.get(metric.id),
          user_id: state.currentUserId,
          local_date: localDate,
          goal_reached: goalReached(
            metric,
            value,
            effectiveGoalTarget(state, metric, state.currentUserId, localDate),
          ),
          score_contribution:
            Math.min(
              goalProgress(
                metric,
                value,
                effectiveGoalTarget(
                  state,
                  metric,
                  state.currentUserId,
                  localDate,
                ),
              ),
              1,
            ) * 100,
        };
      }),
  );
  if (statuses.length) {
    const { error } = await client.from("daily_metric_status").insert(statuses);
    if (error) throw error;
  }

  const ownedMessages = state.messages.filter(
    (message) => message.senderId === state.currentUserId,
  );
  const { data: oldMessages, error: oldMessageError } = await client
    .from("messages")
    .select("client_generated_id")
    .eq("group_id", state.group.id)
    .eq("sender_id", state.currentUserId);
  if (oldMessageError) throw oldMessageError;
  const oldMessageIds = new Set(
    (oldMessages ?? []).map((message) => message.client_generated_id),
  );
  const newMessages = ownedMessages.filter(
    (message) => !oldMessageIds.has(message.id),
  );
  // Chat is append-preserving. Missing local rows may simply be an older or
  // partially loaded snapshot, so absence must not be interpreted as deletion.
  if (ownedMessages.length) {
    const { error } = await client.from("messages").upsert(
      ownedMessages.map((message) => ({
        group_id: state.group.id,
        sender_id: state.currentUserId,
        client_generated_id: message.id,
        kind: message.kind,
        content: message.text,
        conversation_id: message.conversationId ?? `group:${state.group.id}`,
        recipient_id: message.recipientId ?? null,
        image_path: message.imageStoragePath ?? null,
        metadata: {},
        created_at: message.createdAt,
      })),
      { onConflict: "sender_id,client_generated_id" },
    );
    if (error) throw error;
  }
  await Promise.allSettled(
    newMessages.map((message) =>
      client.functions.invoke("send-push", {
        body: {
          eventKey: `message:${state.group.id}:${message.id}`,
          groupId: state.group.id,
          category: "chat",
          recipientId: message.recipientId,
          title: message.recipientId
            ? `Private message from ${current.name}`
            : `${current.name} in ${state.group.name}`,
          body: message.text || "Sent an image",
          data: {
            route: "/chat",
            conversationId: message.conversationId ?? `group:${state.group.id}`,
          },
        },
      }),
    ),
  );

  const ownedPhotos = state.photos.filter(
    (photo) => photo.userId === state.currentUserId && photo.storagePath,
  );
  const { data: oldPhotos, error: oldPhotoError } = await client
    .from("photo_updates")
    .select("client_generated_id")
    .eq("group_id", state.group.id)
    .eq("owner_user_id", state.currentUserId);
  if (oldPhotoError) throw oldPhotoError;
  const currentPhotoIds = new Set(ownedPhotos.map((photo) => photo.id));
  const deletedPhotoIds = (oldPhotos ?? [])
    .map((photo) => photo.client_generated_id)
    .filter((id) => id && !currentPhotoIds.has(id));
  if (deletedPhotoIds.length)
    await client
      .from("photo_updates")
      .delete()
      .eq("group_id", state.group.id)
      .eq("owner_user_id", state.currentUserId)
      .in("client_generated_id", deletedPhotoIds);
  for (const photo of ownedPhotos) {
    const { data: asset, error: assetError } = await client
      .from("media_assets")
      .upsert(
        {
          owner_user_id: state.currentUserId,
          storage_path: photo.storagePath,
          captured_at: photo.capturedAt ?? photo.createdAt,
        },
        { onConflict: "storage_path" },
      )
      .select("id")
      .single();
    if (assetError) throw assetError;
    const { error } = await client.from("photo_updates").upsert(
      {
        media_asset_id: asset.id,
        owner_user_id: state.currentUserId,
        group_id: state.group.id,
        client_generated_id: photo.id,
        caption: photo.caption,
        local_date: photo.localDate,
        visibility: photo.visibility,
        created_at: photo.createdAt,
      },
      { onConflict: "owner_user_id,client_generated_id" },
    );
    if (error) throw error;
  }

  const aliases = state.settings.memberNicknamesByGroup[state.group.id] ?? {};
  await client
    .from("group_member_aliases")
    .delete()
    .eq("owner_user_id", state.currentUserId)
    .eq("group_id", state.group.id);
  const aliasRows = Object.entries(aliases)
    .filter(([, alias]) => alias.trim())
    .map(([memberId, alias]) => ({
      owner_user_id: state.currentUserId,
      group_id: state.group.id,
      subject_user_id: memberId,
      alias: alias.trim(),
    }));
  if (aliasRows.length) {
    const { error } = await client
      .from("group_member_aliases")
      .insert(aliasRows);
    if (error) throw error;
  }
}
