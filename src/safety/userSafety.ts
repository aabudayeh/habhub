import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

import { useAuth } from "@/src/auth/AuthProvider";
import { CURRENT_TERMS_VERSION } from "@/src/legal/policy";
import { supabase } from "@/src/lib/supabase";

export const SAFETY_REPORT_REASONS = [
  { id: "harassment", label: "Harassment or bullying" },
  { id: "hate", label: "Hate or abusive language" },
  { id: "sexual", label: "Sexual content" },
  { id: "violence", label: "Violence or self-harm" },
  { id: "spam", label: "Spam or scam" },
  { id: "privacy", label: "Privacy or personal information" },
  { id: "other", label: "Something else" },
] as const;

export type SafetyReportReason = (typeof SAFETY_REPORT_REASONS)[number]["id"];
export type SafetyReportStatus = "open" | "reviewed" | "actioned" | "dismissed";
export type SafetyOperatorReviewState = "queued" | "resolved" | "dismissed";

export type BlockedUser = {
  userId: string;
  displayName: string;
  createdAt: string;
};

export type SafetyReportSummary = {
  id: string;
  reportType: "message" | "comment" | "user";
  reportedUserId?: string;
  reportedDisplayName: string;
  reason: SafetyReportReason;
  status: SafetyReportStatus | "local_only";
  operatorReviewRequired?: boolean;
  operatorReviewState?: SafetyOperatorReviewState;
  createdAt: string;
  localOnly?: boolean;
};

export type ModerationReport = {
  id: string;
  reportType: "message" | "comment" | "user";
  reporterId: string;
  reporterDisplayName: string;
  reportedUserId?: string;
  reportedDisplayName: string;
  reason: SafetyReportReason;
  details: string;
  messageExcerpt: string;
  messageAvailable: boolean;
  commentAvailable: boolean;
  operatorReviewRequired: boolean;
  status: SafetyReportStatus;
  createdAt: string;
};

type PendingBlock = BlockedUser & { groupId: string };

type SafetySnapshot = {
  mode: "cloud" | "demo";
  hydrated: boolean;
  refreshing: boolean;
  currentTermsVersion: string;
  acceptedTermsVersion?: string;
  blockedUsers: BlockedUser[];
  reports: SafetyReportSummary[];
  moderationReports: ModerationReport[];
  moderationGroupId?: string;
  error?: string;
};

type SafetyCache = {
  version: 1;
  acceptedTermsVersion?: string;
  currentTermsVersion?: string;
  blockedUsers: BlockedUser[];
  reports: SafetyReportSummary[];
  pendingBlocks: PendingBlock[];
  pendingUnblockIds: string[];
  updatedAt: string;
};

type SafetyEntry = {
  key: string;
  userId: string;
  mode: "cloud" | "demo";
  snapshot: SafetySnapshot;
  listeners: Set<() => void>;
  hydratePromise?: Promise<void>;
  pendingBlocks: PendingBlock[];
  pendingUnblockIds: string[];
};

export type SafetyMutationResult = { cloudSynced: boolean };

type ReportMessageInput = {
  groupId: string;
  messageId: string;
  senderId: string;
  reportedDisplayName: string;
  reason: SafetyReportReason;
  details?: string;
};

type ReportCommentInput = {
  groupId: string;
  commentId: string;
  authorId: string;
  reportedDisplayName: string;
  reason: SafetyReportReason;
  details?: string;
};

type ReportUserInput = {
  groupId: string;
  userId: string;
  reportedDisplayName: string;
  reason: SafetyReportReason;
  details?: string;
};

const CACHE_PREFIX = "habhub-user-safety-v1:";
const entries = new Map<string, SafetyEntry>();

function messageFor(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Safety settings could not be updated.";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function bool(value: unknown) {
  return value === true;
}

function validReason(value: unknown): value is SafetyReportReason {
  return SAFETY_REPORT_REASONS.some((reason) => reason.id === value);
}

function validStatus(value: unknown): value is SafetyReportStatus {
  return ["open", "reviewed", "actioned", "dismissed"].includes(
    String(value),
  );
}

function validOperatorReviewState(
  value: unknown,
): value is SafetyOperatorReviewState {
  return ["queued", "resolved", "dismissed"].includes(String(value));
}

function parseBlockedUsers(value: unknown): BlockedUser[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const item = record(candidate);
    const userId = text(item.userId ?? item.user_id);
    if (!userId) return [];
    return [
      {
        userId,
        displayName:
          text(item.displayName ?? item.display_name)?.trim() || "Member",
        createdAt:
          text(item.createdAt ?? item.created_at) ?? new Date().toISOString(),
      },
    ];
  });
}

function parseReportSummaries(value: unknown): SafetyReportSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const item = record(candidate);
    const id = text(item.id);
    const reportType = text(item.reportType ?? item.report_type);
    const reason = item.reason;
    const status = item.status;
    const operatorReviewState =
      item.operatorReviewState ?? item.operator_review_state;
    if (
      !id ||
      !["message", "comment", "user"].includes(String(reportType)) ||
      !validReason(reason) ||
      (!validStatus(status) && status !== "local_only")
    )
      return [];
    return [
      {
        id,
        reportType: reportType as SafetyReportSummary["reportType"],
        reportedUserId: text(
          item.reportedUserId ?? item.reported_user_id,
        ),
        reportedDisplayName:
          text(item.reportedDisplayName ?? item.reported_display_name)?.trim() ||
          "Member",
        reason,
        status,
        operatorReviewRequired: bool(
          item.operatorReviewRequired ?? item.operator_review_required,
        ),
        operatorReviewState: validOperatorReviewState(operatorReviewState)
          ? operatorReviewState
          : status === "local_only"
            ? undefined
            : "queued",
        createdAt:
          text(item.createdAt ?? item.created_at) ?? new Date().toISOString(),
        localOnly: bool(item.localOnly ?? item.local_only),
      },
    ];
  });
}

function parseModerationReports(value: unknown): ModerationReport[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const item = record(candidate);
    const id = text(item.id);
    const reportType = text(item.reportType ?? item.report_type);
    const reason = item.reason;
    const status = item.status;
    if (
      !id ||
      !["message", "comment", "user"].includes(String(reportType)) ||
      !validReason(reason) ||
      !validStatus(status)
    )
      return [];
    return [
      {
        id,
        reportType: reportType as ModerationReport["reportType"],
        reporterId: text(item.reporterId ?? item.reporter_id) ?? "",
        reporterDisplayName:
          text(item.reporterDisplayName ?? item.reporter_display_name)?.trim() ||
          "Member",
        reportedUserId: text(
          item.reportedUserId ?? item.reported_user_id,
        ),
        reportedDisplayName:
          text(item.reportedDisplayName ?? item.reported_display_name)?.trim() ||
          "Member",
        reason,
        details: text(item.details) ?? "",
        messageExcerpt:
          text(item.messageExcerpt ?? item.message_excerpt) ?? "",
        messageAvailable: bool(
          item.messageAvailable ?? item.message_available,
        ),
        commentAvailable: bool(
          item.commentAvailable ?? item.comment_available,
        ),
        operatorReviewRequired: bool(
          item.operatorReviewRequired ?? item.operator_review_required,
        ),
        status,
        createdAt:
          text(item.createdAt ?? item.created_at) ?? new Date().toISOString(),
      },
    ];
  });
}

function cacheKey(entry: SafetyEntry) {
  return `${CACHE_PREFIX}${entry.key}`;
}

function notify(entry: SafetyEntry, patch: Partial<SafetySnapshot>) {
  entry.snapshot = { ...entry.snapshot, ...patch };
  entry.listeners.forEach((listener) => listener());
}

async function persist(entry: SafetyEntry) {
  const cache: SafetyCache = {
    version: 1,
    acceptedTermsVersion: entry.snapshot.acceptedTermsVersion,
    currentTermsVersion: entry.snapshot.currentTermsVersion,
    blockedUsers: entry.snapshot.blockedUsers,
    reports: entry.snapshot.reports,
    pendingBlocks: entry.pendingBlocks,
    pendingUnblockIds: entry.pendingUnblockIds,
    updatedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(cacheKey(entry), JSON.stringify(cache));
}

function entryFor(
  key: string,
  userId: string,
  mode: "cloud" | "demo",
) {
  const existing = entries.get(key);
  if (existing) return existing;
  const entry: SafetyEntry = {
    key,
    userId,
    mode,
    listeners: new Set(),
    pendingBlocks: [],
    pendingUnblockIds: [],
    snapshot: {
      mode,
      hydrated: false,
      refreshing: false,
      currentTermsVersion: CURRENT_TERMS_VERSION,
      acceptedTermsVersion:
        mode === "demo" ? CURRENT_TERMS_VERSION : undefined,
      blockedUsers: [],
      reports: [],
      moderationReports: [],
    },
  };
  entries.set(key, entry);
  return entry;
}

async function flushPending(entry: SafetyEntry) {
  if (entry.mode !== "cloud" || !supabase) return;
  for (const pending of [...entry.pendingBlocks]) {
    const result = await supabase.rpc("habhub_block_user", {
      p_group_id: pending.groupId,
      p_blocked_user_id: pending.userId,
    });
    if (!result.error)
      entry.pendingBlocks = entry.pendingBlocks.filter(
        (item) => item.userId !== pending.userId,
      );
  }
  for (const userId of [...entry.pendingUnblockIds]) {
    const result = await supabase.rpc("habhub_unblock_user", {
      p_blocked_user_id: userId,
    });
    if (!result.error)
      entry.pendingUnblockIds = entry.pendingUnblockIds.filter(
        (candidate) => candidate !== userId,
      );
  }
}

async function loadRemote(entry: SafetyEntry) {
  if (entry.mode !== "cloud" || !supabase) return;
  await flushPending(entry);
  const { data, error } = await supabase.rpc("habhub_get_user_safety_state");
  if (error) throw error;
  const remote = record(data);
  const pendingBlockIds = new Set(
    entry.pendingBlocks.map((item) => item.userId),
  );
  const pendingUnblockIds = new Set(entry.pendingUnblockIds);
  const remoteBlocks = parseBlockedUsers(remote.blocks).filter(
    (item) => !pendingUnblockIds.has(item.userId),
  );
  const blocks = new Map(remoteBlocks.map((item) => [item.userId, item]));
  entry.pendingBlocks.forEach((item) => blocks.set(item.userId, item));
  notify(entry, {
    hydrated: true,
    currentTermsVersion:
      text(remote.currentTermsVersion ?? remote.current_terms_version) ??
      CURRENT_TERMS_VERSION,
    acceptedTermsVersion: text(
      remote.acceptedTermsVersion ?? remote.accepted_terms_version,
    ),
    blockedUsers: [...blocks.values()].filter(
      (item) => pendingBlockIds.has(item.userId) || !pendingUnblockIds.has(item.userId),
    ),
    reports: parseReportSummaries(remote.reports),
    error: undefined,
  });
  await persist(entry);
}

async function hydrate(entry: SafetyEntry) {
  if (entry.hydratePromise) return entry.hydratePromise;
  entry.hydratePromise = (async () => {
    try {
      const stored = await AsyncStorage.getItem(cacheKey(entry));
      if (stored) {
        const cache = JSON.parse(stored) as Partial<SafetyCache>;
        if (cache.version === 1) {
          entry.pendingBlocks = Array.isArray(cache.pendingBlocks)
            ? cache.pendingBlocks
            : [];
          entry.pendingUnblockIds = Array.isArray(cache.pendingUnblockIds)
            ? cache.pendingUnblockIds.filter(
                (value): value is string => typeof value === "string",
              )
            : [];
          notify(entry, {
            hydrated: true,
            currentTermsVersion:
              cache.currentTermsVersion ?? CURRENT_TERMS_VERSION,
            acceptedTermsVersion:
              entry.mode === "demo"
                ? CURRENT_TERMS_VERSION
                : cache.acceptedTermsVersion,
            blockedUsers: parseBlockedUsers(cache.blockedUsers),
            reports: parseReportSummaries(cache.reports),
          });
        }
      }
    } catch {
      // A corrupt cache never grants Terms acceptance or cloud permissions.
    }
    if (entry.mode === "demo") {
      notify(entry, {
        hydrated: true,
        acceptedTermsVersion: CURRENT_TERMS_VERSION,
      });
      return;
    }
    try {
      await loadRemote(entry);
    } catch (error) {
      notify(entry, { hydrated: true, error: messageFor(error) });
    }
  })().finally(() => {
    entry.hydratePromise = undefined;
  });
  return entry.hydratePromise;
}

function localReport(
  reportType: SafetyReportSummary["reportType"],
  userId: string,
  displayName: string,
  reason: SafetyReportReason,
): SafetyReportSummary {
  return {
    id: `demo-report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    reportType,
    reportedUserId: userId,
    reportedDisplayName: displayName,
    reason,
    status: "local_only",
    createdAt: new Date().toISOString(),
    localOnly: true,
  };
}

function submittedReport(
  id: unknown,
  reportType: SafetyReportSummary["reportType"],
  userId: string,
  displayName: string,
  reason: SafetyReportReason,
): SafetyReportSummary {
  return {
    id:
      typeof id === "string" && id
        ? id
        : `submitted-report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    reportType,
    reportedUserId: userId,
    reportedDisplayName: displayName.trim() || "Member",
    reason,
    status: "open",
    operatorReviewState: "queued",
    createdAt: new Date().toISOString(),
  };
}

export function useUserSafety(localAccountId: string, forceDemo = false) {
  const auth = useAuth();
  const cloudMode =
    !forceDemo &&
    auth.status === "signedIn" &&
    Boolean(auth.user && supabase);
  const userId = cloudMode ? auth.user!.id : localAccountId;
  const scope = `${cloudMode ? "cloud" : "demo"}:${userId}`;
  const entry = useMemo(
    () => entryFor(scope, userId, cloudMode ? "cloud" : "demo"),
    [cloudMode, scope, userId],
  );
  const snapshot = useSyncExternalStore(
    (listener) => {
      entry.listeners.add(listener);
      return () => entry.listeners.delete(listener);
    },
    () => entry.snapshot,
    () => entry.snapshot,
  );

  useEffect(() => {
    void hydrate(entry);
  }, [entry]);

  const refresh = useCallback(async () => {
    if (entry.mode === "demo") {
      await hydrate(entry);
      return;
    }
    notify(entry, { refreshing: true });
    try {
      await loadRemote(entry);
    } catch (error) {
      notify(entry, { error: messageFor(error) });
      throw error;
    } finally {
      notify(entry, { refreshing: false });
    }
  }, [entry]);

  const acceptTerms = useCallback(async () => {
    if (entry.mode === "demo") return;
    if (!supabase) throw new Error("Cloud safety is unavailable.");
    if (entry.snapshot.currentTermsVersion !== CURRENT_TERMS_VERSION)
      throw new Error(
        "A newer Terms version is required. Update HabHub before using cloud chat.",
      );
    const { data, error } = await supabase.rpc("habhub_accept_current_terms");
    if (error) throw error;
    const accepted = record(data);
    const acceptedVersion = text(
      accepted.termsVersion ?? accepted.terms_version,
    );
    if (acceptedVersion !== CURRENT_TERMS_VERSION)
      throw new Error(
        "The server requires a different Terms version. Update HabHub and try again.",
      );
    notify(entry, {
      acceptedTermsVersion: acceptedVersion,
      error: undefined,
    });
    await persist(entry).catch(() => undefined);
  }, [entry]);

  const blockUser = useCallback(
    async (
      groupId: string,
      blockedUserId: string,
      displayName: string,
    ): Promise<SafetyMutationResult> => {
      const blocked: BlockedUser = {
        userId: blockedUserId,
        displayName: displayName.trim() || "Member",
        createdAt: new Date().toISOString(),
      };
      notify(entry, {
        blockedUsers: [
          blocked,
          ...entry.snapshot.blockedUsers.filter(
            (item) => item.userId !== blockedUserId,
          ),
        ],
        error: undefined,
      });
      if (entry.mode === "demo") {
        await persist(entry);
        return { cloudSynced: false };
      }
      entry.pendingBlocks = [
        { ...blocked, groupId },
        ...entry.pendingBlocks.filter((item) => item.userId !== blockedUserId),
      ];
      entry.pendingUnblockIds = entry.pendingUnblockIds.filter(
        (id) => id !== blockedUserId,
      );
      await persist(entry);
      if (!supabase) return { cloudSynced: false };
      const { error } = await supabase.rpc("habhub_block_user", {
        p_group_id: groupId,
        p_blocked_user_id: blockedUserId,
      });
      if (error) {
        notify(entry, {
          error: "Blocked on this device. Cloud sync will retry when available.",
        });
        return { cloudSynced: false };
      }
      entry.pendingBlocks = entry.pendingBlocks.filter(
        (item) => item.userId !== blockedUserId,
      );
      await persist(entry).catch(() => undefined);
      return { cloudSynced: true };
    },
    [entry],
  );

  const unblockUser = useCallback(
    async (blockedUserId: string): Promise<SafetyMutationResult> => {
      notify(entry, {
        blockedUsers: entry.snapshot.blockedUsers.filter(
          (item) => item.userId !== blockedUserId,
        ),
        error: undefined,
      });
      if (entry.mode === "demo") {
        await persist(entry);
        return { cloudSynced: false };
      }
      entry.pendingBlocks = entry.pendingBlocks.filter(
        (item) => item.userId !== blockedUserId,
      );
      entry.pendingUnblockIds = [
        blockedUserId,
        ...entry.pendingUnblockIds.filter((id) => id !== blockedUserId),
      ];
      await persist(entry);
      if (!supabase) return { cloudSynced: false };
      const { error } = await supabase.rpc("habhub_unblock_user", {
        p_blocked_user_id: blockedUserId,
      });
      if (error) {
        notify(entry, {
          error: "Unblocked on this device. Cloud sync will retry when available.",
        });
        return { cloudSynced: false };
      }
      entry.pendingUnblockIds = entry.pendingUnblockIds.filter(
        (id) => id !== blockedUserId,
      );
      await persist(entry).catch(() => undefined);
      return { cloudSynced: true };
    },
    [entry],
  );

  const reportMessage = useCallback(
    async (input: ReportMessageInput): Promise<SafetyMutationResult> => {
      if (entry.mode === "demo") {
        notify(entry, {
          reports: [
            localReport(
              "message",
              input.senderId,
              input.reportedDisplayName,
              input.reason,
            ),
            ...entry.snapshot.reports,
          ].slice(0, 50),
        });
        await persist(entry);
        return { cloudSynced: false };
      }
      if (!supabase) throw new Error("Connect to report this message.");
      const { data, error } = await supabase.rpc("habhub_report_message", {
        p_group_id: input.groupId,
        p_message_client_generated_id: input.messageId,
        p_message_sender_id: input.senderId,
        p_reason: input.reason,
        p_details: input.details?.trim().slice(0, 500) ?? "",
      });
      if (error) throw error;
      const submitted = submittedReport(
        data,
        "message",
        input.senderId,
        input.reportedDisplayName,
        input.reason,
      );
      notify(entry, {
        reports: [
          submitted,
          ...entry.snapshot.reports.filter(
            (report) => report.id !== submitted.id,
          ),
        ].slice(0, 50),
        error: undefined,
      });
      await persist(entry).catch(() => undefined);
      await loadRemote(entry).catch((refreshError) =>
        notify(entry, { error: messageFor(refreshError) }),
      );
      return { cloudSynced: true };
    },
    [entry],
  );

  const reportComment = useCallback(
    async (input: ReportCommentInput): Promise<SafetyMutationResult> => {
      if (entry.mode === "demo") {
        notify(entry, {
          reports: [
            localReport(
              "comment",
              input.authorId,
              input.reportedDisplayName,
              input.reason,
            ),
            ...entry.snapshot.reports,
          ].slice(0, 50),
        });
        await persist(entry);
        return { cloudSynced: false };
      }
      if (!supabase) throw new Error("Connect to report this comment.");
      const { data, error } = await supabase.rpc("habhub_report_comment", {
        p_group_id: input.groupId,
        p_comment_id: input.commentId,
        p_comment_author_id: input.authorId,
        p_reason: input.reason,
        p_details: input.details?.trim().slice(0, 500) ?? "",
      });
      if (error) throw error;
      const submitted = submittedReport(
        data,
        "comment",
        input.authorId,
        input.reportedDisplayName,
        input.reason,
      );
      notify(entry, {
        reports: [
          submitted,
          ...entry.snapshot.reports.filter(
            (report) => report.id !== submitted.id,
          ),
        ].slice(0, 50),
        error: undefined,
      });
      await persist(entry).catch(() => undefined);
      await loadRemote(entry).catch((refreshError) =>
        notify(entry, { error: messageFor(refreshError) }),
      );
      return { cloudSynced: true };
    },
    [entry],
  );

  const reportUser = useCallback(
    async (input: ReportUserInput): Promise<SafetyMutationResult> => {
      if (entry.mode === "demo") {
        notify(entry, {
          reports: [
            localReport(
              "user",
              input.userId,
              input.reportedDisplayName,
              input.reason,
            ),
            ...entry.snapshot.reports,
          ].slice(0, 50),
        });
        await persist(entry);
        return { cloudSynced: false };
      }
      if (!supabase) throw new Error("Connect to report this member.");
      const { data, error } = await supabase.rpc("habhub_report_user", {
        p_group_id: input.groupId,
        p_reported_user_id: input.userId,
        p_reason: input.reason,
        p_details: input.details?.trim().slice(0, 500) ?? "",
      });
      if (error) throw error;
      const submitted = submittedReport(
        data,
        "user",
        input.userId,
        input.reportedDisplayName,
        input.reason,
      );
      notify(entry, {
        reports: [
          submitted,
          ...entry.snapshot.reports.filter(
            (report) => report.id !== submitted.id,
          ),
        ].slice(0, 50),
        error: undefined,
      });
      await persist(entry).catch(() => undefined);
      await loadRemote(entry).catch((refreshError) =>
        notify(entry, { error: messageFor(refreshError) }),
      );
      return { cloudSynced: true };
    },
    [entry],
  );

  const canDirectMessage = useCallback(
    async (groupId: string, recipientId: string) => {
      if (
        entry.snapshot.blockedUsers.some((item) => item.userId === recipientId)
      )
        return false;
      if (entry.mode === "demo") return true;
      if (
        entry.snapshot.currentTermsVersion !== CURRENT_TERMS_VERSION ||
        entry.snapshot.acceptedTermsVersion !== CURRENT_TERMS_VERSION
      )
        return false;
      if (!supabase)
        throw new Error("Reconnect to verify direct-message safety.");
      const { data, error } = await supabase.rpc(
        "habhub_can_direct_message",
        {
          p_group_id: groupId,
          p_recipient_id: recipientId,
        },
      );
      if (error) throw error;
      return data === true;
    },
    [entry],
  );

  const loadModeration = useCallback(
    async (groupId: string) => {
      if (entry.mode === "demo") {
        notify(entry, { moderationGroupId: groupId, moderationReports: [] });
        return;
      }
      if (!supabase) throw new Error("Cloud moderation is unavailable.");
      const { data, error } = await supabase.rpc(
        "habhub_list_group_safety_reports",
        { p_group_id: groupId },
      );
      if (error) throw error;
      notify(entry, {
        moderationGroupId: groupId,
        moderationReports: parseModerationReports(data),
      });
    },
    [entry],
  );

  const moderateReport = useCallback(
    async (
      reportId: string,
      action:
        | "reviewed"
        | "remove_message"
        | "remove_comment"
        | "dismissed",
      note = "",
    ) => {
      if (entry.mode === "demo") return;
      if (!supabase) throw new Error("Cloud moderation is unavailable.");
      const { error } = await supabase.rpc(
        "habhub_moderate_group_safety_report",
        {
          p_report_id: reportId,
          p_action: action,
          p_note: note.trim().slice(0, 500),
        },
      );
      if (error) throw error;
      notify(entry, {
        moderationReports: entry.snapshot.moderationReports.filter(
          (report) => report.id !== reportId,
        ),
      });
    },
    [entry],
  );

  const blockedUserIds = useMemo(
    () => new Set(snapshot.blockedUsers.map((item) => item.userId)),
    [snapshot.blockedUsers],
  );
  return {
    ...snapshot,
    bundledTermsVersion: CURRENT_TERMS_VERSION,
    termsAccepted:
      snapshot.currentTermsVersion === CURRENT_TERMS_VERSION &&
      snapshot.acceptedTermsVersion === CURRENT_TERMS_VERSION,
    blockedUserIds,
    isBlocked: (candidateId: string | undefined) =>
      Boolean(candidateId && blockedUserIds.has(candidateId)),
    refresh,
    acceptTerms,
    blockUser,
    unblockUser,
    reportMessage,
    reportComment,
    reportUser,
    canDirectMessage,
    loadModeration,
    moderateReport,
  };
}
