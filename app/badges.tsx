import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { SelectionMenu } from "@/src/components/SelectionMenu";
import {
  Avatar,
  Card,
  Chip,
  IconButton,
  PageHeader,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import {
  BadgePeriod,
  BadgeStatus,
  EarnedBadge,
  buildBadges,
} from "@/src/domain/badges";
import { dateKey, friendlyDate } from "@/src/domain/date";
import { memberDisplayName } from "@/src/domain/members";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";

type Filter = "all" | BadgePeriod;

const periodFilters: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "today", label: "Day" },
  { id: "yesterday", label: "Previous" },
  { id: "week", label: "7 days" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
  { id: "achievement", label: "Milestones" },
];

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
    anchor?: string;
    filter?: Filter;
    highlight?: string;
  }>();
  const { state } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [anchor, setAnchor] = useState(params.anchor ?? dateKey());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>(
    periodFilters.some((item) => item.id === params.filter)
      ? (params.filter as Filter)
      : "achievement",
  );
  const [memberIds, setMemberIds] = useState([state.currentUserId]);
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
  const badges = useMemo(() => buildBadges(state, anchor), [anchor, state]);
  const visible = useMemo(
    () =>
      badges
        .filter(
          (badge) =>
            (filter === "all" || badge.period === filter) &&
            (!badge.memberId || memberIds.includes(badge.memberId)) &&
            (!badge.metricId ||
              metricIds.includes(badge.metricId) ||
              (nutritionTrackerIds.has(badge.metricId) &&
                metricIds.includes("food"))),
        )
        .sort(sortBadges),
    [badges, filter, memberIds, metricIds],
  );
  const sections = statusSections
    .map((section) => ({
      ...section,
      badges: visible.filter((badge) => badge.status === section.id),
    }))
    .filter((section) => section.badges.length);
  const statusCounts = statusSections.map((section) => ({
    ...section,
    count: visible.filter((badge) => badge.status === section.id).length,
  }));

  return (
    <Screen>
      <PageHeader
        eyebrow={state.group.name}
        translateEyebrow={false}
        title="Badge cabinet"
        subtitle="See what you earned, what is progressing, and what to aim for next."
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => router.back()}
          />
        }
      />

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
              Your award path
            </Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              Milestones adapt to the trackers and goals shared in this group.
            </Text>
          </View>
        </View>
        <View style={styles.statusCounts}>
          {statusCounts.map((item) => (
            <View key={item.id} style={styles.statusCount}>
              <Text style={[styles.countValue, { color: colors.ink }]}>
                {item.count}
              </Text>
              <Text style={[styles.countLabel, { color: colors.muted }]}>
                {item.title}
              </Text>
            </View>
          ))}
        </View>
      </Card>

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
      </View>

      <View style={styles.filterRow}>
        {periodFilters.map((item) => (
          <Chip
            key={item.id}
            label={item.label}
            selected={filter === item.id}
            onPress={() => setFilter(item.id)}
          />
        ))}
      </View>

      <Pressable onPress={() => setCalendarOpen((open) => !open)}>
        <Card style={styles.dateRow}>
          <Ionicons name="calendar-outline" size={18} color={accent} />
          <View style={styles.copy}>
            <Text style={[styles.title, { color: colors.ink }]}>
              Awards ending {friendlyDate(anchor)}
            </Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              Choose another reference date
            </Text>
          </View>
          <Ionicons
            name={calendarOpen ? "chevron-up" : "chevron-down"}
            size={17}
            color={colors.muted}
          />
        </Card>
      </Pressable>
      {calendarOpen ? (
        <Card>
          <MonthCalendar
            monthDate={anchor}
            selectedDate={anchor}
            onMonthChange={setAnchor}
            onSelect={(date) => {
              setAnchor(date);
              setCalendarOpen(false);
            }}
          />
        </Card>
      ) : null}

      {sections.length ? (
        sections.map((section) => (
          <View key={section.id}>
            <SectionHeader title={`${section.title} · ${section.badges.length}`} />
            <View style={styles.sectionIntro}>
              <Ionicons name={section.icon} size={14} color={accent} />
              <Text style={[styles.sectionDescription, { color: colors.muted }]}>
                {section.description}
              </Text>
            </View>
            <View style={styles.list}>
              {section.badges.map((badge) => {
                const member = badge.memberId
                  ? state.group.members.find(
                      (item) => item.id === badge.memberId,
                    )
                  : undefined;
                const highlightPerfectDay =
                  params.highlight === "perfect-day" &&
                  badge.id === `perfect-days:${state.currentUserId}`;
                const progress = badge.progress
                  ? Math.min(
                      1,
                      badge.progress.current /
                        Math.max(badge.progress.target, 1),
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
                const statusColor =
                  badge.status === "locked" ? colors.muted : badge.color;
                return (
                  <Pressable
                    key={badge.id}
                    disabled={!badge.memberId}
                    onPress={() =>
                      badge.memberId &&
                      router.navigate(`/member/${badge.memberId}` as never)
                    }
                  >
                    <Card
                      style={[
                        styles.badge,
                        { borderLeftColor: badge.color },
                        highlightPerfectDay && {
                          borderColor: "#D6A82F",
                          backgroundColor: colors.isDark
                            ? "#332B17"
                            : "#FFF9E8",
                        },
                      ]}
                    >
                      {member ? (
                        <Avatar
                          initials={member.initials}
                          color={member.color}
                          uri={member.avatarUri}
                          size={36}
                        />
                      ) : (
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
                      )}
                      <View style={styles.copy}>
                        <View style={styles.badgeHeading}>
                          <Text
                            numberOfLines={1}
                            style={[styles.title, { color: colors.ink }]}
                          >
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
                                    width: `${
                                      progress > 0
                                        ? Math.max(3, progress * 100)
                                        : 0
                                    }%`,
                                  },
                                ]}
                              />
                            </View>
                            <Text
                              style={[
                                styles.progressLabel,
                                { color: colors.muted },
                              ]}
                            >
                              {badge.progress.current}/{badge.progress.target}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={[styles.date, { color: colors.faint }]}>
                        {friendlyDate(badge.anchorDate)}
                      </Text>
                    </Card>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))
      ) : (
        <Card style={styles.empty}>
          <Ionicons name="filter-outline" size={24} color={accent} />
          <Text style={[styles.title, { color: colors.ink }]}>
            No matching awards
          </Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            Select another person, tracker, period, or date.
          </Text>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summaryCard: { gap: 10, padding: 11 },
  summaryHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  summaryIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryTitle: { fontSize: 12, fontWeight: "900" },
  statusCounts: { flexDirection: "row", gap: 5 },
  statusCount: { flex: 1, minWidth: 0, alignItems: "center" },
  countValue: { fontSize: 14, fontWeight: "900" },
  countLabel: { fontSize: 7, fontWeight: "800", textAlign: "center" },
  menus: { gap: 7 },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginVertical: 2,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingVertical: 10,
  },
  sectionIntro: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: -3,
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  sectionDescription: { flex: 1, fontSize: 8, lineHeight: 12 },
  list: { gap: 7 },
  badge: {
    minHeight: 84,
    borderLeftWidth: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
  },
  badgeIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
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
  date: { fontSize: 7, fontWeight: "800", alignSelf: "flex-start" },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  progressTrack: {
    flex: 1,
    height: 5,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 4 },
  progressLabel: { fontSize: 7, fontWeight: "900" },
  empty: { alignItems: "center", gap: 6, padding: 24 },
});
