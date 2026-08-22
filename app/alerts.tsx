import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { useLocale } from "@/src/i18n";
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
import { friendlyDate } from "@/src/domain/date";
import { useGroupNotificationEvents } from "@/src/cloud/useGroupNotificationEvents";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";

type Filter = "all" | AlertCategory | "badges";

export default function Alerts() {
  const { scope } = useLocalSearchParams<{ scope?: string }>();
  const { state } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const locale = useLocale();
  const [filter, setFilter] = useState<Filter>("all");
  const alertScope = scope === "group" ? "group" : "personal";
  const {
    events: groupFeedEvents,
    markRead: markGroupFeedRead,
  } = useGroupNotificationEvents(
    state.group.id,
    state.settings.notifications.groupPreferencesByGroup?.[state.group.id],
  );
  const alerts = useMemo(
    () =>
      buildAlerts(state, groupFeedEvents).filter(
        (alert) =>
          alert.scope === alertScope &&
          (filter === "all" ||
            (filter !== "badges" && alert.category === filter)),
      ),
    [
      alertScope,
      filter,
      groupFeedEvents,
      state,
    ],
  );
  const unreadEventIds = useMemo(
    () =>
      groupFeedEvents
        .filter((event) => !event.readAt)
        .map((event) => event.id),
    [groupFeedEvents],
  );
  useEffect(() => {
    if (alertScope !== "group" || unreadEventIds.length === 0) return;
    // Opening the bell feed is the read boundary. A short delay lets the user
    // see which cards were new before the private server cursors advance.
    const timer = setTimeout(() => {
      void markGroupFeedRead(unreadEventIds).catch(() => undefined);
    }, 600);
    return () => clearTimeout(timer);
  }, [alertScope, markGroupFeedRead, unreadEventIds]);
  const badges = useMemo(
    () =>
      buildBadges(state)
        .filter((badge) =>
          alertScope === "personal"
            ? !badge.memberId || badge.memberId === state.currentUserId
            : Boolean(badge.memberId),
        )
        .slice(0, 20),
    [alertScope, state],
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
          onPress={() => setFilter("all")}
        />
        <Chip
          label="Leaderboard"
          selected={filter === "lead"}
          onPress={() => setFilter("lead")}
        />
        <Chip
          label="Messages"
          selected={filter === "message"}
          onPress={() => setFilter("message")}
        />
        <Chip
          label="Challenges"
          translate={false}
          selected={filter === "challenge"}
          onPress={() => setFilter("challenge")}
        />
        <Chip
          label="Badge cabinet"
          icon="ribbon-outline"
          selected={filter === "badges"}
          onPress={() => setFilter("badges")}
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
            {badges.map((badge) => (
              <Pressable
                key={badge.id}
                onPress={() =>
                  badge.memberId
                    ? router.push(`/member/${badge.memberId}` as never)
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
                <View
                  style={[
                    styles.badgeIcon,
                    { backgroundColor: `${badge.color}20` },
                  ]}
                >
                  <Ionicons
                    name={badge.icon}
                    size={18}
                    color={badge.color}
                  />
                </View>
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
            ))}
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
                  onPress={() =>
                    alert.category === "message"
                      ? router.push("/chat" as never)
                      : alert.category === "challenge"
                        ? router.navigate("/group" as never)
                      : alert.memberId
                        ? router.push(`/member/${alert.memberId}` as never)
                        : undefined
                  }
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
                    {alert.category === "challenge" && !alert.readAt ? (
                      <View
                        accessibilityLabel="Challenge started"
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
  badgeIcon: {
    width: 35,
    height: 35,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
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
