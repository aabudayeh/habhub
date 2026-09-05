import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { useGroupChallenges } from "@/src/cloud/useGroupChallenges";
import { usePublicChallenges } from "@/src/cloud/usePublicChallenges";
import { useChallengePreferences } from "@/src/cloud/useChallengePreferences";
import {
  type ChallengeStanding,
  type ChallengeViewerStanding,
  loadChallengeViewerStandings,
  loadChallengeStandings,
} from "@/src/cloud/groupChallenges";
import { GroupChallengeEditor } from "@/src/components/GroupChallengeEditor";
import { ChallengeVisual } from "@/src/components/ChallengeVisual";
import { HorizontalPager } from "@/src/components/HorizontalPager";
import {
  Card,
  IconButton,
  PageHeader,
  Screen,
} from "@/src/components/ui";
import { AppText as Text } from "@/src/components/AppText";
import { LocalizedAlert as Alert, useTranslation } from "@/src/i18n";
import {
  canManageGroupChallenge,
  challengeSettlementKey,
  expandGroupChallengeOccurrences,
  groupChallengeAvailability,
  groupChallengeEndDate,
  groupChallengeParticipation,
  groupChallengeProgress,
  groupChallengeSourceId,
} from "@/src/domain/groupChallenges";
import {
  dateKey,
  dateWithOffsetFrom,
  friendlyDate,
} from "@/src/domain/date";
import { memberDisplayName } from "@/src/domain/members";
import { formatMetricValue } from "@/src/domain/metrics";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import type { GroupChallenge } from "@/src/types";
import { DEFAULT_DEMO_GROUP_ID } from "@/src/data/demoChallenges";

type ChallengeTab = "current" | "past" | "public";
const TABS: { id: ChallengeTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: "current", label: "Current", icon: "flame-outline" },
  { id: "past", label: "Past", icon: "time-outline" },
  { id: "public", label: "Public", icon: "earth-outline" },
];
const RECENT_PAST_OCCURRENCE_LIMIT = 200;

function viewerParticipation(challenge: GroupChallenge, userId: string) {
  return (
    challenge.viewerParticipation ??
    groupChallengeParticipation(challenge, userId)
  );
}

function occurrenceKey(challenge: GroupChallenge) {
  return challengeSettlementKey(
    groupChallengeSourceId(challenge),
    challenge.localDate,
  );
}

/** One actionable occurrence per live recurring series. Historical occurrences
 * are rendered separately in Past, rather than making the series card point at
 * the anchor day's stale result. */
function currentChallengeOccurrence(
  challenge: GroupChallenge,
  today: string,
) {
  if (!challenge.recurrence || challenge.recurrence.mode === "once")
    return challenge;
  const throughDate = challenge.recurrence.endDate ?? today;
  const occurrences = expandGroupChallengeOccurrences(
    [challenge],
    today,
    throughDate,
    500,
  );
  return occurrences.at(-1);
}

export default function ChallengesScreen() {
  const { state } = useApp();
  const localDemo = state.group.id === DEFAULT_DEMO_GROUP_ID;
  const t = useTranslation();
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
  const requestedOccurrenceDate = Array.isArray(params.challengeOccurrenceDate)
    ? params.challengeOccurrenceDate[0]
    : params.challengeOccurrenceDate;
  const groupCloud = useGroupChallenges(state.group.id);
  const groupDiscovery = useGroupChallenges(state.group.id, {
    discoverActive: true,
  });
  const publicCloud = usePublicChallenges(!localDemo);
  const challengePreferences = useChallengePreferences();
  const [tab, setTab] = useState<ChallengeTab>("current");
  const [editingMode, setEditingMode] = useState(false);
  const [expandedId, setExpandedId] = useState<string>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingChallenge, setEditingChallenge] = useState<GroupChallenge>();
  const [joiningId, setJoiningId] = useState<string>();
  const [viewerStandings, setViewerStandings] = useState(
    new Map<string, ChallengeViewerStanding>(),
  );
  const [challengeStandings, setChallengeStandings] = useState(
    new Map<string, ChallengeStanding[]>(),
  );
  const [highlightedId, setHighlightedId] = useState<string>();
  const highlight = useRef(new Animated.Value(0)).current;
  const wiggle = useRef(new Animated.Value(0)).current;
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
    // Active group discovery is intentionally metadata-only. Participant-
    // scoped rows below replace it when the viewer has joined, preserving the
    // authorized roster needed for local/offline standings.
    for (const challenge of groupDiscovery.challenges)
      byId.set(groupChallengeSourceId(challenge), challenge);
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
    groupDiscovery.challenges,
    groupCloud.challenges,
    publicCloud.challenges,
    publicCloud.joinedChallenges,
  ]);
  const availableChallenges = useMemo(
    () =>
      all.filter(
        (challenge) =>
          !challengePreferences.preferences.get(
            groupChallengeSourceId(challenge),
          )?.withdrawnAt,
      ),
    [all, challengePreferences.preferences],
  );
  const today = dateKey();
  const requestedOccurrence = useMemo(() => {
    if (!requestedChallengeId || !requestedOccurrenceDate) return undefined;
    const source = all.find(
      (challenge) =>
        challenge.id === requestedChallengeId ||
        groupChallengeSourceId(challenge) === requestedChallengeId,
    );
    if (!source) return undefined;
    return expandGroupChallengeOccurrences(
      [source],
      requestedOccurrenceDate,
      requestedOccurrenceDate,
      1,
    )[0];
  }, [all, requestedChallengeId, requestedOccurrenceDate]);
  const current = useMemo(
    () => {
      const rows = availableChallenges.flatMap((challenge) => {
          const participation = viewerParticipation(
            challenge,
            state.currentUserId,
          );
          if (
            groupChallengeAvailability(challenge, today) === "finished" ||
            participation === "declined" ||
            (participation === "not_invited" &&
              (challenge.audience === "public" ||
                challenge.eligibleToJoin === false))
          )
            return [];
          const occurrence = currentChallengeOccurrence(challenge, today);
          return occurrence ? [occurrence] : [];
        });
      if (
        requestedOccurrence &&
        groupChallengeEndDate(requestedOccurrence) >= today &&
        !rows.some((challenge) =>
          occurrenceKey(challenge) === occurrenceKey(requestedOccurrence),
        )
      )
        rows.push(requestedOccurrence);
      return rows.sort(
          (left, right) =>
            left.localDate.localeCompare(right.localDate) ||
            left.createdAt.localeCompare(right.createdAt),
        );
    },
    [
      availableChallenges,
      requestedOccurrence,
      state.currentUserId,
      today,
    ],
  );
  const past = useMemo(
    () => {
      const acceptedSources = availableChallenges.filter((challenge) => {
          const participation = viewerParticipation(
            challenge,
            state.currentUserId,
          );
          return participation === "creator" || participation === "accepted";
        });
      const earliest = acceptedSources
        .map((challenge) => challenge.localDate)
        .sort()[0];
      const rows = earliest
        ? expandGroupChallengeOccurrences(
             acceptedSources,
             earliest,
             dateWithOffsetFrom(today, -1),
             RECENT_PAST_OCCURRENCE_LIMIT,
           ).filter((challenge) => groupChallengeEndDate(challenge) < today)
        : [];
      if (
        requestedOccurrence &&
        groupChallengeEndDate(requestedOccurrence) < today &&
        !rows.some((challenge) =>
          occurrenceKey(challenge) === occurrenceKey(requestedOccurrence),
        )
      )
        rows.push(requestedOccurrence);
      return rows.sort((left, right) =>
          groupChallengeEndDate(right).localeCompare(groupChallengeEndDate(left)),
        );
    },
    [
      availableChallenges,
      requestedOccurrence,
      state.currentUserId,
      today,
    ],
  );
  const publicChallenges = useMemo(
    () =>
      publicCloud.challenges
        .filter(
          (challenge) =>
            challenge.audience === "public" &&
            groupChallengeAvailability(challenge, today) !== "finished" &&
            !challengePreferences.preferences.get(
              groupChallengeSourceId(challenge),
            )?.withdrawnAt,
        )
        .sort(
          (left, right) =>
            left.localDate.localeCompare(right.localDate) ||
            left.createdAt.localeCompare(right.createdAt),
        ),
    [challengePreferences.preferences, publicCloud.challenges, today],
  );
  const standingRequests = useMemo(
    () =>
      [...current, ...past]
        .filter((challenge) => {
          const participation = viewerParticipation(
            challenge,
            state.currentUserId,
          );
          return participation === "creator" || participation === "accepted";
        })
        .map((challenge) => ({
          challengeId: groupChallengeSourceId(challenge),
          occurrenceDate: challenge.localDate,
        }))
        .filter(
          (request, index, requests) =>
            requests.findIndex(
              (candidate) =>
                challengeSettlementKey(
                  candidate.challengeId,
                  candidate.occurrenceDate,
                ) ===
                challengeSettlementKey(
                  request.challengeId,
                  request.occurrenceDate,
                ),
            ) === index,
        )
        .slice(0, 50),
    [current, past, state.currentUserId],
  );
  const standingChallengeKey = standingRequests
    .map((request) =>
      challengeSettlementKey(request.challengeId, request.occurrenceDate),
    )
    .join("|");

  useEffect(() => {
    let active = true;
    if (localDemo || !standingRequests.length) {
      setViewerStandings(new Map());
      return () => {
        active = false;
      };
    }
    void loadChallengeViewerStandings(standingRequests)
      .then((standings) => {
        if (!active) return;
        setViewerStandings(
          new Map(
            standings.map((standing) => [
              challengeSettlementKey(
                standing.challengeId,
                standing.occurrenceDate,
              ),
              standing,
            ]),
          ),
        );
      })
      .catch(() => {
        // Local active-group standings remain available offline. Preserve the
        // last server rank through a temporary network failure.
      });
    return () => {
      active = false;
    };
    // The stable key prevents a harmless catalogue object refresh from
    // repeatedly querying the same bounded rank set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localDemo, standingChallengeKey]);

  useEffect(() => {
    if (!editingMode) {
      wiggle.stopAnimation();
      wiggle.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(wiggle, {
          toValue: -1,
          duration: 130,
          useNativeDriver: true,
        }),
        Animated.timing(wiggle, {
          toValue: 1,
          duration: 260,
          useNativeDriver: true,
        }),
        Animated.timing(wiggle, {
          toValue: 0,
          duration: 130,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [editingMode, wiggle]);

  const visibleChallengeOccurrences = useMemo(() => {
    const byKey = new Map<string, GroupChallenge>();
    for (const challenge of [...current, ...past, ...publicChallenges]) {
      const key = occurrenceKey(challenge);
      if (!byKey.has(key)) byKey.set(key, challenge);
    }
    return [...byKey.values()];
  }, [current, past, publicChallenges]);

  useEffect(() => {
    if (localDemo || !expandedId || challengeStandings.has(expandedId)) return;
    const challenge = visibleChallengeOccurrences.find(
      (candidate) => occurrenceKey(candidate) === expandedId,
    );
    if (
      !challenge ||
      !["creator", "accepted"].includes(
        viewerParticipation(challenge, state.currentUserId),
      )
    )
      return;
    let active = true;
    void loadChallengeStandings(
      groupChallengeSourceId(challenge),
      challenge.localDate,
    )
      .then((rows) => {
        if (!active) return;
        setChallengeStandings((current) => {
          const next = new Map(current);
          next.set(expandedId, rows);
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [
    expandedId,
    challengeStandings,
    localDemo,
    state.currentUserId,
    visibleChallengeOccurrences,
  ]);

  useEffect(() => {
    if (!requestedChallengeId) return;
    const source = all.find(
      (item) =>
        item.id === requestedChallengeId ||
        groupChallengeSourceId(item) === requestedChallengeId,
    );
    if (!source) return;
    const challenge =
      requestedOccurrence ??
      current.find(
        (item) => groupChallengeSourceId(item) === groupChallengeSourceId(source),
      ) ??
      past.find(
        (item) => groupChallengeSourceId(item) === groupChallengeSourceId(source),
      ) ??
      publicChallenges.find(
        (item) => groupChallengeSourceId(item) === groupChallengeSourceId(source),
      ) ??
      source;
    const focusKey = [
      requestedChallengeId,
      requestedOccurrenceDate ?? "",
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
      challenge.audience === "public" && participation === "not_invited"
          ? "public"
          : groupChallengeEndDate(challenge) < today
            ? "past"
            : "current";
    const cardKey = occurrenceKey(challenge);
    setTab(targetTab);
    setExpandedId(cardKey);
    setHighlightedId(cardKey);
    highlight.setValue(0);
    const focusTimer = setTimeout(() => {
      const offset = challengeOffsetsRef.current.get(
        `${targetTab}:${cardKey}`,
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
    current,
    highlight,
    past,
    params.challengeEvent,
    params.challengeFocusAt,
    publicChallenges,
    requestedChallengeId,
    requestedOccurrence,
    requestedOccurrenceDate,
    state.currentUserId,
    today,
  ]);

  async function join(challenge: GroupChallenge) {
    const id = groupChallengeSourceId(challenge);
    if (joiningId) return;
    setJoiningId(id);
    try {
      if (challenge.audience === "public") await publicCloud.join(id);
      else await groupCloud.respond(id, "accepted");
      await Promise.all([
        groupCloud.refresh(),
        groupDiscovery.refresh(),
        publicCloud.refresh(),
      ]);
      const occurrence = currentChallengeOccurrence(challenge, today) ?? challenge;
      const cardKey = occurrenceKey(occurrence);
      setTab("current");
      setExpandedId(cardKey);
      setHighlightedId(cardKey);
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
      await Promise.all([groupDiscovery.refresh(), publicCloud.refresh()]);
      setTab("current");
      const occurrence = currentChallengeOccurrence(challenge, today) ?? challenge;
      const cardKey = occurrenceKey(occurrence);
      setExpandedId(response === "accepted" ? cardKey : undefined);
      setHighlightedId(response === "accepted" ? cardKey : undefined);
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

  async function updatePreference(
    challenge: GroupChallenge,
    changes: { hidden?: boolean; pinned?: boolean },
  ) {
    try {
      await challengePreferences.save(
        groupChallengeSourceId(challenge),
        changes,
      );
    } catch (reason) {
      Alert.alert(
        "Could not update challenge",
        reason instanceof Error ? reason.message : String(reason),
      );
    }
  }

  function confirmDelete(challenge: GroupChallenge) {
    Alert.alert(
      "Delete challenge for everyone?",
      "This permanently removes the shared challenge. Tracker data is not changed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void groupCloud
              .remove(groupChallengeSourceId(challenge))
              .then(() =>
                Promise.all([groupDiscovery.refresh(), publicCloud.refresh()]),
              )
              .then(() => setEditingMode(false))
              .catch((reason) =>
                Alert.alert(
                  "Could not delete challenge",
                  reason instanceof Error ? reason.message : String(reason),
                ),
              );
          },
        },
      ],
    );
  }

  function confirmWithdraw(challenge: GroupChallenge) {
    Alert.alert(
      "Remove challenge?",
      "This only removes the challenge from your account. It stays available to other participants, and you will not be able to rejoin it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void challengePreferences
              .withdraw(groupChallengeSourceId(challenge))
              .then(() =>
                Promise.all([
                  publicCloud.refresh(),
                  groupCloud.refresh(),
                  groupDiscovery.refresh(),
                ]),
              )
              .then(() => setEditingMode(false))
              .catch((reason) =>
                Alert.alert(
                  "Could not remove challenge",
                  reason instanceof Error ? reason.message : String(reason),
                ),
              );
          },
        },
      ],
    );
  }

  function shareChallenge(challenge: GroupChallenge, title: string) {
    router.navigate({
      pathname: "/(tabs)/chat",
      params: {
        challengeId: groupChallengeSourceId(challenge),
        challengeTitle: title,
        challengeOccurrenceDate: challenge.localDate,
        challengeGroupId: challenge.groupId,
        challengeAudience: challenge.audience ?? "group",
        challengeShareAt: Date.now().toString(),
      },
    } as never);
  }

  function openChallengeInLeaderboard(challenge: GroupChallenge) {
    const sourceId = groupChallengeSourceId(challenge);
    const preference = challengePreferences.preferences.get(sourceId);
    if (
      preference?.hidden ||
      !state.groups.some((group) => group.id === challenge.groupId)
    )
      return;
    router.navigate({
      pathname: "/(tabs)/group",
      params: {
        groupId: challenge.groupId,
        challengeId: sourceId,
        challengeOccurrenceDate: challenge.localDate,
        challengeEvent: "challenge-page",
        challengeFocusAt: Date.now().toString(),
      },
    } as never);
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
          const cardKey = occurrenceKey(challenge);
          const metric = metrics.find((item) => item.id === challenge.metricId);
          const participation = viewerParticipation(
            challenge,
            state.currentUserId,
          );
          const joined =
            participation === "creator" || participation === "accepted";
          const challengeGroup = state.groups.find(
            (group) => group.id === challenge.groupId,
          );
          const currentMember = challengeGroup?.members.find(
            (member) => member.id === state.currentUserId,
          );
          const manageable = canManageGroupChallenge(
            challenge,
            state.currentUserId,
            currentMember,
          );
          const editable = manageable;
          const preference = challengePreferences.preferences.get(sourceId);
          const canOpenInLeaderboard =
            !preference?.hidden &&
            participation !== "not_invited" &&
            state.groups.some((group) => group.id === challenge.groupId);
          const expanded = expandedId === cardKey;
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
          const highlighted = highlightedId === cardKey;
          const localRows =
            joined && metric && challenge.groupId === state.group.id
              ? groupChallengeProgress(state, challenge, metric)
              : [];
          const localViewerStanding = localRows.find(
            (row) => row.member.id === state.currentUserId,
          );
          const cloudViewerStanding = viewerStandings.get(cardKey);
          const standingPosition =
            localViewerStanding?.standingPosition ??
            cloudViewerStanding?.standingPosition;
          const competitorCount =
            localViewerStanding?.competitorCount ??
            cloudViewerStanding?.competitorCount ??
            0;
          const displayTitle =
            challenge.title?.trim() ||
            `${metric?.name ?? challenge.metricId} challenge`;
          const viewerValue =
            localViewerStanding?.valueLabel ??
            (cloudViewerStanding?.total !== undefined
              ? metric
                ? formatMetricValue(metric, cloudViewerStanding.total)
                : String(cloudViewerStanding.total)
              : undefined);
          const remoteResultRows = challengeStandings.get(cardKey) ?? [];
          return (
            <Animated.View
              key={cardKey}
              onLayout={(event) =>
                challengeOffsetsRef.current.set(
                  `${listTab}:${cardKey}`,
                  event.nativeEvent.layout.y,
                )
              }
              style={[
                editingMode && {
                  transform: [
                    {
                      rotate: wiggle.interpolate({
                        inputRange: [-1, 1],
                        outputRange: ["-0.25deg", "0.25deg"],
                      }),
                    },
                  ],
                },
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
                  accessibilityLabel={`${expanded ? "Collapse" : "Open"} ${displayTitle}`}
                  onLongPress={() => setEditingMode(true)}
                  onPress={() => {
                    setExpandedId((current) =>
                      current === cardKey ? undefined : cardKey,
                    );
                  }}
                  style={styles.challengeMain}
                >
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={t(`View ${displayTitle} in Leaderboard`)}
                    accessibilityState={{ disabled: !canOpenInLeaderboard }}
                    disabled={!canOpenInLeaderboard}
                    onPress={(event) => {
                      event.stopPropagation();
                      openChallengeInLeaderboard(challenge);
                    }}
                  >
                    <ChallengeVisual
                      challenge={challenge}
                      color={accent}
                      size={40}
                    />
                  </Pressable>
                  <View style={styles.challengeCopy}>
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={t(`View ${displayTitle} in Leaderboard`)}
                      accessibilityState={{ disabled: !canOpenInLeaderboard }}
                      disabled={!canOpenInLeaderboard}
                      onPress={(event) => {
                        event.stopPropagation();
                        openChallengeInLeaderboard(challenge);
                      }}
                    >
                      <Text
                        numberOfLines={1}
                        style={[styles.challengeTitle, { color: colors.ink }]}
                      >
                        {displayTitle}
                      </Text>
                    </Pressable>
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
                    {joined ? (
                      <View
                        style={[
                          styles.rankPill,
                          { backgroundColor: colors.primarySoft },
                        ]}
                      >
                        <Ionicons
                          name="podium-outline"
                          size={12}
                          color={accent}
                        />
                        <Text style={[styles.rankText, { color: accent }]}>
                          {standingPosition
                            ? `Your rank · #${standingPosition} of ${Math.max(
                                standingPosition,
                                competitorCount,
                              )}`
                            : "Your rank · waiting for data"}
                        </Text>
                      </View>
                    ) : null}
                    {preference?.hidden || preference?.pinned ? (
                      <View style={styles.preferenceLine}>
                        {preference.hidden ? (
                          <Text
                            style={[
                              styles.preferenceText,
                              { color: colors.muted },
                            ]}
                          >
                            Hidden from Leaderboard
                          </Text>
                        ) : null}
                        {preference.pinned ? (
                          <Text
                            style={[
                              styles.preferenceText,
                              { color: palette.amber },
                            ]}
                          >
                            Pinned
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                  <Ionicons
                    name={expanded ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={colors.faint}
                  />
                </Pressable>
                {expanded ? (
                  <View
                    style={[
                      styles.challengeDetails,
                      { borderTopColor: colors.border },
                    ]}
                  >
                    <View style={styles.detailGrid}>
                      <View style={styles.detailCell}>
                        <Text style={[styles.detailLabel, { color: colors.faint }]}>TRACKER</Text>
                        <Text style={[styles.detailValue, { color: colors.ink }]}>
                          {metric?.name ?? challenge.metricId}
                        </Text>
                      </View>
                      <View style={styles.detailCell}>
                        <Text style={[styles.detailLabel, { color: colors.faint }]}>FORMAT</Text>
                        <Text style={[styles.detailValue, { color: colors.ink }]}>
                          {target}
                        </Text>
                      </View>
                      <View style={styles.detailCell}>
                        <Text style={[styles.detailLabel, { color: colors.faint }]}>YOUR RESULT</Text>
                        <Text style={[styles.detailValue, { color: colors.ink }]}>
                          {viewerValue ?? (joined ? "Waiting for data" : "Join to compete")}
                        </Text>
                      </View>
                      <View style={styles.detailCell}>
                        <Text style={[styles.detailLabel, { color: colors.faint }]}>YOUR RANK</Text>
                        <Text style={[styles.detailValue, { color: colors.ink }]}>
                          {standingPosition
                            ? `#${standingPosition} of ${Math.max(
                                standingPosition,
                                competitorCount,
                              )}`
                            : "Not ranked yet"}
                        </Text>
                      </View>
                    </View>
                    {localRows.length ? (
                      <View style={[styles.resultList, { borderColor: colors.border }]}>
                        {localRows.slice(0, 5).map((row) => (
                          <View key={row.member.id} style={styles.resultRow}>
                            <Text style={[styles.resultRank, { color: palette.amber }]}>
                              #{row.standingPosition ?? "–"}
                            </Text>
                            <Text
                              numberOfLines={1}
                              style={[styles.resultName, { color: colors.ink }]}
                            >
                              {memberDisplayName(state, row.member)}
                              {row.member.id === state.currentUserId ? " · You" : ""}
                            </Text>
                            <Text style={[styles.resultValue, { color: colors.muted }]}>
                              {row.mode === "exact" ? row.valueLabel : "Private"}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : remoteResultRows.length ? (
                      <View style={[styles.resultList, { borderColor: colors.border }]}>
                        {remoteResultRows.map((row) => (
                          <View key={row.userId} style={styles.resultRow}>
                            <Text style={[styles.resultRank, { color: palette.amber }]}>
                              #{row.standingPosition}
                            </Text>
                            <Text
                              numberOfLines={1}
                              style={[styles.resultName, { color: colors.ink }]}
                            >
                              {row.displayName}
                              {row.userId === state.currentUserId ? " · You" : ""}
                            </Text>
                            <Text style={[styles.resultValue, { color: colors.muted }]}>
                              {metric
                                ? formatMetricValue(metric, row.total)
                                : String(row.total)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : joined ? (
                      <Text style={[styles.resultsPending, { color: colors.muted }]}>
                        Results appear here after participants sync.
                      </Text>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Share ${displayTitle} to Chat`}
                      onPress={() => shareChallenge(challenge, displayTitle)}
                      style={[styles.shareAction, { borderColor: colors.border }]}
                    >
                      <Ionicons name="chatbubble-ellipses-outline" size={15} color={accent} />
                      <Text style={[styles.actionText, { color: accent }]}>Share to Chat</Text>
                    </Pressable>
                  </View>
                ) : null}
                <View style={styles.challengeActions}>
                  {editingMode && editable ? (
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
                  {editingMode && participation !== "not_invited" ? (
                    <Pressable
                      onPress={() =>
                        void updatePreference(challenge, {
                          pinned: !preference?.pinned,
                        })
                      }
                      style={[styles.action, { borderColor: colors.border }]}
                    >
                      <Ionicons
                        name={preference?.pinned ? "pin" : "pin-outline"}
                        size={15}
                        color={preference?.pinned ? palette.amber : colors.muted}
                      />
                      <Text style={[styles.actionText, { color: colors.muted }]}>Pin</Text>
                    </Pressable>
                  ) : null}
                  {editingMode && participation !== "not_invited" ? (
                    <Pressable
                      onPress={() =>
                        void updatePreference(challenge, {
                          hidden: !preference?.hidden,
                        })
                      }
                      style={[styles.action, { borderColor: colors.border }]}
                    >
                      <Ionicons
                        name={preference?.hidden ? "eye-outline" : "eye-off-outline"}
                        size={15}
                        color={colors.muted}
                      />
                      <Text style={[styles.actionText, { color: colors.muted }]}>
                        {preference?.hidden ? "Show" : "Hide"}
                      </Text>
                    </Pressable>
                  ) : null}
                  {editingMode && manageable ? (
                    <Pressable
                      onPress={() => confirmDelete(challenge)}
                      style={[styles.action, { borderColor: palette.red }]}
                    >
                      <Ionicons name="trash-outline" size={15} color={palette.red} />
                      <Text style={[styles.actionText, { color: palette.red }]}>Delete</Text>
                    </Pressable>
                  ) : editingMode && participation !== "not_invited" ? (
                    <Pressable
                      onPress={() => confirmWithdraw(challenge)}
                      style={[styles.action, { borderColor: palette.red }]}
                    >
                      <Ionicons name="trash-outline" size={15} color={palette.red} />
                      <Text style={[styles.actionText, { color: palette.red }]}>Remove</Text>
                    </Pressable>
                  ) : null}
                  {!editingMode && !joined &&
                  (challenge.audience === "public" ||
                    participation === "not_invited") &&
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
                  {!editingMode && participation === "invited" &&
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
  const handlePageChange = useCallback((index: number) => {
    const next = TABS[index]?.id;
    if (!next) return;
    setTab((current) => (current === next ? current : next));
  }, []);
  return (
    <Screen scrollRef={screenScrollRef} contentContainerStyle={styles.screen}>
      <PageHeader
        eyebrow="COMPETE TOGETHER"
        title="Challenges"
        subtitle="Join, create and revisit your competitions."
        showMenu={false}
        action={
          <View style={styles.headerActions}>
            {editingMode ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Finish editing challenges"
                onPress={() => setEditingMode(false)}
                style={[styles.done, { backgroundColor: accent }]}
              >
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            ) : (
              <IconButton
                icon="add"
                label="Create challenge"
                onPress={() => openEditor()}
              />
            )}
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
      {publicCloud.error || groupCloud.error || groupDiscovery.error ? (
        <Pressable
          onPress={() => {
            void publicCloud.refresh();
            void groupCloud.refresh();
            void groupDiscovery.refresh();
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
          onPageSettled={handlePageChange}
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
          await Promise.all([
            publicCloud.refresh(),
            groupCloud.refresh(),
            groupDiscovery.refresh(),
          ]);
          setTab("current");
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingBottom: 22 },
  headerActions: { flexDirection: "row", gap: 5 },
  done: {
    minHeight: 36,
    borderRadius: 12,
    paddingHorizontal: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  doneText: { color: palette.white, fontSize: 9, fontWeight: "900" },
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
  challengeCopy: { flex: 1, minWidth: 0 },
  challengeTitle: { fontSize: 13, fontWeight: "900" },
  challengeMeta: { marginTop: 2, fontSize: 8, lineHeight: 12, fontWeight: "700" },
  challengeState: { marginTop: 4, fontSize: 8, fontWeight: "900" },
  rankPill: {
    alignSelf: "flex-start",
    minHeight: 22,
    borderRadius: 999,
    paddingHorizontal: 7,
    marginTop: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  rankText: { fontSize: 8, fontWeight: "900" },
  preferenceLine: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 4 },
  preferenceText: { fontSize: 7, fontWeight: "900" },
  challengeDetails: { marginTop: 8, paddingTop: 9, borderTopWidth: 1 },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  detailCell: { width: "48%", minWidth: 120 },
  detailLabel: { fontSize: 7, lineHeight: 10, fontWeight: "900" },
  detailValue: { marginTop: 2, fontSize: 9, lineHeight: 13, fontWeight: "800" },
  resultList: { marginTop: 9, borderWidth: 1, borderRadius: 12, padding: 7, gap: 5 },
  resultRow: { minHeight: 25, flexDirection: "row", alignItems: "center", gap: 6 },
  resultRank: { width: 22, fontSize: 8, fontWeight: "900" },
  resultName: { flex: 1, fontSize: 8, fontWeight: "800" },
  resultValue: { maxWidth: "38%", fontSize: 8, fontWeight: "900" },
  resultsPending: { marginTop: 8, fontSize: 8, lineHeight: 12, fontWeight: "700" },
  shareAction: {
    alignSelf: "flex-start",
    minHeight: 34,
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  challengeActions: {
    flexDirection: "row",
    flexWrap: "wrap",
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
