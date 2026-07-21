import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Sharing from "expo-sharing";
import ViewShot from "react-native-view-shot";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { MetricSelector } from "@/src/components/MetricSelector";
import { ExpandableImage } from "@/src/components/ExpandableImage";
import {
  Avatar,
  Button,
  Card,
  Chip,
  IconButton,
  PageHeader,
  ProgressBar,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import { buildBadges } from "@/src/domain/badges";
import {
  comparisonStats,
  metricHeadToHeadStats,
} from "@/src/domain/comparison";
import {
  dateKey,
  dateRangeEnding,
  dateWithOffsetFrom,
  friendlyDate,
} from "@/src/domain/date";
import {
  averageAtDate,
  LeaderboardPeriod,
  periodDates,
  periodMetricResult,
  periodTitle,
} from "@/src/domain/leaderboard";
import {
  memberDisplayName,
  memberOriginalLabel,
  memberRoleLabel,
} from "@/src/domain/members";
import { formatMetricValue, goalProgress } from "@/src/domain/metrics";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors } from "@/src/theme";

export default function MemberProfile() {
  const params = useLocalSearchParams<{
    id: string;
    period?: string;
    anchor?: string;
    metrics?: string;
  }>();
  const { state, updateSettings } = useApp();
  const colors = useAppColors();
  const member =
    state.group.members.find((item) => item.id === params.id) ??
    state.group.members[0];
  const available = (state.group.metricConfiguration ?? []).filter(
    (metric) =>
      metric.dataType !== "text" &&
      metric.dataType !== "photo" &&
      metric.sections.insights,
  );
  const paramIds = (params.metrics ?? "")
    .split(",")
    .filter((id) => id && id !== "__score");
  const initial = paramIds.filter((id) =>
    available.some((metric) => metric.id === id),
  );
  const [metricIds, setMetricIds] = useState<string[]>(
    initial.length ? initial : ([available[0]?.id].filter(Boolean) as string[]),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(
    member.id === state.currentUserId
      ? [state.currentUserId]
      : [state.currentUserId, member.id],
  );
  const [period, setPeriod] = useState<LeaderboardPeriod>(
    (params.period as LeaderboardPeriod) || "week",
  );
  const [anchor, setAnchor] = useState(params.anchor || dateKey());
  const dates = useMemo(() => periodDates(period, anchor), [anchor, period]);
  const metrics = available.filter((metric) => metricIds.includes(metric.id));
  const people = selectedIds
    .map((id) => state.group.members.find((item) => item.id === id))
    .filter(Boolean) as typeof state.group.members;
  const stats = useMemo(
    () =>
      comparisonStats(
        state,
        member.id,
        state.currentUserId,
        dates,
        metrics.slice(0, 1),
      ),
    [dates, member.id, metrics, state],
  );
  const headToHeads = useMemo(
    () =>
      metrics
        .map((metric) => ({
          metric,
          stats: metricHeadToHeadStats(
            state,
            metric,
            member.id,
            state.currentUserId,
            dates,
          ),
        }))
        .filter((item) => item.stats),
    [dates, member.id, metrics, state],
  );
  const periodBadge =
    period === "week" ? "week" : period === "month" ? "month" : "today";
  const badges = useMemo(
    () =>
      buildBadges(state, anchor).filter(
        (badge) => badge.memberId === member.id && badge.period === periodBadge,
      ),
    [anchor, member.id, periodBadge, state],
  );
  const showcase = state.settings.badgeShowcaseByGroup[state.group.id] ?? [];
  const displayedBadges = [...badges]
    .sort(
      (a, b) =>
        (showcase.includes(a.id) ? 0 : 1) - (showcase.includes(b.id) ? 0 : 1),
    )
    .slice(0, 5);
  function shift(days: number) {
    const next = dateWithOffsetFrom(anchor, days);
    if (next <= dateKey()) {
      if (period === "today" || period === "yesterday") setPeriod("custom");
      setAnchor(next);
    }
  }
  return (
    <Screen>
      <PageHeader
        eyebrow="Friend comparison"
        title={
          member.id === state.currentUserId
            ? "Your progress"
            : memberDisplayName(state, member)
        }
        subtitle={`${periodTitle(period, anchor)} · compare shared values side by side`}
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => router.back()}
          />
        }
      />
      <Card style={styles.profile}>
        <Avatar
          initials={member.initials}
          color={member.color}
          uri={member.avatarUri}
          size={58}
        />
        <View style={styles.copy}>
          <Text style={[styles.name, { color: colors.ink }]}>
            {memberDisplayName(state, member)}
          </Text>
          {memberOriginalLabel(state, member) ? (
            <Text style={[styles.original, { color: colors.faint }]}>
              {memberOriginalLabel(state, member)}
            </Text>
          ) : null}
          <Text style={[styles.meta, { color: colors.muted }]}>
            {memberRoleLabel(member)} · {state.group.name}
          </Text>
        </View>
        <Ionicons
          name="shield-checkmark-outline"
          size={22}
          color={palette.primary}
        />
      </Card>
      <SectionHeader title="Date range" />
      <View style={styles.chips}>
        <Chip
          label="Today"
          selected={period === "today"}
          onPress={() => {
            setPeriod("today");
            setAnchor(dateKey());
          }}
        />
        <Chip
          label="Yesterday"
          selected={period === "yesterday"}
          onPress={() => {
            setPeriod("yesterday");
            setAnchor(dateWithOffsetFrom(dateKey(), -1));
          }}
        />
        <Chip
          label="7 days"
          selected={period === "week"}
          onPress={() => setPeriod("week")}
        />
        <Chip
          label="Month"
          selected={period === "month"}
          onPress={() => setPeriod("month")}
        />
      </View>
      <Card style={styles.navigator}>
        <IconButton
          icon="chevron-back"
          label="Previous"
          onPress={() =>
            shift(period === "week" ? -7 : period === "month" ? -30 : -1)
          }
        />
        <View style={styles.navCopy}>
          <Text style={[styles.navTitle, { color: colors.ink }]}>
            {periodTitle(period, anchor)}
          </Text>
          <Text style={[styles.navSub, { color: colors.muted }]}>
            {dates.length > 1
              ? `${friendlyDate(dates[0])} – ${friendlyDate(dates[dates.length - 1])}`
              : friendlyDate(anchor)}
          </Text>
        </View>
        <IconButton
          icon="chevron-forward"
          label="Next"
          onPress={() =>
            shift(period === "week" ? 7 : period === "month" ? 30 : 1)
          }
        />
      </Card>
      <SectionHeader title="Comparison filters" />
      <View style={styles.selectors}>
        <MetricSelector
          title="What to show"
          items={available.map((metric) => ({
            id: metric.id,
            label: metric.name,
            icon: metric.icon as keyof typeof Ionicons.glyphMap,
            color: metric.color,
          }))}
          selectedIds={metricIds}
          onChange={setMetricIds}
        />
        <MetricSelector
          title="People on chart"
          items={state.group.members.map((person) => ({
            id: person.id,
            label:
              person.id === state.currentUserId
                ? "You"
                : memberDisplayName(state, person),
            icon: "person-outline",
            color: person.color,
          }))}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
        />
      </View>
      {member.id === state.currentUserId ? (
        <>
          <SectionHeader title="Your competitive stats" />
          <View style={styles.comparisonStats}>
            <StatCard
              icon="sparkles-outline"
              label="Best day"
              value={stats.bestDay}
              detail={`${Math.round(stats.bestScore)} pts`}
            />
            <StatCard
              icon="medal-outline"
              label="Days ranked #1"
              value={`${stats.daysWon}/${stats.eligibleDays}`}
              detail={periodTitle(period, anchor)}
            />
            <StatCard
              icon="flame-outline"
              label="Longest win streak"
              value={`${stats.longestWinStreak} day${stats.longestWinStreak === 1 ? "" : "s"}`}
              detail="Within this range"
            />
          </View>
        </>
      ) : headToHeads.length ? (
        <>
          <SectionHeader title="Head-to-head vs you" />
          {headToHeads.map(({ metric, stats: duel }) =>
            duel ? (
              <Card key={metric.id} style={styles.duel}>
                <View style={styles.duelHeading}>
                  <View
                    style={[
                      styles.metricMark,
                      { backgroundColor: `${metric.color}18` },
                    ]}
                  >
                    <Ionicons
                      name={metric.icon as keyof typeof Ionicons.glyphMap}
                      size={19}
                      color={metric.color}
                    />
                  </View>
                  <View style={styles.copy}>
                    <Text style={styles.duelTitle}>{metric.name}</Text>
                    <Text style={styles.duelMeta}>
                      {duel.eligibleDays} comparable day
                      {duel.eligibleDays === 1 ? "" : "s"} · higher wins
                    </Text>
                  </View>
                </View>
                <View style={styles.duelGrid}>
                  <DuelStat
                    label="Best day"
                    you={`${formatMetricValue(metric, duel.viewerBest.value)} · ${friendlyDate(duel.viewerBest.date)}`}
                    friend={`${formatMetricValue(metric, duel.subjectBest.value)} · ${friendlyDate(duel.subjectBest.date)}`}
                    friendName={memberDisplayName(state, member)}
                  />
                  <DuelStat
                    label="Days won"
                    you={`${duel.viewerWins}`}
                    friend={`${duel.subjectWins}`}
                    friendName={memberDisplayName(state, member)}
                    detail={duel.ties ? `${duel.ties} tied` : undefined}
                  />
                  <DuelStat
                    label="Longest win streak"
                    you={`${duel.viewerLongestStreak} day${duel.viewerLongestStreak === 1 ? "" : "s"}`}
                    friend={`${duel.subjectLongestStreak} day${duel.subjectLongestStreak === 1 ? "" : "s"}`}
                    friendName={memberDisplayName(state, member)}
                  />
                </View>
              </Card>
            ) : null,
          )}
        </>
      ) : (
        <Card style={styles.headEmpty}>
          <Ionicons
            name="analytics-outline"
            size={20}
            color={palette.primary}
          />
          <Text style={styles.emptyPhotos}>
            Head-to-head stats appear for selected “higher wins” metrics with
            shared daily data. Goal-distance metrics such as food and deficit
            are intentionally excluded.
          </Text>
        </Card>
      )}
      <View style={styles.metricCards}>
        {metrics.map((metric) => (
          <Card key={metric.id} style={styles.chartCard}>
            <View style={styles.chartHeading}>
              <View>
                <Text style={styles.chartEyebrow}>
                  {periodTitle(period, anchor).toUpperCase()}
                </Text>
                <Text style={styles.chartTitle}>{metric.name}</Text>
              </View>
              <View
                style={[
                  styles.metricMark,
                  { backgroundColor: `${metric.color}18` },
                ]}
              >
                <Ionicons
                  name={metric.icon as keyof typeof Ionicons.glyphMap}
                  size={21}
                  color={metric.color}
                />
              </View>
            </View>
            <View style={styles.bars}>
              {people.map((person) => {
                const result = periodMetricResult(
                  state,
                  metric,
                  person.id,
                  state.currentUserId,
                  dates,
                );
                return (
                  <View key={person.id} style={styles.personBlock}>
                    <View style={styles.barRow}>
                      <Avatar
                        initials={person.initials}
                        color={person.color}
                        uri={person.avatarUri}
                        size={34}
                      />
                      <View style={styles.barCopy}>
                        <View style={styles.labels}>
                          <Text style={styles.barName}>
                            {person.id === state.currentUserId
                              ? "You"
                              : memberDisplayName(state, person)}
                          </Text>
                          <Text
                            style={[
                              styles.barValue,
                              result.mode === "private" && styles.private,
                            ]}
                          >
                            {result.label}
                          </Text>
                        </View>
                        <ProgressBar
                          progress={
                            result.mode === "private"
                              ? 0
                              : Math.min(
                                  goalProgress(metric, result.average),
                                  1,
                                )
                          }
                          color={person.color}
                        />
                      </View>
                    </View>
                    <View style={styles.stats}>
                      <MiniStat
                        label="Range avg"
                        value={
                          result.mode === "private"
                            ? "Private"
                            : metric.dataType === "boolean"
                              ? (result.averageLabel ?? "—")
                              : result.average.toLocaleString(undefined, {
                                  maximumFractionDigits: 1,
                                })
                        }
                      />
                      <MiniStat
                        label="7-day avg"
                        value={statValue(
                          averageAtDate(
                            state,
                            metric,
                            person.id,
                            state.currentUserId,
                            anchor,
                            7,
                          ),
                        )}
                      />
                      <MiniStat
                        label="30-day avg"
                        value={statValue(
                          averageAtDate(
                            state,
                            metric,
                            person.id,
                            state.currentUserId,
                            anchor,
                            30,
                          ),
                        )}
                      />
                      <MiniStat
                        label="Overall avg"
                        value={statValue(
                          periodMetricResult(
                            state,
                            metric,
                            person.id,
                            state.currentUserId,
                            overallDates(metric.activeFrom, anchor),
                          ),
                        )}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          </Card>
        ))}
      </View>
      {displayedBadges.length ? (
        <>
          <SectionHeader
            title={`${memberDisplayName(state, member)}'s badge showcase`}
            action={
              <Pressable onPress={() => router.push("/badges" as never)}>
                <Text style={styles.badgeLink}>All badges</Text>
              </Pressable>
            }
          />
          {member.id === state.currentUserId ? (
            <MetricSelector
              title="Choose up to 5 showcase badges"
              items={buildBadges(state, anchor)
                .filter((badge) => badge.memberId === member.id)
                .map((badge) => ({
                  id: badge.id,
                  label: badge.title,
                  icon: badge.icon,
                  color: badge.color,
                  sublabel: badge.caption,
                }))}
              selectedIds={
                showcase.length
                  ? showcase
                  : displayedBadges.map((badge) => badge.id)
              }
              onChange={(ids) => {
                if (ids.length <= 5)
                  updateSettings({
                    badgeShowcaseByGroup: {
                      ...state.settings.badgeShowcaseByGroup,
                      [state.group.id]: ids,
                    },
                  });
              }}
            />
          ) : null}
          <Card>
            <View style={styles.badgeList}>
              {displayedBadges.map((badge) => (
                <View
                  key={badge.id}
                  style={[styles.badge, { borderLeftColor: badge.color }]}
                >
                  <View
                    style={[
                      styles.badgeIcon,
                      { backgroundColor: `${badge.color}20` },
                    ]}
                  >
                    <Ionicons name={badge.icon} size={18} color={badge.color} />
                  </View>
                  <View style={styles.copy}>
                    <Text style={styles.badgeTitle}>{badge.title}</Text>
                    <Text style={styles.badgeCaption}>
                      {badge.caption} · {badge.description}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </Card>
        </>
      ) : null}
      <SectionHeader title="Shared photo comparison" />
      <Card>
        {people.map((person) => (
          <ProfilePhotoCompare
            key={person.id}
            state={state}
            personId={person.id}
            dates={dates}
          />
        ))}
      </Card>
      <Card style={styles.privacy}>
        <Ionicons
          name="lock-closed-outline"
          size={19}
          color={palette.primary}
        />
        <Text style={styles.privacyText}>
          Private values and photos never enter this comparison. Goal-status
          sharing can show completion without revealing the underlying number.
        </Text>
      </Card>
    </Screen>
  );
}
function overallDates(activeFrom: string, anchor: string) {
  const days = Math.max(
    1,
    Math.floor(
      (new Date(`${anchor}T12:00:00`).getTime() -
        new Date(`${activeFrom}T12:00:00`).getTime()) /
        86400000,
    ) + 1,
  );
  return dateRangeEnding(anchor, Math.min(days, 730));
}
function statValue(result: ReturnType<typeof periodMetricResult>) {
  if (result.mode === "private") return "Private";
  if (result.mode === "status") return result.label;
  return result.average.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}
function StatCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card style={styles.comparisonCard}>
      <Ionicons name={icon} size={19} color={palette.primary} />
      <Text style={styles.comparisonValue}>{value}</Text>
      <Text style={styles.comparisonLabel}>{label}</Text>
      <Text style={styles.comparisonDetail}>{detail}</Text>
    </Card>
  );
}
function DuelStat({
  label,
  you,
  friend,
  friendName,
  detail,
}: {
  label: string;
  you: string;
  friend: string;
  friendName: string;
  detail?: string;
}) {
  return (
    <View style={styles.duelStat}>
      <Text style={styles.duelLabel}>{label}</Text>
      <View style={styles.duelSide}>
        <Text style={styles.duelPerson}>You</Text>
        <Text style={styles.duelValue}>{you}</Text>
      </View>
      <View style={styles.duelSide}>
        <Text style={styles.duelPerson}>{friendName}</Text>
        <Text style={styles.duelValue}>{friend}</Text>
      </View>
      {detail ? <Text style={styles.duelDetail}>{detail}</Text> : null}
    </View>
  );
}
function ProfilePhotoCompare({
  state,
  personId,
  dates,
}: {
  state: ReturnType<typeof useApp>["state"];
  personId: string;
  dates: string[];
}) {
  const person = state.group.members.find((item) => item.id === personId)!;
  const visible = state.photos
    .filter(
      (photo) =>
        photo.userId === personId &&
        (personId === state.currentUserId || photo.visibility === "group"),
    )
    .sort((a, b) => b.localDate.localeCompare(a.localDate));
  const primary = visible.find((photo) => dates.includes(photo.localDate));
  const older = primary
    ? visible.filter((photo) => photo.localDate < primary.localDate)
    : [];
  const primaryId = primary?.id ?? "";
  const defaultOlderId = older[0]?.id ?? "";
  const [olderId, setOlderId] = useState<string[]>([]);
  useEffect(
    () => setOlderId(defaultOlderId ? [defaultOlderId] : []),
    [primaryId, defaultOlderId],
  );
  const comparison = older.find((photo) => photo.id === olderId[0]);
  const collageRef = useRef<ViewShot>(null);
  function weight(day: string) {
    const entry = state.entries
      .filter(
        (item) =>
          item.userId === personId &&
          item.metricId === "weight" &&
          (personId === state.currentUserId || item.visibility === "group"),
      )
      .sort(
        (a, b) =>
          Math.abs(
            new Date(`${a.localDate}T12:00:00`).getTime() -
              new Date(`${day}T12:00:00`).getTime(),
          ) -
          Math.abs(
            new Date(`${b.localDate}T12:00:00`).getTime() -
              new Date(`${day}T12:00:00`).getTime(),
          ),
      )[0];
    return entry ? `${Number(entry.value).toFixed(1)} kg` : "No weight log";
  }
  async function save() {
    const uri = await collageRef.current?.capture?.();
    if (uri)
      await Sharing.shareAsync(uri, {
        mimeType: "image/png",
        dialogTitle: "Save or share progress comparison",
      });
  }
  return (
    <View style={styles.photoPerson}>
      <Text style={styles.photoName}>
        {personId === state.currentUserId
          ? "You"
          : memberDisplayName(state, person)}
      </Text>
      {primary ? (
        <>
          <ViewShot
            ref={collageRef}
            options={{ format: "png", quality: 1 }}
            style={styles.photoCapture}
          >
            <Text style={styles.captureTitle}>North progress comparison</Text>
            <View style={styles.photos}>
              <View style={styles.photoBlock}>
                <ExpandableImage
                  uri={primary.uri}
                  thumbnailStyle={styles.photo}
                />
                <Text style={styles.photoDate}>
                  {friendlyDate(primary.localDate)}
                </Text>
                <Text style={styles.photoDate}>
                  {weight(primary.localDate)}
                </Text>
              </View>
              {comparison ? (
                <View style={styles.photoBlock}>
                  <ExpandableImage
                    uri={comparison.uri}
                    thumbnailStyle={styles.photo}
                  />
                  <Text style={styles.photoDate}>
                    {friendlyDate(comparison.localDate)}
                  </Text>
                  <Text style={styles.photoDate}>
                    {weight(comparison.localDate)}
                  </Text>
                </View>
              ) : null}
            </View>
          </ViewShot>
          {comparison ? (
            <Button
              label="Save or share collage"
              icon="download-outline"
              variant="ghost"
              onPress={save}
            />
          ) : null}
          {older.length ? (
            <MetricSelector
              title="Older comparison photo"
              multiple={false}
              items={older.map((photo) => ({
                id: photo.id,
                label: friendlyDate(photo.localDate),
                icon: "image-outline",
                color: person.color,
              }))}
              selectedIds={olderId}
              onChange={setOlderId}
            />
          ) : (
            <Text style={styles.emptyPhotos}>
              No older photo is available yet.
            </Text>
          )}
        </>
      ) : (
        <Text style={styles.emptyPhotos}>No shared photo in this range.</Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  photoCapture: {
    backgroundColor: "#F5F7F2",
    padding: 9,
    borderRadius: 12,
    marginBottom: 8,
  },
  captureTitle: {
    color: "#17211B",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 7,
  },
  profile: { flexDirection: "row", alignItems: "center", gap: 12 },
  copy: { flex: 1 },
  name: { color: palette.ink, fontSize: 18, fontWeight: "900" },
  original: { color: palette.faint, fontSize: 9, marginTop: 2 },
  meta: { color: palette.muted, fontSize: 11, marginTop: 3 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  selectors: { gap: 8 },
  navigator: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 8,
    marginTop: 10,
  },
  navCopy: { alignItems: "center", flex: 1 },
  navTitle: { color: palette.ink, fontSize: 14, fontWeight: "900" },
  navSub: { color: palette.muted, fontSize: 9, marginTop: 2 },
  comparisonStats: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  comparisonCard: { flex: 1, minWidth: 105, padding: 12 },
  comparisonValue: {
    color: palette.ink,
    fontSize: 17,
    fontWeight: "900",
    marginTop: 7,
  },
  comparisonLabel: {
    color: palette.muted,
    fontSize: 8,
    fontWeight: "900",
    marginTop: 2,
  },
  comparisonDetail: { color: palette.faint, fontSize: 7, marginTop: 3 },
  duel: { marginBottom: 9 },
  duelHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginBottom: 11,
  },
  duelTitle: { color: palette.ink, fontSize: 15, fontWeight: "900" },
  duelMeta: { color: palette.muted, fontSize: 8, marginTop: 2 },
  duelGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  duelStat: {
    flex: 1,
    minWidth: 155,
    backgroundColor: palette.canvas,
    borderRadius: 12,
    padding: 10,
  },
  duelLabel: {
    color: palette.primary,
    fontSize: 8,
    fontWeight: "900",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  duelSide: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 7,
    paddingVertical: 3,
  },
  duelPerson: {
    color: palette.muted,
    fontSize: 8,
    fontWeight: "800",
    maxWidth: "36%",
  },
  duelValue: {
    flex: 1,
    color: palette.ink,
    fontSize: 9,
    fontWeight: "900",
    textAlign: "right",
  },
  duelDetail: {
    color: palette.faint,
    fontSize: 7,
    textAlign: "right",
    marginTop: 3,
  },
  headEmpty: { flexDirection: "row", alignItems: "center", gap: 9 },
  metricCards: { gap: 12, marginTop: 18 },
  chartCard: { padding: 15 },
  chartHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  chartEyebrow: {
    color: palette.primary,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  chartTitle: {
    color: palette.ink,
    fontSize: 21,
    fontWeight: "900",
    marginTop: 3,
  },
  metricMark: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  bars: { gap: 18, marginTop: 18 },
  personBlock: { gap: 10 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  barCopy: { flex: 1 },
  labels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 7,
  },
  barName: { color: palette.ink, fontSize: 12, fontWeight: "800" },
  barValue: { color: palette.muted, fontSize: 11, fontWeight: "800" },
  private: { color: palette.faint, fontStyle: "italic" },
  stats: { flexDirection: "row", gap: 5, marginLeft: 44 },
  stat: {
    flex: 1,
    backgroundColor: palette.canvas,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 5,
  },
  statValue: {
    color: palette.ink,
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
  },
  statLabel: {
    color: palette.muted,
    fontSize: 7,
    textAlign: "center",
    marginTop: 2,
  },
  badgeLink: { color: palette.primary, fontSize: 10, fontWeight: "900" },
  badgeList: { gap: 7 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderLeftWidth: 3,
    paddingLeft: 8,
  },
  badgeIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeTitle: { color: palette.ink, fontSize: 11, fontWeight: "900" },
  badgeCaption: {
    color: palette.muted,
    fontSize: 8,
    lineHeight: 12,
    marginTop: 2,
  },
  photoPerson: { paddingVertical: 9, gap: 7 },
  photoName: { color: palette.ink, fontSize: 11, fontWeight: "900" },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photoBlock: { width: 128 },
  photo: { width: 128, height: 150, borderRadius: 13 },
  photoDate: {
    color: palette.muted,
    fontSize: 8,
    textAlign: "center",
    marginTop: 3,
  },
  emptyPhotos: { color: palette.muted, fontSize: 10, fontStyle: "italic" },
  privacy: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    backgroundColor: palette.primarySoft,
    borderColor: "#C9E7D5",
    marginTop: 18,
  },
  privacyText: {
    flex: 1,
    color: palette.primary,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "700",
  },
});
