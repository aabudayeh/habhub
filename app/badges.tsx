import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { BadgeMedallion } from "@/src/components/BadgeMedallion";
import { SelectionMenu } from "@/src/components/SelectionMenu";
import { TutorialTarget } from "@/src/components/TutorialSpotlight";
import { useBadgeChallengeInputs } from "@/src/cloud/useBadgeChallengeInputs";
import {
  Card,
  IconButton,
  PageHeader,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import {
  BadgeAim,
  BadgeStatus,
  EarnedBadge,
  badgeAim,
  badgeLevelSummary,
  badgeXpSummary,
  buildBadges,
  defaultPinnedBadgeIds,
} from "@/src/domain/badges";
import { dateKey } from "@/src/domain/date";
import { memberDisplayName } from "@/src/domain/members";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";

const nutritionTrackerIds = new Set([
  "protein",
  "fat",
  "carbs",
  "fiber",
  "sodium",
  "sugar",
  "saturated_fat",
  "cholesterol",
  "potassium",
  "calcium",
  "iron",
  "magnesium",
  "vitamin_c",
  "vitamin_d",
  "vitamin_b12",
]);

const statusSections: {
  id: BadgeStatus;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    id: "earned",
    title: "Earned",
    description: "Completed awards and personal records.",
    icon: "medal-outline",
  },
  {
    id: "progress",
    title: "In progress",
    description: "Your current count and the next milestone to aim for.",
    icon: "navigate-circle-outline",
  },
  {
    id: "locked",
    title: "Up next",
    description: "Start these goals to unlock their first award.",
    icon: "lock-closed-outline",
  },
  {
    id: "recurring",
    title: "Recurring awards",
    description: "Daily, weekly, monthly, and live group competitions.",
    icon: "refresh-circle-outline",
  },
];

const aimSections: {
  id: BadgeAim;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { id: "milestones", title: "Goals & milestones", icon: "checkmark-done" },
  { id: "streaks", title: "Streaks", icon: "flame" },
  { id: "today", title: "Today & live leaders", icon: "flash" },
  {
    id: "previous-leaders",
    title: "Previous-day champions",
    icon: "medal",
  },
  { id: "leaders", title: "Week, month & year leaders", icon: "trophy" },
  { id: "records", title: "Personal records", icon: "star" },
  {
    id: "consistency",
    title: "Consistency & comebacks",
    icon: "repeat",
  },
  { id: "challenges", title: "Challenges & podiums", icon: "flag" },
];

function badgeXpCopy(badge: EarnedBadge) {
  const xp = badgeXpSummary(badge);
  if (xp.earned > 0 && xp.available > 0)
    return `${xp.earned.toLocaleString()} XP earned · ${xp.available.toLocaleString()} XP available`;
  if (xp.earned > 0) return `${xp.earned.toLocaleString()} XP earned`;
  if (xp.available > 0) return `${xp.available.toLocaleString()} XP available`;
  return "Live recognition · 0 XP";
}

function sortBadges(left: EarnedBadge, right: EarnedBadge) {
  if (left.status === "progress" && right.status === "progress") {
    const leftProgress = left.progress
      ? left.progress.current / Math.max(left.progress.target, 1)
      : 0;
    const rightProgress = right.progress
      ? right.progress.current / Math.max(right.progress.target, 1)
      : 0;
    return rightProgress - leftProgress;
  }
  return (
    right.anchorDate.localeCompare(left.anchorDate) ||
    (right.earnedCount ?? -1) - (left.earnedCount ?? -1) ||
    left.title.localeCompare(right.title)
  );
}

export default function BadgesScreen() {
  const params = useLocalSearchParams<{
    highlight?: string;
    memberId?: string;
    selectShowcase?: string;
  }>();
  const { state, updateSettings } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const anchor = dateKey();
  const badgeChallengeInputs = useBadgeChallengeInputs(
    state.group.id,
    state.currentUserId,
    anchor,
  );
  const requestedMemberId = state.group.members.some(
    (member) => member.id === params.memberId,
  )
    ? params.memberId
    : undefined;
  const [memberIds, setMemberIds] = useState([
    requestedMemberId ?? state.currentUserId,
  ]);
  useEffect(() => {
    if (requestedMemberId) setMemberIds([requestedMemberId]);
  }, [requestedMemberId]);
  const [openSections, setOpenSections] = useState<Record<BadgeStatus, boolean>>({
    earned: false,
    progress: false,
    locked: false,
    recurring: false,
  });
  const [statusFilters, setStatusFilters] = useState<BadgeStatus[]>([
    "earned",
    "progress",
    "locked",
    "recurring",
  ]);
  const [aimFilters, setAimFilters] = useState<BadgeAim[]>(() =>
    aimSections.map((section) => section.id),
  );
  const trackerItems = useMemo(
    () =>
      (state.group.metricConfiguration ?? [])
        .filter(
          (metric) =>
            metric.sections.group &&
            metric.dataType !== "text" &&
            metric.dataType !== "photo",
        )
        .sort((left, right) => left.order - right.order)
        .map((metric) => ({
          id: metric.id,
          label: metric.name,
          icon: metric.icon as keyof typeof Ionicons.glyphMap,
          color: metric.color,
          group: metric.grouping || metric.category || "Group trackers",
        })),
    [state.group.metricConfiguration],
  );
  const [hiddenMetricIds, setHiddenMetricIds] = useState<string[]>([]);
  const metricIds = useMemo(
    () =>
      trackerItems
        .map((item) => item.id)
        .filter((id) => !hiddenMetricIds.includes(id)),
    [hiddenMetricIds, trackerItems],
  );
  const badges = useMemo(
    () =>
      buildBadges(
        state,
        anchor,
        badgeChallengeInputs.challenges,
        anchor,
        badgeChallengeInputs.placements,
        badgeChallengeInputs.settledOccurrenceKeys,
      ),
    [
      anchor,
      badgeChallengeInputs.challenges,
      badgeChallengeInputs.placements,
      badgeChallengeInputs.settledOccurrenceKeys,
      state,
    ],
  );
  const badgePool = useMemo(
    () =>
      badges
        .filter(
          (badge) =>
            (params.selectShowcase !== "true" || badge.status === "earned") &&
            (!badge.memberId || memberIds.includes(badge.memberId)) &&
            (!badge.metricId ||
              metricIds.includes(badge.metricId) ||
              (nutritionTrackerIds.has(badge.metricId) &&
                metricIds.includes("food"))),
        ),
    [
      badges,
      memberIds,
      metricIds,
      params.selectShowcase,
    ],
  );
  const visible = useMemo(
    () =>
      badgePool
        .filter(
          (badge) =>
            statusFilters.includes(badge.status) &&
            aimFilters.includes(badgeAim(badge)),
        )
        .sort(sortBadges),
    [aimFilters, badgePool, statusFilters],
  );
  const levelOwnerId = memberIds.length === 1 ? memberIds[0] : state.currentUserId;
  const levelOwner = state.group.members.find((member) => member.id === levelOwnerId);
  const level = useMemo(
    () => badgeLevelSummary(badges, levelOwnerId),
    [badges, levelOwnerId],
  );
  const showcaseSelection =
    params.selectShowcase === "true" && levelOwnerId === state.currentUserId;
  const persistedShowcased = useMemo(
    () => state.settings.badgeShowcaseByGroup[state.group.id] ?? [],
    [state.group.id, state.settings.badgeShowcaseByGroup],
  );
  const [optimisticShowcased, setOptimisticShowcased] = useState<
    string[] | null
  >(null);
  const showcased = optimisticShowcased ?? persistedShowcased;
  const preferredMetricIds = useMemo(
    () =>
      [
        ...state.settings.selectedGoals,
        ...state.settings.progressMetricIds,
        ...(state.group.metricConfiguration ?? [])
          .filter((metric) => metric.sections.today || metric.sections.group)
          .sort((left, right) => left.order - right.order)
          .map((metric) => metric.id),
      ].filter((id, index, ids) => ids.indexOf(id) === index),
    [
      state.group.metricConfiguration,
      state.settings.progressMetricIds,
      state.settings.selectedGoals,
    ],
  );
  const savedPinnedBadgeIds = state.settings.badgePinnedByGroup[state.group.id];
  const defaultPins = useMemo(
    () =>
      (
        savedPinnedBadgeIds ??
        defaultPinnedBadgeIds(
          badges,
          state.currentUserId,
          preferredMetricIds,
        )
      ).slice(0, 9),
    [badges, preferredMetricIds, savedPinnedBadgeIds, state.currentUserId],
  );
  const [optimisticPinnedBadgeIds, setOptimisticPinnedBadgeIds] = useState<
    string[] | null
  >(null);
  const pinnedBadgeIds = optimisticPinnedBadgeIds ?? defaultPins;
  useEffect(() => {
    setOptimisticShowcased(null);
    setOptimisticPinnedBadgeIds(null);
  }, [state.group.id]);
  useEffect(() => {
    if (
      optimisticShowcased &&
      optimisticShowcased.join("\u001F") === persistedShowcased.join("\u001F")
    )
      setOptimisticShowcased(null);
  }, [optimisticShowcased, persistedShowcased]);
  useEffect(() => {
    if (
      optimisticPinnedBadgeIds &&
      optimisticPinnedBadgeIds.join("\u001F") === defaultPins.join("\u001F")
    )
      setOptimisticPinnedBadgeIds(null);
  }, [defaultPins, optimisticPinnedBadgeIds]);
  const pinnedBadges = useMemo(
    () =>
      pinnedBadgeIds.flatMap((badgeId) => {
        const badge = badges.find(
          (candidate) =>
            candidate.id === badgeId &&
            candidate.memberId === state.currentUserId,
        );
        return badge ? [badge] : [];
      }),
    [badges, pinnedBadgeIds, state.currentUserId],
  );
  function toggleShowcase(badgeId: string) {
    const next = showcased.includes(badgeId)
      ? showcased.filter((id) => id !== badgeId)
      : showcased.length < 5
        ? [...showcased, badgeId]
        : showcased;
    setOptimisticShowcased(next);
    setTimeout(
      () =>
        updateSettings({
          badgeShowcaseByGroup: {
            ...state.settings.badgeShowcaseByGroup,
            [state.group.id]: next,
          },
        }),
      0,
    );
  }
  function persistPinnedBadges(next: string[]) {
    setOptimisticPinnedBadgeIds(next);
    setTimeout(
      () =>
        updateSettings({
          badgePinnedByGroup: {
            ...state.settings.badgePinnedByGroup,
            [state.group.id]: next,
          },
        }),
      0,
    );
  }
  function pinBadge(badgeId: string) {
    if (pinnedBadgeIds.includes(badgeId) || pinnedBadgeIds.length >= 9) return;
    persistPinnedBadges([...pinnedBadgeIds, badgeId]);
  }
  function unpinBadge(badgeId: string) {
    if (!pinnedBadgeIds.includes(badgeId)) return;
    persistPinnedBadges(pinnedBadgeIds.filter((id) => id !== badgeId));
  }
  const sections = statusSections
    .map((section) => ({
      ...section,
      badges: visible.filter((badge) => badge.status === section.id),
    }))
    .filter((section) => section.badges.length);
  const statusSummaryItems: {
    id: BadgeStatus;
    title: string;
    count: number;
  }[] = [
    {
      id: "earned",
      title: "Earned",
      count: badgePool.filter((badge) => badge.status === "earned").length,
    },
    {
      id: "progress",
      title: "In progress",
      count: badgePool.filter((badge) => badge.status === "progress").length,
    },
    {
      id: "locked",
      title: "Up next",
      count: badgePool.filter((badge) => badge.status === "locked").length,
    },
    {
      id: "recurring",
      title: "Recurring",
      count: badgePool.filter((badge) => badge.status === "recurring").length,
    },
  ];
  function toggleStatusFilter(status: BadgeStatus) {
    const next = statusFilters.includes(status)
      ? statusFilters.filter((item) => item !== status)
      : [...statusFilters, status];
    if (next.length === 1) {
      const only = next[0];
      setOpenSections({
        earned: only === "earned",
        progress: only === "progress",
        locked: only === "locked",
        recurring: only === "recurring",
      });
    } else if (!statusFilters.includes(status)) {
      setOpenSections((current) => ({ ...current, [status]: true }));
    }
    setStatusFilters(next);
  }
  function renderBadge(badge: EarnedBadge) {
    const highlighted =
      params.highlight === badge.id ||
      (params.highlight === "perfect-day" &&
        badge.id === `perfect-days:${state.currentUserId}`);
    const progress = badge.progress
      ? Math.min(
          1,
          badge.progress.current / Math.max(badge.progress.target, 1),
        )
      : undefined;
    const statusLabel =
      badge.status === "progress"
        ? "In progress"
        : badge.status === "locked"
          ? "Up next"
          : badge.status === "recurring"
            ? "Recurring"
            : "Earned";
    const statusColor = badge.status === "locked" ? colors.muted : badge.color;
    const trackerIcon = badge.metricId
      ? (state.metrics.find((metric) => metric.id === badge.metricId)?.icon as
          | EarnedBadge["icon"]
          | undefined)
      : undefined;
    const canManageBadge = badge.memberId === state.currentUserId;
    const isPinned = pinnedBadgeIds.includes(badge.id);
    const pinAtLimit = pinnedBadgeIds.length >= 9 && !isPinned;
    const isShowcased = showcased.includes(badge.id);
    const showcaseAtLimit = showcased.length >= 5 && !isShowcased;
    return (
      <Pressable
        key={badge.id}
        disabled={!showcaseSelection && !badge.memberId}
        onPress={() => {
          if (showcaseSelection && badge.status === "earned") {
            toggleShowcase(badge.id);
            return;
          }
          if (badge.memberId)
            router.navigate(`/member-profile/${badge.memberId}` as never);
        }}
      >
        <Card
          style={[
            styles.badge,
            { borderLeftColor: badge.color },
            highlighted && {
              borderColor: "#D6A82F",
              backgroundColor: colors.isDark ? "#332B17" : "#FFF9E8",
            },
            showcaseSelection && isShowcased && {
              borderColor: accent,
              borderWidth: 2,
            },
          ]}
        >
          <BadgeMedallion badge={badge} trackerIcon={trackerIcon} />
          <View style={styles.copy}>
            <View style={styles.badgeHeading}>
              <Text numberOfLines={1} style={[styles.title, { color: colors.ink }]}>
                {badge.title}
              </Text>
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: `${statusColor}1F` },
                ]}
              >
                <Text
                  preserveColor
                  style={[styles.statusText, { color: statusColor }]}
                >
                  {statusLabel}
                </Text>
              </View>
            </View>
            <Text style={[styles.owner, { color: badge.color }]}>
              {badge.owner} · {badge.caption}
            </Text>
            <Text
              style={[styles.meta, { color: colors.muted }]}
              numberOfLines={2}
            >
              {badge.description}
            </Text>
            <View style={styles.badgeFooter}>
              <Text style={[styles.xpText, { color: badge.color }]}>
                {badgeXpCopy(badge)}
              </Text>
              {progress !== undefined && badge.progress ? (
                <View style={styles.progressRow}>
                  <View
                    style={[
                      styles.progressTrack,
                      { backgroundColor: colors.border },
                    ]}
                  >
                    <View
                      style={[
                        styles.progressFill,
                        {
                          backgroundColor: badge.color,
                          width: `${progress > 0 ? Math.max(3, progress * 100) : 0}%`,
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.progressLabel, { color: colors.muted }]}>
                    {badge.progress.current}/{badge.progress.target}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
          {showcaseSelection && badge.status === "earned" ? (
            <Ionicons
              name={isShowcased ? "checkmark-circle" : "ellipse-outline"}
              size={20}
              color={isShowcased ? accent : colors.faint}
            />
          ) : canManageBadge ? (
            <View style={styles.badgeActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isPinned
                    ? "Badge pinned. Use its X above to unpin it."
                    : pinAtLimit
                      ? "Nine pinned badges already"
                      : "Pin badge"
                }
                accessibilityState={{ disabled: isPinned || pinAtLimit }}
                disabled={isPinned || pinAtLimit}
                onPress={(event) => {
                  event.stopPropagation();
                  pinBadge(badge.id);
                }}
                style={[
                  styles.badgeAction,
                  {
                    borderColor: isPinned ? badge.color : colors.border,
                    backgroundColor: isPinned ? `${badge.color}18` : colors.card,
                    opacity: pinAtLimit ? 0.42 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={isPinned ? "pin" : "pin-outline"}
                  size={15}
                  color={isPinned ? badge.color : colors.muted}
                />
              </Pressable>
              {badge.status === "earned" ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    isShowcased ? "Remove from showcase" : "Add to showcase"
                  }
                  disabled={showcaseAtLimit}
                  onPress={(event) => {
                    event.stopPropagation();
                    toggleShowcase(badge.id);
                  }}
                  style={[
                    styles.badgeAction,
                    {
                      borderColor: isShowcased ? accent : colors.border,
                      backgroundColor: isShowcased
                        ? colors.primarySoft
                        : colors.card,
                      opacity: showcaseAtLimit ? 0.42 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    name={isShowcased ? "star" : "star-outline"}
                    size={15}
                    color={isShowcased ? accent : colors.muted}
                  />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </Card>
      </Pressable>
    );
  }
  return (
    <Screen>
      <PageHeader
        eyebrow={state.group.name}
        translateEyebrow={false}
        title={showcaseSelection ? "Choose showcase badges" : "Badge cabinet"}
        subtitle={
          showcaseSelection
            ? `${showcased.length}/5 selected · tap earned badges to feature them.`
            : "A clear path from today's actions to lasting milestones."
        }
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => router.back()}
          />
        }
      />

      <TutorialTarget id="badge-cabinet">
      <Card style={styles.summaryCard}>
        <View style={styles.summaryHeading}>
          <View
            style={[
              styles.summaryIcon,
              { backgroundColor: colors.primarySoft },
            ]}
          >
            <Ionicons name="ribbon-outline" size={19} color={accent} />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.summaryTitle, { color: colors.ink }]}>
              Level {level.level} · {level.levelTitle}
            </Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              {levelOwner ? memberDisplayName(state, levelOwner) : "Member"} · {level.xp.toLocaleString()} momentum XP
            </Text>
          </View>
          <View style={[styles.levelBubble, { backgroundColor: `${accent}18`, borderColor: accent }]}>
            <Text style={[styles.levelNumber, { color: accent }]}>{level.level}</Text>
          </View>
        </View>
        <View style={styles.levelProgressRow}>
          <View style={[styles.levelTrack, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.levelFill,
                { backgroundColor: accent, width: `${Math.max(2, level.levelProgress * 100)}%` },
              ]}
            />
          </View>
          <Text style={[styles.levelProgressText, { color: colors.muted }]}>
            {Math.max(0, level.nextLevelXp - level.xp).toLocaleString()} XP to level {level.level + 1}
          </Text>
        </View>
        {level.nextBadge?.progress ? (
          <View style={[styles.nextAim, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="navigate-circle-outline" size={15} color={accent} />
            <Text style={[styles.nextAimText, { color: colors.ink }]} numberOfLines={1}>
              Up next: {level.nextBadge.title} · {level.nextBadge.progress.current}/{level.nextBadge.progress.target}
            </Text>
          </View>
        ) : null}
        {!showcaseSelection && levelOwnerId === state.currentUserId ? (
          <View style={styles.pinnedBlock}>
            <View style={styles.pinnedHeading}>
              <View style={styles.pinnedTitleRow}>
                <Ionicons name="pin" size={13} color={accent} />
                <Text style={[styles.pinnedLabel, { color: colors.ink }]}>Pinned badges</Text>
              </View>
            </View>
            {pinnedBadges.length ? (
              <View style={styles.pinnedRow}>
                {pinnedBadges.map((badge) => {
                  const trackerIcon = badge.metricId
                    ? (state.metrics.find((metric) => metric.id === badge.metricId)
                        ?.icon as EarnedBadge["icon"] | undefined)
                    : undefined;
                  return (
                    <View
                      key={badge.id}
                      style={[
                        styles.pinnedBadge,
                        {
                          backgroundColor: `${badge.color}10`,
                          borderColor: `${badge.color}42`,
                        },
                      ]}
                    >
                      <BadgeMedallion badge={badge} trackerIcon={trackerIcon} size={38} />
                      <Text numberOfLines={2} style={[styles.pinnedBadgeTitle, { color: colors.ink }]}>
                        {badge.title}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Unpin ${badge.title}`}
                        hitSlop={7}
                        onPress={() => unpinBadge(badge.id)}
                        style={styles.pinnedRemove}
                      >
                        <Ionicons
                          name="close-circle"
                          size={15}
                          color={colors.faint}
                        />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={[styles.pinnedEmpty, { color: colors.muted }]}>Pin a badge below to keep it here.</Text>
            )}
          </View>
        ) : null}
        {!showcaseSelection ? (
          <View>
            <Text style={[styles.statusHint, { color: colors.muted }]}>Tap to filter · select more than one</Text>
            <View style={styles.statusCounts}>
              {statusSummaryItems.map((item) => {
                const selected = statusFilters.includes(item.id);
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => toggleStatusFilter(item.id)}
                    style={[
                      styles.statusCount,
                      {
                        borderColor: selected ? accent : colors.border,
                        backgroundColor: selected ? colors.primarySoft : colors.card,
                      },
                    ]}
                  >
                    <Text style={[styles.countValue, { color: selected ? accent : colors.ink }]}>
                      {item.count}
                    </Text>
                    <Text style={[styles.countLabel, { color: colors.muted }]}>
                      {item.title}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </Card>
      </TutorialTarget>

      {sections.length ? (
        sections.map((section) => (
          <View key={section.id} style={styles.section}>
            <Pressable
              onPress={() =>
                setOpenSections((current) => ({
                  ...current,
                  [section.id]: !current[section.id],
                }))
              }
            >
              <SectionHeader
                title={`${section.title} · ${section.badges.length}`}
                action={
                  <Ionicons
                    name={openSections[section.id] ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.muted}
                  />
                }
              />
              <View style={styles.sectionIntro}>
                <Ionicons name={section.icon} size={14} color={accent} />
                <Text style={[styles.sectionDescription, { color: colors.muted }]}>
                  {section.description}
                </Text>
              </View>
            </Pressable>
            {openSections[section.id] ? (
              <View style={styles.aimList}>
                {aimSections.map((aim) => {
                  const aimedBadges = section.badges.filter(
                    (badge) => badgeAim(badge) === aim.id,
                  );
                  if (!aimedBadges.length) return null;
                  return (
                    <View key={aim.id} style={styles.aimGroup}>
                      <View style={styles.aimHeading}>
                        <View
                          style={[
                            styles.aimIcon,
                            { backgroundColor: colors.primarySoft },
                          ]}
                        >
                          <Ionicons name={aim.icon} size={13} color={accent} />
                        </View>
                        <Text style={[styles.aimTitle, { color: colors.ink }]}>
                          {aim.title}
                        </Text>
                        <Text style={[styles.aimCount, { color: colors.muted }]}>
                          {aimedBadges.length}
                        </Text>
                      </View>
                      <View style={styles.list}>
                        {aimedBadges.map(renderBadge)}
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
        ))
      ) : (
        <Card style={styles.empty}>
          <Ionicons name="filter-outline" size={24} color={accent} />
          <Text style={[styles.title, { color: colors.ink }]}>
            No matching awards
          </Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            Select another person, tracker, or award status.
          </Text>
        </Card>
      )}

      <View style={styles.menus}>
        <SelectionMenu
          title="People"
          items={state.group.members.map((member) => ({
            id: member.id,
            label: memberDisplayName(state, member),
            icon: "person-outline",
            color: member.color,
            group: "Group members",
          }))}
          selectedIds={memberIds}
          onChange={setMemberIds}
          emptyLabel="No people selected"
          searchable={state.group.members.length > 7}
        />
        <SelectionMenu
          title="Trackers"
          items={trackerItems}
          selectedIds={metricIds}
          onChange={(selected) =>
            setHiddenMetricIds(
              trackerItems
                .map((item) => item.id)
                .filter((id) => !selected.includes(id)),
            )
          }
          emptyLabel="Group-wide awards only"
          searchable
        />
        <SelectionMenu
          title="Award groups"
          items={aimSections.map((aim) => ({
            id: aim.id,
            label: aim.title,
            icon: aim.icon,
            color: accent,
            group: "Badge groups",
          }))}
          selectedIds={aimFilters}
          onChange={(ids) => setAimFilters(ids as BadgeAim[])}
          emptyLabel="No award groups selected"
          searchable={false}
          icon="funnel-outline"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summaryCard: { gap: 14, padding: 16 },
  summaryHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  summaryIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryTitle: { fontSize: 13, fontWeight: "900" },
  levelBubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  levelNumber: { fontSize: 16, fontWeight: "900" },
  levelProgressRow: { gap: 5 },
  levelTrack: { height: 8, borderRadius: 5, overflow: "hidden" },
  levelFill: { height: "100%", borderRadius: 5 },
  levelProgressText: { fontSize: 8, fontWeight: "800", textAlign: "right" },
  nextAim: {
    minHeight: 36,
    borderRadius: 11,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  nextAimText: { flex: 1, fontSize: 9, fontWeight: "900" },
  pinnedBlock: { gap: 8 },
  pinnedHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pinnedTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  pinnedLabel: { fontSize: 9, fontWeight: "900" },
  pinnedRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  pinnedBadge: {
    position: "relative",
    width: "31.5%",
    minHeight: 88,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },
  pinnedBadgeTitle: {
    minHeight: 20,
    fontSize: 7,
    lineHeight: 10,
    fontWeight: "900",
    textAlign: "center",
  },
  pinnedRemove: {
    position: "absolute",
    top: 1,
    right: 1,
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  pinnedEmpty: { fontSize: 8, fontWeight: "700" },
  statusHint: { fontSize: 8, marginBottom: 7 },
  statusCounts: { flexDirection: "row", gap: 6 },
  statusCount: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    paddingVertical: 7,
  },
  countValue: { fontSize: 15, fontWeight: "900" },
  countLabel: { fontSize: 7, fontWeight: "800", textAlign: "center", marginTop: 2 },
  menus: { gap: 10, marginTop: 9, marginBottom: 4 },
  section: { gap: 9, marginTop: 5, marginBottom: 14 },
  sectionIntro: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: -3,
    marginBottom: 2,
    paddingHorizontal: 4,
  },
  sectionDescription: { flex: 1, fontSize: 9, lineHeight: 13 },
  aimList: { gap: 15 },
  aimGroup: { gap: 9 },
  aimHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 4,
  },
  aimIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  aimTitle: { flex: 1, fontSize: 10, fontWeight: "900" },
  aimCount: { fontSize: 8, fontWeight: "900" },
  list: { gap: 12 },
  badge: {
    minHeight: 108,
    borderLeftWidth: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
  },
  badgeHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusPill: {
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  statusText: { fontSize: 7, fontWeight: "900" },
  copy: { flex: 1, minWidth: 0 },
  title: { flex: 1, fontSize: 11, fontWeight: "900" },
  owner: { fontSize: 8, fontWeight: "900", marginTop: 2 },
  meta: { fontSize: 8, lineHeight: 12, marginTop: 2 },
  badgeFooter: { gap: 3, marginTop: 5 },
  xpText: { fontSize: 7, fontWeight: "900" },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    minHeight: 14,
    borderRadius: 8,
  },
  progressTrack: {
    width: 58,
    height: 4,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 4 },
  progressLabel: { fontSize: 7, fontWeight: "900" },
  badgeActions: { alignSelf: "stretch", justifyContent: "center", gap: 7 },
  badgeAction: {
    width: 28,
    height: 28,
    borderWidth: 1,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: { alignItems: "center", gap: 6, padding: 24 },
});
