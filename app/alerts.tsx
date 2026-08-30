import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { BadgeMedallion } from "@/src/components/BadgeMedallion";
import { useLocale, useTranslation } from "@/src/i18n";
import {
  Avatar,
  Card,
  Chip,
  IconButton,
  PageHeader,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import { AlertCategory, buildAlerts } from "@/src/domain/alerts";
import { buildBadges } from "@/src/domain/badges";
import { dateKey, friendlyDate } from "@/src/domain/date";
import { isCloudGroupId } from "@/src/cloud/groupCloud";
import { useBadgeChallengeInputs } from "@/src/cloud/useBadgeChallengeInputs";
import { useAccountNotificationEvents } from "@/src/cloud/useAccountNotificationEvents";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";

type Filter = "all" | AlertCategory | "badges";

export default function Alerts() {
  const { scope } = useLocalSearchParams<{ scope?: string }>();
  const { state, updateSettings } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const locale = useLocale();
  const t = useTranslation();
  const [filter, setFilter] = useState<Filter>("all");
  const initializedFeedKey = useRef<string | undefined>(undefined);
  const alertScope = scope === "group" ? "group" : "personal";
  const hasGroup = isCloudGroupId(state.group.id);
  const feedKey = `${alertScope}:${state.currentUserId}:${state.group.id}`;
  const badgeAnchor = dateKey();
  const badgeChallengeInputs = useBadgeChallengeInputs(
    state.group.id,
    state.currentUserId,
    badgeAnchor,
    filter === "badges",
  );
  const accountFeed = useAccountNotificationEvents();
  const {
    events: accountFeedEvents,
    loading: groupFeedLoading,
    loaded: groupFeedLoaded,
    markRead: markGroupFeedRead,
  } = accountFeed;
  const groupFeedEvents = useMemo(
    () =>
      alertScope === "group"
        ? accountFeedEvents.filter((event) => event.groupId === state.group.id)
        : accountFeedEvents,
    [accountFeedEvents, alertScope, state.group.id],
  );
  const allAlerts = useMemo(
    () =>
      buildAlerts(state, groupFeedEvents).filter((alert) =>
        alertScope === "group"
          ? alert.scope === "group"
          : alert.scope === "personal" ||
            alert.category === "challenge" ||
            hasGroup,
      ),
    [
      alertScope,
      groupFeedEvents,
      hasGroup,
      state,
    ],
  );
  const alerts = useMemo(
    () =>
      allAlerts.filter(
        (alert) =>
          filter === "all" ||
          (filter !== "badges" && alert.category === filter),
      ),
    [allAlerts, filter],
  );
  const unreadCategories = useMemo(
    () =>
      new Set(
        allAlerts
          .filter((alert) => alert.unread === true)
          .map((alert) => alert.category),
      ),
    [allAlerts],
  );
  useEffect(() => {
    if (
      initializedFeedKey.current === feedKey ||
      !groupFeedLoaded ||
      groupFeedLoading
    )
      return;
    initializedFeedKey.current = feedKey;
    const latestUnread = allAlerts.find((alert) => alert.unread === true);
    setFilter(latestUnread?.category ?? "all");
  }, [
    alertScope,
    allAlerts,
    feedKey,
    groupFeedLoaded,
    groupFeedLoading,
  ]);
  const chooseFilter = (next: Filter) => {
    initializedFeedKey.current = feedKey;
    setFilter(next);
  };
  const unreadEventIds = useMemo(
    () =>
      groupFeedEvents
        .filter((event) => !event.readAt)
        .map((event) => event.id),
    [groupFeedEvents],
  );
  const visibleUnreadEventIds = useMemo(() => {
    if (filter === "all") return unreadEventIds;
    if (filter === "challenge")
      return groupFeedEvents
        .filter((event) => !event.readAt && event.kind !== "social_reaction")
        .map((event) => event.id);
    if (filter === "lead")
      return groupFeedEvents
        .filter((event) => !event.readAt && event.kind === "social_reaction")
        .map((event) => event.id);
    return [];
  }, [filter, groupFeedEvents, unreadEventIds]);
  useEffect(() => {
    if (visibleUnreadEventIds.length === 0) return;
    // Viewing All or a matching category is the durable read boundary.
    const timer = setTimeout(() => {
      void markGroupFeedRead(visibleUnreadEventIds).catch(() => undefined);
    }, 600);
    return () => clearTimeout(timer);
  }, [markGroupFeedRead, visibleUnreadEventIds]);
  const visibleActivityReadCursors = useMemo(() => {
    const latestByKey: Record<string, string> = {};
    allAlerts.forEach((alert) => {
      if (
        alert.unread !== true ||
        !alert.readCursorKey ||
        (filter !== "all" && alert.category !== filter)
      )
        return;
      if (
        !latestByKey[alert.readCursorKey] ||
        alert.createdAt > latestByKey[alert.readCursorKey]
      )
        latestByKey[alert.readCursorKey] = alert.createdAt;
    });
    return latestByKey;
  }, [allAlerts, filter]);
  const visibleActivityReadCursorKey = JSON.stringify(
    visibleActivityReadCursors,
  );
  useEffect(() => {
    if (!Object.keys(visibleActivityReadCursors).length) return;
    const timer = setTimeout(() => {
      updateSettings({
        notifications: {
          ...state.settings.notifications,
          activityReadAtByCategory: {
            ...state.settings.notifications.activityReadAtByCategory,
            ...visibleActivityReadCursors,
          },
        },
      });
    }, 600);
    return () => clearTimeout(timer);
    // The serialized key is the stable boundary; the object is intentionally
    // recreated from the currently visible unread activity cards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateSettings, visibleActivityReadCursorKey]);
  const badges = useMemo(
    () =>
      buildBadges(
        state,
        badgeAnchor,
        badgeChallengeInputs.challenges,
        badgeAnchor,
        badgeChallengeInputs.placements,
        badgeChallengeInputs.settledOccurrenceKeys,
      )
        .filter((badge) =>
          (alertScope === "personal"
            ? !badge.memberId || badge.memberId === state.currentUserId
            : Boolean(badge.memberId)) &&
          (badge.status === "earned" || badge.status === "progress"),
        )
        .sort((left, right) => {
          if (left.status !== right.status)
            return left.status === "earned" ? -1 : 1;
          if (left.status === "progress") {
            const leftProgress = left.progress
              ? left.progress.current / Math.max(1, left.progress.target)
              : 0;
            const rightProgress = right.progress
              ? right.progress.current / Math.max(1, right.progress.target)
              : 0;
            return rightProgress - leftProgress;
          }
          return right.anchorDate.localeCompare(left.anchorDate);
        })
        .slice(0, 12),
    [
      alertScope,
      badgeAnchor,
      badgeChallengeInputs.challenges,
      badgeChallengeInputs.placements,
      badgeChallengeInputs.settledOccurrenceKeys,
      state,
    ],
  );
  const showBadges = filter === "badges";

  return (
    <Screen>
      <PageHeader
        eyebrow={state.group.name}
        translateEyebrow={false}
        title={scope === "group" ? "Group updates" : "Your updates"}
        subtitle={
          scope === "group"
            ? "Membership, rankings, group messages, and awards."
            : "Your reminders, messages, and achievements."
        }
        showMenu={false}
        action={
          <View style={styles.headerActions}>
            <IconButton
              icon="settings-outline"
              label="Notification settings"
              onPress={() => router.push("/notifications" as never)}
            />
            <IconButton icon="close" label="Close" onPress={() => router.back()} />
          </View>
        }
      />

      {scope === "group" && (state.group.pendingMembers?.length ?? 0) > 0 ? (
        <Pressable
          onPress={() => router.navigate("/group-settings" as never)}
          style={styles.joinRequest}
        >
          <Card style={[styles.alert, { borderLeftColor: "#F06A45" }]}>
            <View style={[styles.icon, { backgroundColor: "#F06A4520" }]}>
              <Ionicons
                name="person-add-outline"
                size={20}
                color="#F06A45"
              />
            </View>
            <View style={styles.copy}>
              <Text style={[styles.title, { color: colors.ink }]}>
                {state.group.pendingMembers!.length} join request
                {state.group.pendingMembers!.length === 1 ? "" : "s"}
              </Text>
              <Text style={[styles.detail, { color: colors.muted }]}>
                Tap to review and approve or remove pending members.
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={17}
              color={colors.faint}
            />
          </Card>
        </Pressable>
      ) : null}

      <View style={styles.filters}>
        <Chip
          label="All"
          selected={filter === "all"}
          onPress={() => chooseFilter("all")}
        />
        {alertScope === "personal" ? (
          <View style={styles.filterChip}>
            <Chip
              label="Today"
              selected={filter === "today"}
              onPress={() => chooseFilter("today")}
            />
            {unreadCategories.has("today") ? <View style={styles.filterUnreadDot} /> : null}
          </View>
        ) : null}
        {hasGroup ? <View style={styles.filterChip}>
          <Chip
            label="Leaderboard"
            selected={filter === "lead"}
            onPress={() => chooseFilter("lead")}
          />
          {unreadCategories.has("lead") ? <View style={styles.filterUnreadDot} /> : null}
        </View> : null}
        {hasGroup ? <View style={styles.filterChip}>
          <Chip
            label="Messages"
            selected={filter === "message"}
            onPress={() => chooseFilter("message")}
          />
          {unreadCategories.has("message") ? <View style={styles.filterUnreadDot} /> : null}
        </View> : null}
        {hasGroup ? <View style={styles.filterChip}>
          <Chip
            label="Challenges"
            translate={false}
            selected={filter === "challenge"}
            onPress={() => chooseFilter("challenge")}
          />
          {unreadCategories.has("challenge") ? <View style={styles.filterUnreadDot} /> : null}
        </View> : null}
        <Chip
          label="Badge cabinet"
          icon="ribbon-outline"
          selected={filter === "badges"}
          onPress={() => chooseFilter("badges")}
        />
      </View>

      {showBadges ? (
        <>
          <SectionHeader
            title={`Badge cabinet · ${badges.length}`}
            action={
              <Pressable onPress={() => router.push("/badges" as never)}>
                <Text style={[styles.link, { color: accent }]}>See all</Text>
              </Pressable>
            }
          />
          <View style={styles.badges}>
            {badges.map((badge) => {
              const trackerIcon = badge.metricId
                ? (state.metrics.find((metric) => metric.id === badge.metricId)
                    ?.icon as typeof badge.icon | undefined)
                : undefined;
              return (
                <Pressable
                  key={badge.id}
                  onPress={() =>
                    badge.memberId
                      ? router.push(`/member-profile/${badge.memberId}` as never)
                      : undefined
                  }
                  style={[
                    styles.badge,
                    {
                      backgroundColor: colors.card,
                      borderColor: `${badge.color}55`,
                    },
                  ]}
                >
                  <BadgeMedallion
                    badge={badge}
                    trackerIcon={trackerIcon}
                    size={38}
                  />
                  <View style={styles.copy}>
                    <Text style={[styles.badgeTitle, { color: colors.ink }]}>
                      {badge.title}
                    </Text>
                    <Text style={[styles.badgeOwner, { color: badge.color }]}>
                      {badge.owner} · {badge.periodLabel}
                    </Text>
                    <Text
                      style={[styles.badgeCaption, { color: colors.muted }]}
                    >
                      {badge.caption}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {filter !== "badges" ? (
        <>
          <SectionHeader title="Activity" />
          <View style={styles.list}>
            {alerts.map((alert) => {
              const member = alert.memberId
                ? state.group.members.find(
                    (item) => item.id === alert.memberId,
                  )
                : undefined;
              return (
                <Pressable
                  key={alert.id}
                  onPress={() => {
                    if (alert.category === "message") {
                      router.push(
                        alert.memberId
                          ? ({ pathname: "/chat", params: { recipient: alert.memberId } } as never)
                          : ("/chat" as never),
                      );
                      return;
                    }
                    if (alert.category === "challenge") {
                      router.navigate({
                        pathname: "/challenges",
                        params: {
                          ...(alert.challengeId
                            ? { challengeId: alert.challengeId }
                            : {}),
                          ...(alert.challengeOccurrenceDate
                            ? {
                                challengeOccurrenceDate:
                                  alert.challengeOccurrenceDate,
                              }
                            : {}),
                          ...(alert.groupId ? { groupId: alert.groupId } : {}),
                          // A fresh nonce lets the same alert refocus its card
                          // after the user has browsed to another period/page.
                          challengeFocusAt: String(Date.now()),
                        },
                      } as never);
                      return;
                    }
                    if (alert.todoId) {
                      router.navigate({
                        pathname: "/metric-detail",
                        params: {
                          metric: "todos",
                          date: alert.localDate,
                          focusTodo: alert.todoId,
                          todoFocusAt: String(Date.now()),
                        },
                      } as never);
                      return;
                    }
                    if (alert.metricId && alert.scope === "personal") {
                      router.navigate({
                        pathname: "/metric-detail",
                        params: { metric: alert.metricId, date: alert.localDate },
                      } as never);
                      return;
                    }
                    if (alert.targetType === "photo_update" && alert.entryId) {
                      router.navigate({
                        pathname: "/(tabs)/recapfeed",
                        params: {
                          period: "custom",
                          anchor: alert.localDate,
                          highlight: `photo:${alert.entryId}`,
                        },
                      } as never);
                      return;
                    }
                    if (alert.metricId || alert.entryId) {
                      router.navigate({
                        pathname: "/leaderboard-detail",
                        params: {
                          period: "custom",
                          anchor: alert.localDate,
                          ...(alert.metricId ? { metrics: alert.metricId } : {}),
                          memberId: alert.memberId,
                          entryId: alert.entryId,
                          logFocusAt: String(Date.now()),
                        },
                      } as never);
                      return;
                    }
                    if (alert.memberId)
                      router.push(`/member-profile/${alert.memberId}` as never);
                  }}
                >
                  <Card
                    style={[styles.alert, { borderLeftColor: alert.color }]}
                  >
                    {member ? (
                      <Avatar
                        initials={member.initials}
                        color={member.color}
                        uri={member.avatarUri}
                        size={41}
                      />
                    ) : (
                      <View
                        style={[
                          styles.icon,
                          { backgroundColor: `${alert.color}18` },
                        ]}
                      >
                        <Ionicons
                          name={alert.icon}
                          size={20}
                          color={alert.color}
                        />
                      </View>
                    )}
                    <View style={styles.copy}>
                      <Text style={[styles.title, { color: colors.ink }]}>
                        {alert.title}
                      </Text>
                      <Text style={[styles.detail, { color: colors.muted }]}>
                        {alert.detail}
                      </Text>
                      <Text style={[styles.date, { color: colors.faint }]}>
                        {friendlyDate(alert.createdAt.slice(0, 10), locale)} ·{" "}
                        {new Date(alert.createdAt).toLocaleTimeString(locale, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={17}
                      color={colors.faint}
                    />
                    {alert.unread === true ? (
                      <View
                        accessibilityLabel={t("Unread notification")}
                        style={[styles.unreadDot, { borderColor: colors.card }]}
                      />
                    ) : null}
                  </Card>
                </Pressable>
              );
            })}
            {!alerts.length ? (
              <Card style={styles.empty}>
                <Ionicons
                  name="notifications-off-outline"
                  size={25}
                  color={accent}
                />
                <Text style={[styles.emptyText, { color: colors.muted }]}>
                  No alerts in this category yet.
                </Text>
              </Card>
            ) : null}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: "row", gap: 6 },
  joinRequest: { marginBottom: 12 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 4 },
  filterChip: { position: "relative" },
  filterUnreadDot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#F06A45",
  },
  link: { fontSize: 10, fontWeight: "900" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badge: {
    width: "48%",
    minWidth: 150,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 15,
    padding: 9,
  },
  badgeTitle: { fontSize: 10, fontWeight: "900" },
  badgeOwner: { fontSize: 8, fontWeight: "800", marginTop: 2 },
  badgeCaption: { fontSize: 8, marginTop: 2 },
  list: { gap: 8 },
  alert: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderLeftWidth: 4,
    padding: 13,
  },
  icon: {
    width: 41,
    height: 41,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1 },
  title: { fontSize: 12, fontWeight: "900" },
  detail: { fontSize: 9, lineHeight: 14, marginTop: 2 },
  date: { fontSize: 8, marginTop: 4 },
  empty: { alignItems: "center", padding: 28 },
  emptyText: { fontSize: 11, marginTop: 8 },
  unreadDot: {
    position: "absolute",
    top: 9,
    right: 9,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 2,
    backgroundColor: "#F06A45",
  },
});
