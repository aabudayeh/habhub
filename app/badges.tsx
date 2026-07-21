import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/src/components/AppText";

import { MetricSelector } from "@/src/components/MetricSelector";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import {
  Avatar,
  Card,
  Chip,
  IconButton,
  PageHeader,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import { BadgePeriod, buildBadges } from "@/src/domain/badges";
import { dateKey, friendlyDate } from "@/src/domain/date";
import { memberDisplayName } from "@/src/domain/members";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";

type Filter = "all" | BadgePeriod;
const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "today", label: "Day" },
  { id: "yesterday", label: "Previous day" },
  { id: "week", label: "7 days" },
  { id: "month", label: "Month" },
  { id: "achievement", label: "Milestones" },
];

export default function BadgesScreen() {
  const { state } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [anchor, setAnchor] = useState(dateKey());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("week");
  const [memberIds, setMemberIds] = useState(
    state.group.members.map((member) => member.id),
  );
  const badges = useMemo(() => buildBadges(state, anchor), [anchor, state]);
  const visible = badges.filter(
    (badge) =>
      (filter === "all" || badge.period === filter) &&
      (!badge.memberId || memberIds.includes(badge.memberId)),
  );
  const sections = filters
    .filter((item) => item.id !== "all")
    .map((item) => ({
      id: item.id,
      label: item.label,
      badges: visible.filter((badge) => badge.period === item.id),
    }))
    .filter((section) => section.badges.length);

  return (
    <Screen>
      <PageHeader
        eyebrow={state.group.name}
        title="Badge cabinet"
        subtitle="Awards adapt to every group tracker, target, and ranking rule."
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => router.back()}
          />
        }
      />
      <MetricSelector
        title="People"
        items={state.group.members.map((member) => ({
          id: member.id,
          label: memberDisplayName(state, member),
          icon: "person-outline",
          color: member.color,
        }))}
        selectedIds={memberIds}
        onChange={setMemberIds}
      />
      <View style={styles.filterRow}>
        {filters.map((item) => (
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
              Choose a different reference date
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
            <SectionHeader title={section.label} />
            <View style={styles.list}>
              {section.badges.map((badge) => {
                const member = badge.memberId
                  ? state.group.members.find(
                      (item) => item.id === badge.memberId,
                    )
                  : undefined;
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
                      style={[styles.badge, { borderLeftColor: badge.color }]}
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
                        <Text style={[styles.title, { color: colors.ink }]}>
                          {badge.title}
                        </Text>
                        <Text style={[styles.owner, { color: badge.color }]}>
                          {badge.owner} · {badge.caption}
                        </Text>
                        <Text
                          style={[styles.meta, { color: colors.muted }]}
                          numberOfLines={2}
                        >
                          {badge.description}
                        </Text>
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
            No matching badges
          </Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            Try another person, range, or date.
          </Text>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginVertical: 9,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingVertical: 10,
  },
  list: { gap: 7 },
  badge: {
    minHeight: 78,
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
  copy: { flex: 1 },
  title: { fontSize: 11, fontWeight: "900" },
  owner: { fontSize: 8, fontWeight: "900", marginTop: 2 },
  meta: { fontSize: 8, lineHeight: 12, marginTop: 2 },
  date: { fontSize: 7, fontWeight: "800" },
  empty: { alignItems: "center", gap: 6, padding: 24 },
});
