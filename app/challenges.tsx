import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { useGroupChallenges } from "@/src/cloud/useGroupChallenges";
import { usePublicChallenges } from "@/src/cloud/usePublicChallenges";
import { GroupChallengeEditor } from "@/src/components/GroupChallengeEditor";
import { HorizontalPager } from "@/src/components/HorizontalPager";
import {
  Card,
  IconButton,
  PageHeader,
  Screen,
} from "@/src/components/ui";
import { AppText as Text } from "@/src/components/AppText";
import { LocalizedAlert as Alert } from "@/src/i18n";
import {
  groupChallengeAvailability,
  groupChallengeEndDate,
  groupChallengeParticipation,
  groupChallengeSourceId,
} from "@/src/domain/groupChallenges";
import { dateKey, friendlyDate } from "@/src/domain/date";
import { formatMetricValue } from "@/src/domain/metrics";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import type { GroupChallenge } from "@/src/types";

type ChallengeTab = "current" | "past" | "public";
const TABS: { id: ChallengeTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: "current", label: "Current", icon: "flame-outline" },
  { id: "past", label: "Past", icon: "time-outline" },
  { id: "public", label: "Public", icon: "earth-outline" },
];

function viewerParticipation(challenge: GroupChallenge, userId: string) {
  return (
    challenge.viewerParticipation ??
    groupChallengeParticipation(challenge, userId)
  );
}

export default function ChallengesScreen() {
  const { state } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const params = useLocalSearchParams<{
    challengeId?: string;
    challengeOccurrenceDate?: string;
    challengeEvent?: string;
    challengeFocusAt?: string;
  }>();
  const requestedChallengeId = Array.isArray(params.challengeId)
    ? params.challengeId[0]
    : params.challengeId;
  const groupCloud = useGroupChallenges(state.group.id);
  const publicCloud = usePublicChallenges();
  const [tab, setTab] = useState<ChallengeTab>("current");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingChallenge, setEditingChallenge] = useState<GroupChallenge>();
  const [joiningId, setJoiningId] = useState<string>();
  const [highlightedId, setHighlightedId] = useState<string>();
  const highlight = useRef(new Animated.Value(0)).current;
  const screenScrollRef = useRef<ScrollView>(null);
  const pagerTopRef = useRef(0);
  const challengeOffsetsRef = useRef(new Map<string, number>());
  const handledFocusRef = useRef<string | undefined>(undefined);

  const metrics = useMemo(
    () =>
      (state.group.metricConfiguration ?? []).filter(
        (metric) =>
          metric.sections.group &&
          metric.dataType !== "text" &&
          metric.dataType !== "photo",
      ),
    [state.group.metricConfiguration],
  );
  const editorGroup = editingChallenge
    ? (state.groups.find((group) => group.id === editingChallenge.groupId) ??
      state.group)
    : state.group;
  const editorMetrics = useMemo(
    () =>
      (editorGroup.metricConfiguration ?? []).filter(
        (metric) =>
          metric.sections.group &&
          metric.dataType !== "text" &&
          metric.dataType !== "photo",
      ),
    [editorGroup.metricConfiguration],
  );
  const all = useMemo(() => {
    const byId = new Map<string, GroupChallenge>();
    for (const challenge of publicCloud.challenges)
      byId.set(groupChallengeSourceId(challenge), challenge);
    for (const challenge of publicCloud.joinedChallenges)
      byId.set(groupChallengeSourceId(challenge), challenge);
    // Prefer the participant-scoped row: it contains the authorized roster and
    // is the source used by the current group's Leaderboard.
    for (const challenge of groupCloud.challenges)
      byId.set(groupChallengeSourceId(challenge), challenge);
    return [...byId.values()];
  }, [
    groupCloud.challenges,
    publicCloud.challenges,
    publicCloud.joinedChallenges,
  ]);
  const today = dateKey();
  const current = useMemo(
    () =>
      all
        .filter((challenge) => {
          const participation = viewerParticipation(
            challenge,
            state.currentUserId,
          );
          return (
            groupChallengeAvailability(challenge, today) !== "finished" &&
            participation !== "not_invited" &&
            participation !== "declined"
          );
        })
        .sort(
          (left, right) =>
            left.localDate.localeCompare(right.localDate) ||
            left.createdAt.localeCompare(right.createdAt),
        ),
    [all, state.currentUserId, today],
  );
  const past = useMemo(
    () =>
      all
        .filter((challenge) => {
          const participation = viewerParticipation(
            challenge,
            state.currentUserId,
          );
          return (
            groupChallengeAvailability(challenge, today) === "finished" &&
            (participation === "creator" || participation === "accepted")
          );
        })
        .sort((left, right) =>
          groupChallengeEndDate(right).localeCompare(groupChallengeEndDate(left)),
        ),
    [all, state.currentUserId, today],
  );
  const publicChallenges = useMemo(
    () =>
      publicCloud.challenges
        .filter(
          (challenge) =>
            challenge.audience === "public" &&
            groupChallengeAvailability(challenge, today) !== "finished",
        )
        .sort(
          (left, right) =>
            left.localDate.localeCompare(right.localDate) ||
            left.createdAt.localeCompare(right.createdAt),
        ),
    [publicCloud.challenges, today],
  );

  useEffect(() => {
    if (!requestedChallengeId) return;
    const challenge = all.find(
      (item) =>
        item.id === requestedChallengeId ||
        groupChallengeSourceId(item) === requestedChallengeId,
    );
    if (!challenge) return;
    const focusKey = [
      requestedChallengeId,
      params.challengeOccurrenceDate ?? "",
      params.challengeEvent ?? "",
      params.challengeFocusAt ?? "",
    ].join("|");
    if (handledFocusRef.current === focusKey) return;
    handledFocusRef.current = focusKey;
    const participation = viewerParticipation(
      challenge,
      state.currentUserId,
    );
    const targetTab: ChallengeTab =
      groupChallengeAvailability(challenge, today) === "finished"
        ? "past"
        : challenge.audience === "public" &&
            participation === "not_invited"
          ? "public"
          : "current";
    setTab(targetTab);
    setHighlightedId(groupChallengeSourceId(challenge));
    highlight.setValue(0);
    const focusTimer = setTimeout(() => {
      const offset = challengeOffsetsRef.current.get(
        `${targetTab}:${groupChallengeSourceId(challenge)}`,
      );
      if (offset !== undefined)
        screenScrollRef.current?.scrollTo({
          y: Math.max(0, pagerTopRef.current + offset - 140),
          animated: true,
        });
      Animated.sequence([
        Animated.timing(highlight, {
          toValue: 1,
          duration: 350,
          useNativeDriver: false,
        }),
        Animated.timing(highlight, {
          toValue: 0,
          duration: 500,
          useNativeDriver: false,
        }),
      ]).start();
    }, 380);
    const timer = setTimeout(() => setHighlightedId(undefined), 4_500);
    return () => {
      clearTimeout(focusTimer);
      clearTimeout(timer);
    };
  }, [
    all,
    highlight,
    params.challengeEvent,
    params.challengeFocusAt,
    params.challengeOccurrenceDate,
    requestedChallengeId,
    state.currentUserId,
    today,
  ]);

  async function join(challenge: GroupChallenge) {
    const id = groupChallengeSourceId(challenge);
    if (joiningId) return;
    setJoiningId(id);
    try {
      await publicCloud.join(id);
      await groupCloud.refresh();
      setTab("current");
      setHighlightedId(id);
    } catch (reason) {
      Alert.alert(
        "Could not join challenge",
        reason instanceof Error ? reason.message : String(reason),
      );
    } finally {
      setJoiningId(undefined);
    }
  }

  async function answerGroupChallenge(
    challenge: GroupChallenge,
    response: "accepted" | "declined",
  ) {
    const id = groupChallengeSourceId(challenge);
    if (joiningId) return;
    setJoiningId(id);
    try {
      await groupCloud.respond(id, response);
      await publicCloud.refresh();
      setTab("current");
      setHighlightedId(response === "accepted" ? id : undefined);
    } catch (reason) {
      Alert.alert(
        "Could not answer challenge",
        reason instanceof Error ? reason.message : String(reason),
      );
    } finally {
      setJoiningId(undefined);
    }
  }

  function openEditor(challenge?: GroupChallenge) {
    setEditingChallenge(challenge);
    setEditorOpen(true);
  }

  function challengeList(
    items: GroupChallenge[],
    empty: string,
    listTab: ChallengeTab,
  ) {
    if (!items.length)
      return (
        <Card style={styles.empty}>
          <Ionicons name="trophy-outline" size={28} color={colors.faint} />
          <Text style={[styles.emptyTitle, { color: colors.ink }]}>{empty}</Text>
          <Text style={[styles.emptyDetail, { color: colors.muted }]}>
            Create a challenge or explore public competitions.
          </Text>
        </Card>
      );
    return (
      <View style={styles.list}>
        {items.map((challenge) => {
          const sourceId = groupChallengeSourceId(challenge);
          const metric = metrics.find((item) => item.id === challenge.metricId);
          const participation = viewerParticipation(
            challenge,
            state.currentUserId,
          );
          const joined =
            participation === "creator" || participation === "accepted";
          const canOpenLeaderboard =
            challenge.groupId === state.group.id ||
            state.groups.some((group) => group.id === challenge.groupId);
          const period =
            groupChallengeEndDate(challenge) === challenge.localDate
              ? friendlyDate(challenge.localDate)
              : `${friendlyDate(challenge.localDate)} – ${friendlyDate(
                  groupChallengeEndDate(challenge),
                )}`;
          const target =
            challenge.target === undefined
              ? "Highest total wins"
              : metric
                ? formatMetricValue(metric, challenge.target)
                : String(challenge.target);
          const highlighted = highlightedId === sourceId;
          return (
            <Animated.View
              key={sourceId}
              onLayout={(event) =>
                challengeOffsetsRef.current.set(
                  `${listTab}:${sourceId}`,
                  event.nativeEvent.layout.y,
                )
              }
              style={[
                highlighted && {
                  borderRadius: 18,
                  borderWidth: highlight.interpolate({
                    inputRange: [0, 1],
                    outputRange: [2, 4],
                  }),
                  borderColor: palette.amber,
                },
              ]}
            >
              <Card style={styles.challenge}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    if (!canOpenLeaderboard) return;
                    router.push({
                      pathname: "/group",
                      params: {
                        groupId: challenge.groupId,
                        challengeId: sourceId,
                        challengeOccurrenceDate:
                          params.challengeOccurrenceDate ??
                          challenge.localDate,
                        challengeEvent: "catalogue",
                        challengeFocusAt: String(Date.now()),
                      },
                    } as never);
                  }}
                  style={styles.challengeMain}
                >
                  <View
                    style={[
                      styles.challengeIcon,
                      { backgroundColor: `${accent}18` },
                    ]}
                  >
                    <Ionicons
                      name={
                        challenge.audience === "public"
                          ? "earth-outline"
                          : "trophy-outline"
                      }
                      size={20}
                      color={accent}
                    />
                  </View>
                  <View style={styles.challengeCopy}>
                    <Text
                      numberOfLines={1}
                      style={[styles.challengeTitle, { color: colors.ink }]}
                    >
                      {challenge.title?.trim() ||
                        `${metric?.name ?? challenge.metricId} challenge`}
                    </Text>
                    <Text
                      numberOfLines={2}
                      style={[styles.challengeMeta, { color: colors.muted }]}
                    >
                      {period} · {target}
                    </Text>
                    <Text style={[styles.challengeState, { color: accent }]}>
                      {joined
                        ? `${challenge.acceptedParticipantCount ??
                            challenge.acceptedParticipantIds?.length ??
                            1} joined`
                        : challenge.isFull
                          ? "Full"
                          : "Open to join"}
                      {challenge.participantLimit
                        ? ` · limit ${challenge.participantLimit}`
                        : challenge.audience === "public"
                          ? " · no limit"
                          : ""}
                    </Text>
                  </View>
                  {canOpenLeaderboard && joined ? (
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={colors.faint}
                    />
                  ) : null}
                </Pressable>
                <View style={styles.challengeActions}>
                  {challenge.creatorId === state.currentUserId &&
                  canOpenLeaderboard &&
                  groupChallengeAvailability(challenge, today) !==
                    "finished" ? (
                    <Pressable
                      onPress={() => openEditor(challenge)}
                      style={[
                        styles.action,
                        { borderColor: colors.border },
                      ]}
                    >
                      <Ionicons name="create-outline" size={15} color={accent} />
                      <Text style={[styles.actionText, { color: accent }]}>
                        Edit
                      </Text>
                    </Pressable>
                  ) : null}
                  {!joined &&
                  challenge.audience === "public" &&
                  challenge.eligibleToJoin !== false ? (
                    <Pressable
                      disabled={Boolean(joiningId)}
                      onPress={() => void join(challenge)}
                      style={[
                        styles.action,
                        {
                          borderColor: accent,
                          backgroundColor: colors.primarySoft,
                        },
                      ]}
                    >
                      <Ionicons
                        name="add-circle-outline"
                        size={15}
                        color={accent}
                      />
                      <Text style={[styles.actionText, { color: accent }]}>
                        {joiningId === sourceId ? "Joining…" : "Join"}
                      </Text>
                    </Pressable>
                  ) : null}
                  {participation === "invited" &&
                  challenge.audience !== "public" ? (
                    <>
                      <Pressable
                        disabled={Boolean(joiningId)}
                        onPress={() =>
                          void answerGroupChallenge(challenge, "declined")
                        }
                        style={[styles.action, { borderColor: colors.border }]}
                      >
                        <Text
                          style={[styles.actionText, { color: colors.muted }]}
                        >
                          Decline
                        </Text>
                      </Pressable>
                      <Pressable
                        disabled={Boolean(joiningId)}
                        onPress={() =>
                          void answerGroupChallenge(challenge, "accepted")
                        }
                        style={[
                          styles.action,
                          {
                            borderColor: accent,
                            backgroundColor: colors.primarySoft,
                          },
                        ]}
                      >
                        <Text
                          style={[styles.actionText, { color: accent }]}
                        >
                          {joiningId === sourceId ? "Saving…" : "Accept"}
                        </Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              </Card>
            </Animated.View>
          );
        })}
      </View>
    );
  }

  const requestedPage = TABS.findIndex((item) => item.id === tab);
  return (
    <Screen scrollRef={screenScrollRef} contentContainerStyle={styles.screen}>
      <PageHeader
        eyebrow="COMPETE TOGETHER"
        title="Challenges"
        subtitle="Join, create and revisit your competitions."
        showMenu={false}
        action={
          <View style={styles.headerActions}>
            <IconButton
              icon="add"
              label="Create challenge"
              onPress={() => openEditor()}
            />
            <IconButton
              icon="close"
              label="Close challenges"
              onPress={() => router.back()}
            />
          </View>
        }
      />
      <View style={[styles.tabs, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {TABS.map((item) => {
          const selected = tab === item.id;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setTab(item.id)}
              style={[
                styles.tab,
                selected && { backgroundColor: colors.primarySoft },
              ]}
            >
              <Ionicons
                name={item.icon}
                size={15}
                color={selected ? accent : colors.faint}
              />
              <Text
                style={[
                  styles.tabText,
                  { color: selected ? accent : colors.muted },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {publicCloud.error || groupCloud.error ? (
        <Pressable
          onPress={() => {
            void publicCloud.refresh();
            void groupCloud.refresh();
          }}
          style={[styles.retry, { borderColor: colors.border }]}
        >
          <Ionicons name="refresh" size={15} color={accent} />
          <Text style={[styles.retryText, { color: colors.muted }]}>
            Some challenges could not refresh. Tap to retry.
          </Text>
        </Pressable>
      ) : null}
      <View
        onLayout={(event) => {
          pagerTopRef.current = event.nativeEvent.layout.y;
        }}
      >
        <HorizontalPager
          accessibilityLabel="Challenge sections"
          pages={[
            challengeList(current, "No current challenges", "current"),
            challengeList(past, "No completed challenges yet", "past"),
            challengeList(publicChallenges, "No public challenges yet", "public"),
          ]}
          requestedPage={requestedPage}
          onPageChange={(index) => {
            const next = TABS[index]?.id;
            if (next && next !== tab) setTab(next);
          }}
          showPageDots={false}
          webNaturalHeight
        />
      </View>
      <GroupChallengeEditor
        visible={editorOpen}
        group={editorGroup}
        metrics={editorMetrics}
        currentUserId={state.currentUserId}
        initialDate={dateKey()}
        challenge={editingChallenge}
        onClose={() => {
          setEditorOpen(false);
          setEditingChallenge(undefined);
        }}
        onSave={async (input) => {
          await groupCloud.save(input);
          await publicCloud.refresh();
          await groupCloud.refresh();
          setTab("current");
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingBottom: 22 },
  headerActions: { flexDirection: "row", gap: 5 },
  tabs: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 16,
    padding: 4,
    flexDirection: "row",
    marginBottom: 10,
  },
  tab: {
    flex: 1,
    minHeight: 38,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  tabText: { fontSize: 9, fontWeight: "900" },
  list: { gap: 8, paddingBottom: 8 },
  challenge: { padding: 9 },
  challengeMain: { flexDirection: "row", alignItems: "center", gap: 9 },
  challengeIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  challengeCopy: { flex: 1, minWidth: 0 },
  challengeTitle: { fontSize: 13, fontWeight: "900" },
  challengeMeta: { marginTop: 2, fontSize: 8, lineHeight: 12, fontWeight: "700" },
  challengeState: { marginTop: 4, fontSize: 8, fontWeight: "900" },
  challengeActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 7,
    marginTop: 8,
  },
  action: {
    minHeight: 34,
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  actionText: { fontSize: 8, fontWeight: "900" },
  empty: {
    minHeight: 190,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  emptyTitle: { marginTop: 10, fontSize: 14, fontWeight: "900" },
  emptyDetail: {
    marginTop: 5,
    maxWidth: 270,
    textAlign: "center",
    fontSize: 9,
    lineHeight: 14,
  },
  retry: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 8,
  },
  retryText: { flex: 1, fontSize: 9, fontWeight: "800" },
});
