import type {
  AppState,
  DailyMetricStatus,
  GoogleHealthEntryOverride,
  MetricEntry,
} from "../types";

type GoogleHealthEntryLike = Pick<
  MetricEntry,
  "id" | "metricId" | "userId" | "localDate" | "sourceProvider"
>;

type GoogleHealthStatusLike = Pick<
  DailyMetricStatus,
  "metricId" | "userId" | "localDate" | "sourceProvider"
>;

const GOOGLE_HEALTH_ENTRY_ID_PREFIXES = [
  "google-health:",
  "health:google_health:",
] as const;

const localStateProjectionCache = new WeakMap<AppState, AppState>();

/** Google Health rows are cloud-only and must never enter plaintext device caches. */
export function isGoogleHealthEntry(
  entry: Pick<GoogleHealthEntryLike, "id" | "sourceProvider">,
) {
  return (
    entry.sourceProvider === "google_health" ||
    isGoogleHealthEntryId(entry.id)
  );
}

/** Recognizes server-generated Google ids after the source row was deleted. */
export function isGoogleHealthEntryId(id: unknown) {
  const normalized = String(id ?? "");
  return GOOGLE_HEALTH_ENTRY_ID_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );
}

export function googleHealthMetricDayKey(
  row: Pick<GoogleHealthEntryLike, "metricId" | "userId" | "localDate">,
) {
  return `${row.userId}\u0000${row.metricId}\u0000${row.localDate}`;
}

export function googleHealthUserDayKey(
  row: Pick<GoogleHealthEntryLike, "userId" | "localDate">,
) {
  return `${row.userId}\u0000${row.localDate}`;
}

export function withoutGoogleHealthEntries<T extends GoogleHealthEntryLike>(
  entries: readonly T[],
): T[] {
  if (!entries.some(isGoogleHealthEntry)) return entries as T[];
  return entries.filter((entry) => !isGoogleHealthEntry(entry));
}

/**
 * A compact status can reveal an imported value or goal outcome without
 * retaining the raw row. New cloud projections carry sourceProvider; the
 * metric/day inference also protects snapshots created during an upgrade.
 */
export function withoutGoogleHealthDerivedStatuses<
  TEntry extends GoogleHealthEntryLike,
  TStatus extends GoogleHealthStatusLike,
>(entries: readonly TEntry[], statuses: readonly TStatus[]): TStatus[] {
  const sensitiveMetricDays = new Set(
    entries.filter(isGoogleHealthEntry).map(googleHealthMetricDayKey),
  );
  const filtered = statuses.filter(
    (status) =>
      status.sourceProvider !== "google_health" &&
      !sensitiveMetricDays.has(googleHealthMetricDayKey(status)),
  );
  return filtered.length === statuses.length ? (statuses as TStatus[]) : filtered;
}

function validIso(value: unknown) {
  if (typeof value !== "string") return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function validLocalDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : undefined;
}

function validVisibility(value: unknown) {
  return value === "private" || value === "status" || value === "group"
    ? value
    : undefined;
}

/**
 * A tracker default applies only to inherited Google rows. An explicit
 * server-side per-entry preference remains authoritative across editor saves,
 * cloud snapshots, and later provider reconciliation.
 */
export function applyInheritedTrackerVisibility(
  entry: MetricEntry,
  overrides: Record<string, GoogleHealthEntryOverride> | undefined,
  visibility: MetricEntry["visibility"],
  changedAt: string,
) {
  if (
    isGoogleHealthEntry(entry) &&
    validVisibility(overrides?.[entry.id]?.visibility)
  )
    return entry;
  return { ...entry, visibility, sourceUpdatedAt: changedAt };
}

/** Stores only explicit user choices, never the imported measurement itself. */
export function googleHealthOverrideForEntry(
  entry: MetricEntry,
  existing: GoogleHealthEntryOverride | undefined,
): GoogleHealthEntryOverride | undefined {
  if (!isGoogleHealthEntry(entry)) return undefined;
  const sourceUpdatedAt = validIso(entry.sourceUpdatedAt);
  if (!sourceUpdatedAt) return undefined;
  const recordedAtOverride = validIso(entry.recordedAtOverride);
  const explicitVisibility = validVisibility(existing?.visibility);
  if (!recordedAtOverride && !explicitVisibility) return undefined;
  return {
    ...(recordedAtOverride
      ? {
          recordedAtOverride,
          localDate: validLocalDate(entry.localDate),
        }
      : {}),
    // A time edit must not turn the row's inherited tracker default into a
    // permanent per-entry choice. Only a preference already marked explicit
    // by the authoritative server registry may carry visibility forward.
    ...(explicitVisibility ? { visibility: explicitVisibility } : {}),
    sourceUpdatedAt,
  };
}

export function rememberGoogleHealthEntryOverrides(
  existing: Record<string, GoogleHealthEntryOverride> | undefined,
  entries: readonly MetricEntry[],
) {
  let next = existing;
  for (const entry of entries) {
    const override = googleHealthOverrideForEntry(entry, existing?.[entry.id]);
    if (!override) continue;
    if (next === existing) next = { ...(existing ?? {}) };
    next![entry.id] = override;
  }
  return next;
}

export function withoutGoogleHealthEntryOverrides(
  existing: Record<string, GoogleHealthEntryOverride> | undefined,
  removedIds: ReadonlySet<string>,
) {
  if (!existing || !removedIds.size) return existing;
  const next = Object.fromEntries(
    Object.entries(existing).filter(([entryId]) => !removedIds.has(entryId)),
  );
  return Object.keys(next).length === Object.keys(existing).length
    ? existing
    : Object.keys(next).length
      ? next
      : undefined;
}

/** Replays a durable edit intent after a raw Google row is fetched from cloud. */
export function applyGoogleHealthEntryOverrides(
  entries: readonly MetricEntry[],
  overrides: Record<string, GoogleHealthEntryOverride> | undefined,
  accountId: string,
  metrics: readonly AppState["metrics"][number][] = [],
): MetricEntry[] {
  const defaultVisibilityByMetric = new Map(
    metrics.map((metric) => [metric.id, metric.defaultVisibility]),
  );
  if (
    (!overrides || !Object.keys(overrides).length) &&
    !defaultVisibilityByMetric.size
  )
    return entries as MetricEntry[];
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.userId !== accountId || !isGoogleHealthEntry(entry)) return entry;
    const override = overrides?.[entry.id];
    const recordedAtOverride = validIso(override?.recordedAtOverride);
    const localDate = recordedAtOverride
      ? validLocalDate(override?.localDate) ?? entry.localDate
      : entry.localDate;
    const visibility =
      validVisibility(override?.visibility) ??
      defaultVisibilityByMetric.get(entry.metricId) ??
      entry.visibility;
    const incomingRevision = validIso(entry.sourceUpdatedAt);
    const overrideRevision = validIso(override?.sourceUpdatedAt);
    const sourceUpdatedAt =
      incomingRevision && overrideRevision
        ? incomingRevision > overrideRevision
          ? incomingRevision
          : overrideRevision
        : incomingRevision ?? overrideRevision ?? entry.sourceUpdatedAt;
    const updated = {
      ...entry,
      visibility,
      localDate,
      ...(recordedAtOverride
        ? { recordedAt: recordedAtOverride, recordedAtOverride }
        : {}),
      sourceUpdatedAt,
    };
    if (
      updated.visibility === entry.visibility &&
      updated.localDate === entry.localDate &&
      updated.recordedAt === entry.recordedAt &&
      updated.recordedAtOverride === entry.recordedAtOverride &&
      updated.sourceUpdatedAt === entry.sourceUpdatedAt
    )
      return entry;
    changed = true;
    return updated;
  });
  return changed ? next : (entries as MetricEntry[]);
}

/**
 * Produces the plaintext offline/cache projection. The returned state is for
 * local persistence only; callers keep rendering and cloud-syncing the full
 * in-memory account snapshot.
 */
export function stateWithoutGoogleHealthLocalData(state: AppState): AppState {
  const cached = localStateProjectionCache.get(state);
  if (cached) return cached;
  const googleEntryIds = new Set(
    state.entries.filter(isGoogleHealthEntry).map((entry) => entry.id),
  );
  const entries = withoutGoogleHealthEntries(state.entries);
  const dailyMetricStatuses = withoutGoogleHealthDerivedStatuses(
    state.entries,
    state.dailyMetricStatuses,
  );
  const withoutGoogleHealthIds = (values: string[] | undefined) => {
    if (!values) return values;
    const filtered = values.filter(
      (id) => !googleEntryIds.has(id) && !isGoogleHealthEntryId(id),
    );
    return filtered.length === values.length ? values : filtered;
  };
  const pendingDeletedEntryIds = withoutGoogleHealthIds(
    state.settings.pendingDeletedEntryIds,
  );
  const deletedEntryIds = withoutGoogleHealthIds(
    state.settings.deletedEntryIds,
  );
  const dismissedHealthEntryIds = withoutGoogleHealthIds(
    state.settings.dismissedHealthEntryIds,
  );
  const settingsChanged =
    pendingDeletedEntryIds !== state.settings.pendingDeletedEntryIds ||
    deletedEntryIds !== state.settings.deletedEntryIds ||
    dismissedHealthEntryIds !== state.settings.dismissedHealthEntryIds ||
    Object.keys(state.settings.googleHealthEntryOverrides ?? {}).length > 0;

  if (
    entries === state.entries &&
    dailyMetricStatuses === state.dailyMetricStatuses &&
    !settingsChanged
  ) {
    localStateProjectionCache.set(state, state);
    return state;
  }

  const projected: AppState = {
    ...state,
    entries,
    dailyMetricStatuses,
    settings: settingsChanged
      ? {
          ...state.settings,
          pendingDeletedEntryIds,
          deletedEntryIds,
          dismissedHealthEntryIds,
          // Google entry ids, display timestamps/dates, and visibility choices
          // remain in memory and the protected account snapshot only. They are
          // identifiable health-event metadata, so a plaintext local cache may
          // not retain even this user-authored override registry.
          googleHealthEntryOverrides: undefined,
        }
      : state.settings,
  };
  localStateProjectionCache.set(state, projected);
  return projected;
}

/** Applies an authoritative server-side "delete Google imports" result now. */
export function purgeGoogleHealthAccountData(
  state: AppState,
  accountId = state.currentUserId,
): AppState {
  const accountGoogleEntries = state.entries.filter(
    (entry) => entry.userId === accountId && isGoogleHealthEntry(entry),
  );
  const sensitiveMetricDays = new Set(
    accountGoogleEntries.map(googleHealthMetricDayKey),
  );
  const removedIds = new Set(accountGoogleEntries.map((entry) => entry.id));
  const entries = state.entries.filter(
    (entry) => !(entry.userId === accountId && isGoogleHealthEntry(entry)),
  );
  const dailyMetricStatuses = state.dailyMetricStatuses.filter(
    (status) =>
      status.userId !== accountId ||
      (status.sourceProvider !== "google_health" &&
        !sensitiveMetricDays.has(googleHealthMetricDayKey(status))),
  );
  const removeGoogleIntent = (values: string[] | undefined) => {
    if (!values) return values;
    const filtered = values.filter(
      (id) => !removedIds.has(id) && !isGoogleHealthEntryId(id),
    );
    return filtered.length === values.length ? values : filtered;
  };
  const pendingDeletedEntryIds = removeGoogleIntent(
    state.settings.pendingDeletedEntryIds,
  );
  const deletedEntryIds = removeGoogleIntent(state.settings.deletedEntryIds);
  const dismissedHealthEntryIds = removeGoogleIntent(
    state.settings.dismissedHealthEntryIds,
  );
  const settingsChanged =
    pendingDeletedEntryIds !== state.settings.pendingDeletedEntryIds ||
    deletedEntryIds !== state.settings.deletedEntryIds ||
    dismissedHealthEntryIds !== state.settings.dismissedHealthEntryIds ||
    (accountId === state.currentUserId &&
      Object.keys(state.settings.googleHealthEntryOverrides ?? {}).length > 0);
  if (
    entries.length === state.entries.length &&
    dailyMetricStatuses.length === state.dailyMetricStatuses.length &&
    !settingsChanged
  )
    return state;
  return {
    ...state,
    entries,
    dailyMetricStatuses,
    settings: settingsChanged
      ? {
          ...state.settings,
          pendingDeletedEntryIds,
          deletedEntryIds,
          dismissedHealthEntryIds,
          googleHealthEntryOverrides:
            accountId === state.currentUserId
              ? undefined
              : state.settings.googleHealthEntryOverrides,
        }
      : state.settings,
  };
}

/** Applies an already-authoritative server dismissal without creating an id outbox. */
export function purgeGoogleHealthEntryFromMemory(
  state: AppState,
  entryId: string,
  accountId = state.currentUserId,
): AppState {
  const target = state.entries.find(
    (entry) =>
      entry.userId === accountId &&
      entry.id === entryId &&
      isGoogleHealthEntry(entry),
  );
  if (!target) return state;
  const sensitiveMetricDay = googleHealthMetricDayKey(target);
  const entries = state.entries.filter(
    (entry) => !(entry.userId === accountId && entry.id === entryId),
  );
  const dailyMetricStatuses = state.dailyMetricStatuses.filter(
    (status) =>
      status.userId !== accountId ||
      (status.sourceProvider !== "google_health" &&
        googleHealthMetricDayKey(status) !== sensitiveMetricDay),
  );
  const withoutEntryId = (values: string[] | undefined) => {
    if (!values?.includes(entryId)) return values;
    const filtered = values.filter((id) => id !== entryId);
    return filtered.length ? filtered : undefined;
  };
  return {
    ...state,
    entries,
    dailyMetricStatuses,
    settings: {
      ...state.settings,
      pendingDeletedEntryIds: withoutEntryId(
        state.settings.pendingDeletedEntryIds,
      ),
      deletedEntryIds: withoutEntryId(state.settings.deletedEntryIds),
      dismissedHealthEntryIds: withoutEntryId(
        state.settings.dismissedHealthEntryIds,
      ),
      googleHealthEntryOverrides: withoutGoogleHealthEntryOverrides(
        state.settings.googleHealthEntryOverrides,
        new Set([entryId]),
      ),
    },
  };
}
