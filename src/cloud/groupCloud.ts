import { User } from "@supabase/supabase-js";

import { DEFAULT_METRICS } from "@/src/data/seed";
import {
  effectiveGoalTarget,
  displayGoalProgress,
  formatMetricValue,
  goalProgress,
  hasMetricData,
  isMetricTrackedOnDate,
  metricApplicableOnDate,
  rankedMembers,
  safeMetricValue,
  scheduledGoalReached,
} from "@/src/domain/metrics";
import { normalizeEnergyProfile } from "@/src/domain/energy";
import {
  isBloodPressureDiastolic,
  isBloodPressureSystolic,
} from "@/src/domain/trackerCatalog";
import {
  isVacationDate,
  vacationDates,
} from "@/src/domain/vacation";
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
  const preset = DEFAULT_METRICS.find((metric) => metric.id === row.slug);
  const category = configuration.category ?? preset?.category ?? "other";
  const gymMapping =
    configuration.gymMapping ??
    preset?.gymMapping ??
    (category === "gym" && row.data_type === "number"
      ? {
          kind: "exercise_one_rep_max" as const,
          exerciseKey: `group:${row.group_id}:${row.slug}`,
        }
      : undefined);
  return {
    id: row.slug,
    name: row.slug === "blood_pressure_systolic" ? "Blood pressure" : row.name,
    icon: row.icon,
    color: row.color,
    unit: row.unit,
    dataType: row.data_type,
    aggregation: row.aggregation_method,
    rankingDirection: row.ranking_direction,
    goal: configuration.goal ?? { kind: "at_least", target: 1 },
    goalEnabled:
      row.slug === "lean_body_mass"
        ? false
        : configuration.goalEnabled ?? preset?.goalEnabled ?? true,
    goalRange: configuration.goalRange,
    category,
    healthMapping: configuration.healthMapping ?? preset?.healthMapping,
    gymMapping,
    gymMuscleGroups:
      configuration.gymMuscleGroups ?? preset?.gymMuscleGroups,
    stepFallback: configuration.stepFallback ?? preset?.stepFallback,
    manualEntry:
      gymMapping
        ? false
        : configuration.manualEntry ?? preset?.manualEntry ?? row.slug !== "steps",
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
    goalSchedule: configuration.goalSchedule,
    reminder: configuration.reminder,
    reminders: configuration.reminders,
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
      gymMapping: metric.gymMapping,
      gymMuscleGroups: metric.gymMuscleGroups,
      stepFallback: metric.stepFallback,
      manualEntry: metric.manualEntry,
      sections: metric.sections,
      order: metric.order,
      activeFrom: metric.activeFrom,
      goalSchedule: metric.goalSchedule,
      reminder: metric.reminder,
      reminders: metric.reminders,
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

/** Lightweight realtime chat refresh; avoids reloading every group entry. */
export async function loadCloudMessages(
  state: AppState,
  groupId: string,
): Promise<ChatMessage[]> {
  const client = requireCloud();
  const { data, error } = await client
    .from("messages")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at");
  if (error) throw error;
  const rows = data ?? [];
  const urls = await signedUrls(
    rows.map((message) => message.image_path).filter(Boolean),
  );
  const remote: ChatMessage[] = rows.map((message) => ({
    id: message.client_generated_id ?? message.id,
    senderId: message.sender_id ?? "system",
    text: message.content,
    createdAt: message.created_at,
    kind: message.kind,
    conversationId: message.conversation_id ?? `group:${groupId}`,
    recipientId: message.recipient_id ?? undefined,
    imageStoragePath: message.image_path ?? undefined,
    imageUri: message.image_path
      ? (urls.get(message.image_path) ?? undefined)
      : undefined,
  }));
  const byId = new Map(remote.map((message) => [message.id, message]));
  state.messages
    .filter(
      (message) =>
        message.senderId === state.currentUserId &&
        (message.conversationId === `group:${groupId}` ||
          Boolean(
            message.recipientId &&
              state.group.members.some(
                (member) => member.id === message.recipientId,
              ),
          )),
    )
    .forEach((message) => {
      const matched = remote.some(
        (candidate) =>
          candidate.senderId === message.senderId &&
          candidate.text === message.text &&
          candidate.createdAt === message.createdAt,
      );
      if (!matched && !byId.has(message.id)) byId.set(message.id, message);
    });
  return [...byId.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

/** Refresh leaderboard values without reloading members, chat, or photos. */
export async function loadCloudGroupActivity(
  state: AppState,
  groupId: string,
): Promise<Pick<AppState, "entries" | "dailyMetricStatuses">> {
  const client = requireCloud();
  const { data: metricRows, error: metricError } = await client
    .from("metric_definitions")
    .select("id, slug")
    .eq("group_id", groupId);
  if (metricError) throw metricError;
  const metricIds = (metricRows ?? []).map((row) => row.id);
  const slugById = new Map((metricRows ?? []).map((row) => [row.id, row.slug]));
  const [entryResult, statusResult] = await Promise.all([
    metricIds.length
      ? client
          .from("metric_entries")
          .select("*")
          .in("metric_id", metricIds)
          .order("recorded_at")
      : Promise.resolve({ data: [], error: null }),
    client.from("daily_metric_status").select("*").eq("group_id", groupId),
  ]);
  if (entryResult.error) throw entryResult.error;
  if (statusResult.error) throw statusResult.error;
  const urls = await signedUrls(
    (entryResult.data ?? []).map((entry) => entry.image_path).filter(Boolean),
  );
  const remoteEntries: MetricEntry[] = (entryResult.data ?? []).map((entry) => ({
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
  const entriesById = new Map(remoteEntries.map((entry) => [entry.id, entry]));
  state.entries
    .filter((entry) => entry.userId === state.currentUserId)
    .forEach((entry) => {
      if (!entriesById.has(entry.id)) entriesById.set(entry.id, entry);
    });
  const dailyMetricStatuses: DailyMetricStatus[] = (
    statusResult.data ?? []
  ).map((status) => ({
    groupId,
    metricId: slugById.get(status.metric_id) ?? status.metric_id,
    userId: status.user_id,
    localDate: status.local_date,
    goalReached: Boolean(status.goal_reached),
    scoreContribution: Number(status.score_contribution ?? 0),
    goalProgress:
      status.goal_progress === null || status.goal_progress === undefined
        ? undefined
        : Number(status.goal_progress),
    goalKind: status.goal_kind ?? undefined,
    goalEligible:
      status.goal_eligible === null || status.goal_eligible === undefined
        ? undefined
        : Boolean(status.goal_eligible),
    exactValue:
      status.exact_value === null || status.exact_value === undefined
        ? undefined
        : Number(status.exact_value),
    hasData:
      status.has_data === null || status.has_data === undefined
        ? undefined
        : Boolean(status.has_data),
    syncedAt: status.updated_at ?? undefined,
  }));
  return {
    entries: [...entriesById.values()].sort((a, b) =>
      a.recordedAt.localeCompare(b.recordedAt),
    ),
    dailyMetricStatuses,
  };
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
  const currentMemberships = await client
    .from("group_members")
    .select("group_id, role, status");
  let memberships = currentMemberships.data;
  if (currentMemberships.error) {
    if (!/status|column|schema cache/i.test(currentMemberships.error.message))
      throw currentMemberships.error;
    const legacy = await client.from("group_members").select("group_id, role");
    if (legacy.error) throw legacy.error;
    memberships = (legacy.data ?? []).map((row) => ({ ...row, status: "active" }));
  }
  // Pending requests are not workspaces yet. Including them here caused a
  // failed protected-table load to replace the user's valid active group.
  const groupIds = (memberships ?? [])
    .filter((row) => row.status !== "pending")
    .map((row) => row.group_id);
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
      gymPlans: Array.isArray(
        (row.settings as Record<string, any>)?.gymPlans,
      )
        ? (row.settings as Record<string, any>).gymPlans
        : [],
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
  themeColor = "#176B4D",
  requireMemberApproval = false,
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
      group_theme_color: themeColor,
    },
  );
  if (!atomicError && atomicGroupId) {
    // The RPC creates membership atomically; this follow-up writes the complete
    // versioned configuration (including schedules, reminders and mappings).
    await upsertMetrics(atomicGroupId as string, metrics);
    const { error: settingsError } = await client
      .from("groups")
      .update({
        settings: {
          streakRestDaysPerWeek: 1,
          themeColor,
          requireMemberApproval,
        },
      })
      .eq("id", atomicGroupId);
    if (settingsError) throw settingsError;
    return atomicGroupId as string;
  }
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
        settings: {
          streakRestDaysPerWeek: 1,
          themeColor,
          requireMemberApproval,
        },
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
    if (/request_group_membership|schema cache|does not exist/i.test(error.message))
      throw new Error(
        "Group approval is not installed on the cloud project yet. Apply the latest Supabase migration and try again.",
      );
    throw error;
  }
  const result = data as {
    groupId: string;
    groupName?: string;
    status: "active" | "pending";
  };
  return result;
}

export async function sendMembershipPush(input: {
  groupId: string;
  eventKey: string;
  title: string;
  body: string;
  audience: "admins" | "user" | "group";
  recipientId?: string;
  route?: string;
}) {
  const { error } = await requireCloud().functions.invoke("send-push", {
    body: {
      eventKey: input.eventKey,
      groupId: input.groupId,
      category: "membership",
      audience: input.audience,
      recipientId: input.recipientId,
      title: input.title,
      body: input.body,
      data: {
        route: input.route ?? "/groups",
        groupId: input.groupId,
      },
    },
  });
  if (error) throw error;
}

export async function setCloudGroupApprovalRequired(
  groupId: string,
  required: boolean,
) {
  const client = requireCloud();
  const { data, error } = await client
    .from("groups")
    .select("settings")
    .eq("id", groupId)
    .single();
  if (error) throw error;
  const settings = {
    ...((data?.settings as Record<string, unknown> | null) ?? {}),
    requireMemberApproval: required,
  };
  const { error: updateError } = await client
    .from("groups")
    .update({ settings })
    .eq("id", groupId);
  if (updateError) throw updateError;
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
    .eq("group_id", groupId)
    .eq("user_id", userData.user.id);
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
      (metric.sections.group ||
        (isBloodPressureDiastolic(metric) &&
          groupMetrics.some(
            (candidate) =>
              candidate.sections.group &&
              isBloodPressureSystolic(candidate),
          ))) &&
      !state.metrics.some((personal) => personal.id === metric.id),
  );
  const personalMetrics = [
    ...state.metrics.map((personal) => {
      const shared = groupMetrics.find(
        (metric) =>
          metric.id === personal.id && metric.sections.group,
      );
      return shared
        ? {
            ...shared,
            goal: personal.goal,
            goalRange: personal.goalRange,
            goalEnabled: personal.goalEnabled,
            defaultVisibility: personal.defaultVisibility,
            healthMapping: personal.healthMapping ?? shared.healthMapping,
            gymMapping: personal.gymMapping ?? shared.gymMapping,
            gymMuscleGroups:
              personal.gymMuscleGroups ?? shared.gymMuscleGroups,
            stepFallback: personal.stepFallback ?? shared.stepFallback,
            manualEntry: personal.manualEntry ?? shared.manualEntry,
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
      defaultVisibility: "group" as const,
      order: state.metrics.length + index,
      sections: {
        ...metric.sections,
        today: !isBloodPressureDiastolic(metric),
        insights: !isBloodPressureDiastolic(metric),
      },
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
  // A stale chat schema must not make the entire group disappear. The local
  // snapshot remains usable while the latest migration is being applied.
  const messageRows = messageResult.error ? [] : (messageResult.data ?? []);
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
    ...messageRows
      .map((message) => message.image_path)
      .filter(Boolean),
    ...(media ?? []).map((item) => item.storage_path).filter(Boolean),
  ];
  const urls = await signedUrls(paths);
  const remoteEntries: MetricEntry[] = (entryResult.data ?? []).map((entry) => ({
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
  // Realtime group refreshes can arrive before a newly imported/corrected
  // health row finishes its cloud upsert. Keep the newer owned local row so a
  // chat message or membership event cannot roll health data backward.
  const entriesById = new Map(
    remoteEntries.map((entry) => [entry.id, entry]),
  );
  const cloudMetricSlugs = new Set(slugById.values());
  state.entries
    .filter((entry) => entry.userId === state.currentUserId)
    .forEach((local) => {
      const remote = entriesById.get(local.id);
      const healthPayloadChanged =
        Boolean(local.sourceProvider) &&
        Boolean(remote) &&
        JSON.stringify({
          value: local.value,
          label: local.label,
          note: local.note,
          nutrition: local.nutrition,
          recordedAt: local.recordedAt,
        }) !==
          JSON.stringify({
            value: remote?.value,
            label: remote?.label,
            note: remote?.note,
            nutrition: remote?.nutrition,
            recordedAt: remote?.recordedAt,
          });
      const localIsNewer =
        Boolean(local.sourceUpdatedAt) &&
        (!remote?.sourceUpdatedAt ||
          local.sourceUpdatedAt! > remote.sourceUpdatedAt);
      if (
        !cloudMetricSlugs.has(local.metricId) ||
        !remote ||
        localIsNewer ||
        healthPayloadChanged
      )
        entriesById.set(local.id, local);
    });
  const entries = [...entriesById.values()].sort((a, b) =>
    a.recordedAt.localeCompare(b.recordedAt),
  );
  const dailyMetricStatuses: DailyMetricStatus[] = (
    statusResult.data ?? []
  ).map((status) => ({
    groupId,
    metricId: slugById.get(status.metric_id) ?? status.metric_id,
    userId: status.user_id,
    localDate: status.local_date,
    goalReached: status.goal_reached,
    scoreContribution: Number(status.score_contribution ?? 0),
  goalProgress:
      status.goal_progress === null || status.goal_progress === undefined
        ? undefined
        : Number(status.goal_progress),
    goalKind: status.goal_kind ?? undefined,
    goalEligible:
      status.goal_eligible === null || status.goal_eligible === undefined
        ? undefined
        : Boolean(status.goal_eligible),
    exactValue:
      status.exact_value === null || status.exact_value === undefined
        ? undefined
        : Number(status.exact_value),
    hasData:
      status.has_data === null || status.has_data === undefined
        ? undefined
        : Boolean(status.has_data),
    syncedAt: status.updated_at ?? undefined,
  }));
  const remoteMessages: ChatMessage[] = messageRows.map(
    (message) => ({
      id: message.client_generated_id ?? message.id,
      senderId: message.sender_id ?? "system",
      text: message.content,
      createdAt: message.created_at,
      kind: message.kind,
      conversationId: message.conversation_id ?? `group:${groupId}`,
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
      const alreadyRemote = remoteMessages.some(
        (remote) =>
          remote.senderId === message.senderId &&
          remote.text === message.text &&
          remote.createdAt === message.createdAt,
      );
      if (!alreadyRemote && !messagesById.has(message.id))
        messagesById.set(message.id, message);
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

/** Fast chat-only upload used before the heavier account/workspace backup. */
export async function pushCloudMessagesNow(state: AppState) {
  if (!isCloudGroupId(state.group.id)) return;
  const client = requireCloud();
  const sender = state.group.members.find(
    (member) => member.id === state.currentUserId,
  );
  if (!sender) return;
  const owned = state.messages
    .filter((message) => message.senderId === state.currentUserId)
    .slice(-30);
  if (!owned.length) return;
  const current = await client
    .from("messages")
    .select("client_generated_id, push_dispatched_at")
    .eq("group_id", state.group.id)
    .eq("sender_id", state.currentUserId)
    .in(
      "client_generated_id",
      owned.map((message) => message.id),
    );
  if (current.error) throw current.error;
  const rows = new Map(
    (current.data ?? []).map((row) => [row.client_generated_id, row]),
  );
  const pending = owned.filter(
    (message) =>
      !rows.has(message.id) || !rows.get(message.id)?.push_dispatched_at,
  );
  if (!pending.length) return;
  const upsert = await client.from("messages").upsert(
    pending.map((message) => ({
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
  if (upsert.error) throw upsert.error;
  await Promise.all(
    pending.map(async (message) => {
      const result = await client.functions.invoke("send-push", {
        body: {
          eventKey: `message:${state.group.id}:${message.id}`,
          clientMessageId: message.id,
          groupId: state.group.id,
          category: "chat",
          recipientId: message.recipientId,
          title: message.recipientId
            ? `Private message from ${sender.name}`
            : `${sender.name} in ${state.group.name}`,
          body: message.text || "Sent an image",
          data: {
            route: "/chat",
            messageId: message.id,
            senderName: sender.name,
            conversationId:
              message.conversationId ?? `group:${state.group.id}`,
          },
        },
      });
      if (result.error) throw result.error;
    }),
  );
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
  const profile = normalizeEnergyProfile(
    state.energyProfiles[state.currentUserId] ?? state.settings.energyProfile,
  );
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
          gymPlans: state.group.gymPlans ?? [],
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
    ...new Set([
      ...ownedEntries.map((entry) => entry.localDate),
      ...(state.gymSessions ?? [])
        .filter((session) => session.userId === state.currentUserId)
        .map((session) => session.localDate),
      ...vacationDates(state, state.currentUserId),
    ]),
  ];
  await client
    .from("daily_metric_status")
    .delete()
    .eq("group_id", state.group.id)
    .eq("user_id", state.currentUserId);
  const statuses = statusDates.flatMap((localDate) =>
    (state.group.metricConfiguration ?? [])
      .filter((groupMetric) => {
        const personalMetric =
          state.metrics.find((metric) => metric.id === groupMetric.id) ??
          groupMetric;
        return (
          groupMetric.dataType !== "text" &&
          idBySlug.has(groupMetric.id) &&
          metricApplicableOnDate(
            state,
            personalMetric,
            state.currentUserId,
            localDate,
          )
        );
      })
      .map((groupMetric) => {
        const metric =
          state.metrics.find((candidate) => candidate.id === groupMetric.id) ??
          groupMetric;
        const value = safeMetricValue(
          state,
          metric,
          state.currentUserId,
          localDate,
        );
        const hasExactSharedEntry = ownedEntries.some(
          (entry) =>
            entry.metricId === metric.id &&
            entry.localDate === localDate &&
            entry.visibility === "group",
        );
        const exactShared =
          !isVacationDate(state, state.currentUserId, localDate) &&
          (hasExactSharedEntry ||
            (metric.defaultVisibility === "group" &&
              (metric.dataType === "calculated" ||
                (Boolean(metric.gymMapping) &&
                  (state.gymSessions ?? []).some(
                    (session) =>
                      session.userId === state.currentUserId &&
                      session.localDate === localDate &&
                      session.visibility === "group",
                  )) ||
                metric.stepFallback === true)));
        const hasData = hasMetricData(
          state,
          metric,
          state.currentUserId,
          localDate,
        );
        return {
          group_id: state.group.id,
          metric_id: idBySlug.get(groupMetric.id),
          user_id: state.currentUserId,
          local_date: localDate,
          goal_reached: scheduledGoalReached(
            state,
            metric,
            state.currentUserId,
            localDate,
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
          goal_progress:
            displayGoalProgress(
              metric,
              value,
              effectiveGoalTarget(
                state,
                metric,
                state.currentUserId,
                localDate,
              ),
            ) * 100,
          goal_kind: metric.goal.kind,
          goal_eligible: isMetricTrackedOnDate(state, metric, localDate),
          exact_value: exactShared ? value : null,
          has_data: hasData,
        };
      }),
  );
  if (statuses.length) {
    let { error } = await client.from("daily_metric_status").insert(statuses);
    if (
      error &&
      /goal_progress|goal_kind|goal_eligible|exact_value|has_data/i.test(
        `${error.code ?? ""} ${error.message ?? ""}`,
      )
    ) {
      const legacyStatuses = statuses.map(
        ({
          goal_progress: _progress,
          goal_kind: _kind,
          goal_eligible: _eligible,
          exact_value: _exact,
          has_data: _hasData,
          ...status
        }) => status,
      );
      ({ error } = await client
        .from("daily_metric_status")
        .insert(legacyStatuses));
    }
    if (error) throw error;
  }

  const ownedMessages = state.messages.filter(
    (message) => message.senderId === state.currentUserId,
  );
  const currentMessageRows = await client
    .from("messages")
    .select("client_generated_id, push_dispatched_at")
    .eq("group_id", state.group.id)
    .eq("sender_id", state.currentUserId);
  let legacyMessageKeys = new Set<string>();
  let oldMessageIds = new Set<string>();
  let pendingPushIds = new Set<string>();
  let legacyMessages = false;
  if (currentMessageRows.error) {
    if (!/client_generated_id|column|schema cache/i.test(currentMessageRows.error.message))
      throw currentMessageRows.error;
    legacyMessages = true;
    const legacyRows = await client
      .from("messages")
      .select("content, created_at")
      .eq("group_id", state.group.id)
      .eq("sender_id", state.currentUserId);
    if (legacyRows.error) throw legacyRows.error;
    legacyMessageKeys = new Set(
      (legacyRows.data ?? []).map(
        (message) => `${message.created_at}|${message.content}`,
      ),
    );
  } else {
    oldMessageIds = new Set(
      (currentMessageRows.data ?? []).map(
        (message) => message.client_generated_id,
      ),
    );
    pendingPushIds = new Set(
      (currentMessageRows.data ?? [])
        .filter((message) => !message.push_dispatched_at)
        .map((message) => message.client_generated_id),
    );
  }
  const newMessages = ownedMessages.filter((message) =>
    legacyMessages
      ? !legacyMessageKeys.has(`${message.createdAt}|${message.text}`)
      : !oldMessageIds.has(message.id),
  );
  // Chat is append-preserving. Missing local rows may simply be an older or
  // partially loaded snapshot, so absence must not be interpreted as deletion.
  if (ownedMessages.length && !legacyMessages) {
    const currentUpsert = await client.from("messages").upsert(
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
    if (currentUpsert.error) {
      if (!/constraint|conflict|client_generated_id|column|schema cache/i.test(currentUpsert.error.message))
        throw currentUpsert.error;
      legacyMessages = true;
    }
  }
  if (legacyMessages && newMessages.length) {
    // Old schemas cannot enforce direct-message or image authorization. Never
    // downgrade a private message into a group-visible legacy row.
    const legacySafeMessages = newMessages.filter(
      (message) => !message.recipientId && !message.imageStoragePath,
    );
    if (legacySafeMessages.length) {
      const legacyInsert = await client.from("messages").insert(
        legacySafeMessages.map((message) => ({
          group_id: state.group.id,
          sender_id: state.currentUserId,
          kind: message.kind,
          content: message.text || "Shared an update",
          metadata: {},
          created_at: message.createdAt,
        })),
      );
      if (legacyInsert.error) throw legacyInsert.error;
    }
  }
  const pushCandidates = legacyMessages
    ? newMessages
    : ownedMessages.filter(
        (message) =>
          newMessages.some((candidate) => candidate.id === message.id) ||
          pendingPushIds.has(message.id),
      );
  const pushResults = await Promise.all(
    pushCandidates.map(async (message) => {
      const result = await client.functions.invoke("send-push", {
        body: {
          eventKey: `message:${state.group.id}:${message.id}`,
          clientMessageId: message.id,
          groupId: state.group.id,
          category: "chat",
          recipientId: message.recipientId,
          title: message.recipientId
            ? `Private message from ${current.name}`
            : `${current.name} in ${state.group.name}`,
          body: message.text || "Sent an image",
          data: {
            route: "/chat",
            messageId: message.id,
            senderName: current.name,
            conversationId: message.conversationId ?? `group:${state.group.id}`,
          },
        },
      });
      if (result.error) throw result.error;
      return result.data;
    }),
  );
  void pushResults;

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
      nickname: alias.trim(),
    }));
  if (aliasRows.length) {
    const { error } = await client
      .from("group_member_aliases")
      .insert(aliasRows);
    if (error) throw error;
  }
}
