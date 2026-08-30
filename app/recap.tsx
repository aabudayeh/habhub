import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import React, {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "@/src/components/AppText";
import { CheerIcon } from "@/src/components/CheerIcon";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { DateRangeNavigator, PeriodChoiceBar } from "@/src/components/PeriodNavigator";
import { Avatar, Card, Chip, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { GroupSocialReactionKind } from "@/src/cloud/groupSocial";
import { useGroupChallenges } from "@/src/cloud/useGroupChallenges";
import { useGroupSocialEngagement } from "@/src/cloud/useGroupSocialEngagement";
import { useSettledChallengeResults } from "@/src/cloud/useSettledChallengeResults";
import { buildBadges } from "@/src/domain/badges";
import { dateKey, dateKeyWithOffset, friendlyDate, relativeTime } from "@/src/domain/date";
import { LeaderboardPeriod, periodDates, shiftedPeriodAnchor } from "@/src/domain/leaderboard";
import { buildGroupRecapFeed, buildRecapStories, RecapFeedItem, RecapScope } from "@/src/domain/recaps";
import { useLocale } from "@/src/i18n";
import { useApp } from "@/src/state/AppProvider";
import { stageChatShareImage } from "@/src/storage/chatShareImageStaging";
import type { Member } from "@/src/types";
import { palette, shadow, useAppColors, useGroupAccent } from "@/src/theme";

type FeedFilter = "all" | "logs" | "wins" | "badges" | "challenges";
const feedFilters: { id: FeedFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "logs", label: "Logs" },
  { id: "wins", label: "Leaderboard" },
  { id: "badges", label: "Badges" },
  { id: "challenges", label: "Challenges" },
];
const FEED_PAGE_SIZE = 30;

function filterFeed(items: readonly RecapFeedItem[], filter: FeedFilter) {
  if (filter === "logs") return items.filter((item) => ["log", "meal", "workout", "photo"].includes(item.kind));
  if (filter === "wins") return items.filter((item) => item.kind === "leader");
  if (filter === "badges") return items.filter((item) => item.kind === "badge");
  if (filter === "challenges") return items.filter((item) => item.kind === "challenge");
  return items;
}

function recapFeedImageUri(item: RecapFeedItem) {
  if (typeof item.image === "string") return item.image;
  if (
    item.image &&
    typeof item.image === "object" &&
    !Array.isArray(item.image) &&
    "uri" in item.image &&
    typeof item.image.uri === "string"
  )
    return item.image.uri;
  return undefined;
}

export default function StoryRecapScreen() {
  const { state } = useApp();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ scope?: string; anchor?: string }>();
  const scope: RecapScope = params.scope === "group" ? "group" : "personal";
  const anchor = params.anchor || dateKey();
  const storySourceKey = `${scope}:${state.currentUserId}:${state.group.id}:${anchor}`;
  const challengeCloud = useGroupChallenges(
    scope === "group" ? state.group.id : "",
  );
  const settledChallengeResults = useSettledChallengeResults(
    scope === "group" ? state.group.id : "",
  );
  const settledChallengeOccurrenceKeys =
    settledChallengeResults.occurrenceKeys;
  const settledChallengeOccurrences = useMemo(
    () =>
      settledChallengeOccurrenceKeys
        ? new Set(settledChallengeOccurrenceKeys)
        : undefined,
    [settledChallengeOccurrenceKeys],
  );
  const sourceStories = useMemo(
    () =>
      buildRecapStories(
        state,
        scope,
        anchor,
        scope === "group" ? challengeCloud.challenges : [],
        scope === "group" ? settledChallengeOccurrences : undefined,
        scope === "group" ? settledChallengeResults.placements : undefined,
      ),
    [
      anchor,
      challengeCloud.challenges,
      scope,
      settledChallengeOccurrences,
      settledChallengeResults.placements,
      state,
    ],
  );
  const [storyDeck, setStoryDeck] = useState<{
    key: string;
    stories: ReturnType<typeof buildRecapStories>;
  } | null>(null);
  const stories =
    storyDeck?.key === storySourceKey ? storyDeck.stories : [];
  const [index, setIndex] = useState(0);
  const touchStartX = useRef(0);
  const progress = useRef(new Animated.Value(0)).current;
  const story = stories[index];

  useEffect(() => {
    if (storyDeck?.key === storySourceKey) return;
    if (
      scope === "group" &&
      (!challengeCloud.initialLoadComplete ||
        !settledChallengeResults.initialLoadComplete)
    )
      return;
    // Freeze one coherent deck for this open story session. Realtime updates
    // may prepend new challenge/result cards, but they must not shift the
    // visible page beneath the user or flash page two before page one.
    setIndex(0);
    setStoryDeck({ key: storySourceKey, stories: sourceStories });
  }, [
    challengeCloud.initialLoadComplete,
    scope,
    settledChallengeResults.initialLoadComplete,
    sourceStories,
    storyDeck?.key,
    storySourceKey,
  ]);

  function previous() {
    if (index === 0) return router.back();
    setIndex((value) => value - 1);
  }

  function next() {
    if (index >= stories.length - 1) return router.back();
    setIndex((value) => value + 1);
  }

  useEffect(() => {
    if (!stories.length) return;
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 6500,
      useNativeDriver: false,
    });
    animation.start(({ finished }) => {
      if (finished) setIndex((value) => (value + 1) % stories.length);
    });
    return () => animation.stop();
  }, [index, progress, stories.length]);

  useEffect(() => {
    if (index < stories.length) return;
    setIndex(0);
  }, [index, stories.length]);

  if (!story) return null;
  return (
    <Screen contentContainerStyle={storyStyles.screen}>
      <View style={storyStyles.topRow}>
        <View style={storyStyles.progress}>
          {stories.map((item, itemIndex) => (
            <View key={item.id} style={storyStyles.segment}>
              {itemIndex < index ? (
                <View style={[storyStyles.segmentFill, { width: "100%" }]} />
              ) : itemIndex === index ? (
                <Animated.View
                  style={[
                    storyStyles.segmentFill,
                    {
                      width: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: ["0%", "100%"],
                      }),
                    },
                  ]}
                />
              ) : null}
            </View>
          ))}
        </View>
        <Pressable
          onPress={() => router.back()}
          accessibilityLabel="Close recap"
          style={storyStyles.close}
        >
          <Ionicons name="close" size={22} color={palette.ink} />
        </Pressable>
      </View>
      <Text style={storyStyles.heading}>
        {scope === "group" ? "Group recap" : "Your recap"} · {index + 1} of {stories.length}
      </Text>
      <View
        onStartShouldSetResponder={() => true}
        onResponderGrant={(event) => {
          touchStartX.current = event.nativeEvent.pageX;
        }}
        onResponderRelease={(event) => {
          const x = event.nativeEvent.pageX;
          const delta = x - touchStartX.current;
          if (delta > 35) previous();
          else if (delta < -35) next();
          else if (x < width / 2) previous();
          else next();
        }}
      >
        <Card
          style={[
            storyStyles.story,
            { backgroundColor: story.color, borderColor: story.color },
          ]}
        >
          <View style={storyStyles.icon}>
            <Ionicons
              name={story.icon as keyof typeof Ionicons.glyphMap}
              size={38}
              color={palette.white}
            />
          </View>
          <View style={storyStyles.storyCopy}>
            <Text style={storyStyles.eyebrow}>{story.eyebrow}</Text>
            <Text style={storyStyles.title}>{story.title}</Text>
            <Text style={storyStyles.stat}>{story.stat}</Text>
            <Text style={storyStyles.body}>{story.body}</Text>
          </View>
          <Text style={storyStyles.brand}>HABHUB</Text>
        </Card>
      </View>
      {scope === "group" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open group recap feed"
          onPress={() =>
            router.navigate({
              pathname: "/(tabs)/recapfeed",
              params: { anchor },
            } as never)
          }
          style={storyStyles.feedButton}
        >
          <Ionicons name="newspaper-outline" size={17} color={palette.ink} />
          <Text style={storyStyles.feedButtonText}>View group feed</Text>
        </Pressable>
      ) : null}
      <Text style={storyStyles.note}>
        Swipe to move between stories. They advance automatically and refresh daily. Values are estimates based on logged data.
      </Text>
    </Screen>
  );
}

export function GroupRecapFeedScreen() {
  const { state, updateSettings } = useApp();
  // Health and cloud sync can update the account snapshot several times per
  // second. Feed derivation is substantial, so let taps/scrolling win the
  // current frame while retaining the latest authorized snapshot for the next.
  const feedState = useDeferredValue(state);
  const colors = useAppColors();
  const accent = useGroupAccent();
  const params = useLocalSearchParams<{ highlight?: string; period?: string; anchor?: string }>();
  const [period, setPeriod] = useState<LeaderboardPeriod>((params.period as LeaderboardPeriod) || "week");
  const [anchor, setAnchor] = useState(params.anchor || dateKey());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [renderLimit, setRenderLimit] = useState(FEED_PAGE_SIZE);
  const [highlightedItemId, setHighlightedItemId] = useState(params.highlight);
  const [socialActionError, setSocialActionError] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const feedY = useRef(0);
  const itemY = useRef(new Map<string, number>());
  const dateNavigatorOpen = state.settings.recapDateNavigatorCollapsed === false;
  const dates = useMemo(
    () => periodDates(period, anchor, state.settings.weekStartsOn ?? 1),
    [anchor, period, state.settings.weekStartsOn],
  );
  const challengeCloud = useGroupChallenges(state.group.id);
  const settledChallengeResults = useSettledChallengeResults(state.group.id);
  const settledChallengeOccurrenceKeys =
    settledChallengeResults.occurrenceKeys;
  const settledChallengeOccurrences = useMemo(
    () =>
      settledChallengeOccurrenceKeys
        ? new Set(settledChallengeOccurrenceKeys)
        : undefined,
    [settledChallengeOccurrenceKeys],
  );
  const badges = useMemo(
    () =>
      buildBadges(
        feedState,
        anchor,
        challengeCloud.challenges,
        dateKey(),
        settledChallengeResults.placements,
        settledChallengeOccurrenceKeys,
      ),
    [
      anchor,
      challengeCloud.challenges,
      settledChallengeOccurrenceKeys,
      settledChallengeResults.placements,
      feedState,
    ],
  );
  const feed = useMemo(
    () =>
      buildGroupRecapFeed(
        feedState,
        dates,
        badges,
        challengeCloud.challenges,
        settledChallengeOccurrences,
        settledChallengeResults.placements,
      ),
    [
      badges,
      challengeCloud.challenges,
      dates,
      settledChallengeOccurrences,
      settledChallengeResults.placements,
      feedState,
    ],
  );
  const visibleFeed = useMemo(() => filterFeed(feed, filter), [feed, filter]);
  useEffect(() => {
    setRenderLimit(FEED_PAGE_SIZE);
  }, [anchor, filter, period]);
  useEffect(() => {
    if (!params.highlight) return;
    const highlightedIndex = visibleFeed.findIndex(
      (item) => item.id === params.highlight,
    );
    if (highlightedIndex >= 0)
      setRenderLimit((current) => Math.max(current, highlightedIndex + 1));
  }, [params.highlight, visibleFeed]);
  const displayedFeed = useMemo(
    () => visibleFeed.slice(0, renderLimit),
    [renderLimit, visibleFeed],
  );
  const targets = useMemo(
    () => displayedFeed.map((item) => item.socialTarget),
    [displayedFeed],
  );
  const social = useGroupSocialEngagement(state.group.id, targets);
  const groupNicknames =
    feedState.settings.memberNicknamesByGroup?.[feedState.group.id];
  const legacyNicknames = feedState.settings.memberNicknames;
  const feedMembers = useMemo(
    () =>
      new Map(
        feedState.group.members.map((member) => [
          member.id,
          {
            member,
            displayName:
              groupNicknames?.[member.id]?.trim() ||
              legacyNicknames?.[member.id]?.trim() ||
              member.name,
          },
        ]),
      ),
    [
      feedState.group.members,
      groupNicknames,
      legacyNicknames,
    ],
  );

  function choosePeriod(next: Exclude<LeaderboardPeriod, "custom">) {
    setPeriod(next);
    if (next === "yesterday") setAnchor(dateKeyWithOffset(-1));
    else if (next !== "overall") setAnchor(dateKey());
    setCalendarOpen(false);
  }
  function toggleDateNavigator() {
    if (dateNavigatorOpen) setCalendarOpen(false);
    updateSettings({ recapDateNavigatorCollapsed: dateNavigatorOpen });
  }
  function shiftRange(direction: -1 | 1) {
    const next = shiftedPeriodAnchor(period, anchor, direction);
    if (!next) return;
    if (period === "today" || period === "yesterday") setPeriod("custom");
    setAnchor(next);
    setCalendarOpen(false);
  }
  useEffect(() => {
    if (params.highlight) setFilter("all");
  }, [params.highlight]);
  useEffect(() => {
    if (!params.highlight || !displayedFeed.length) return;
    setHighlightedItemId(params.highlight);
    const scrollTimer = setTimeout(() => {
      const y = itemY.current.get(params.highlight!);
      if (typeof y === "number")
        scrollRef.current?.scrollTo({
          y: Math.max(0, feedY.current + y - 110),
          animated: true,
        });
    }, 160);
    const clearTimer = setTimeout(() => setHighlightedItemId(undefined), 4_000);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [displayedFeed, params.highlight]);

  return (
    <Screen
      scrollRef={scrollRef}
      removeClippedSubviews={Platform.OS !== "web"}
      scrollEventThrottle={32}
    >
      <PageHeader eyebrow={state.group.name} translateEyebrow={false} title="Feed" showMenu={false} action={<IconButton icon="close" label="Close" onPress={() => router.back()} />} />
      <PeriodChoiceBar period={period} onChange={choosePeriod} dateViewOpen={dateNavigatorOpen} onToggleDateView={toggleDateNavigator} />
      {period !== "overall" && dateNavigatorOpen ? (
        <DateRangeNavigator period={period} anchor={anchor} dates={dates} calendarOpen={calendarOpen} onToggleCalendar={() => setCalendarOpen((value) => !value)} onShift={shiftRange}>
          <MonthCalendar monthDate={anchor} selectedDate={anchor} onMonthChange={setAnchor} onSelect={(date) => { setAnchor(date); setPeriod("custom"); setCalendarOpen(false); }} />
        </DateRangeNavigator>
      ) : null}
      <View style={styles.filterRow}>{feedFilters.map((item) => <Chip key={item.id} label={item.label} selected={filter === item.id} onPress={() => setFilter(item.id)} />)}</View>
      {social.error || socialActionError ? <Card style={styles.notice}><Ionicons name="cloud-offline-outline" size={16} color={colors.muted} /><Text style={[styles.body, { color: colors.muted }]}>{socialActionError ? "That reaction or comment could not be saved. Try again." : "Reactions will retry when the group reconnects."}</Text></Card> : null}
      <View
        onLayout={(event) => {
          feedY.current = event.nativeEvent.layout.y;
        }}
        style={styles.feed}
      >
        {displayedFeed.map((item) => (
          <MemoFeedCard
            key={item.id}
            item={item}
            currentUserId={feedState.currentUserId}
            members={feedMembers}
            timeFormat={feedState.settings.timeFormat}
            highlighted={highlightedItemId === item.id}
            onLayout={(y) => itemY.current.set(item.id, y)}
            reactions={social.reactionsByTarget.get(social.targetKey(item.socialTarget)) ?? []}
            comments={social.commentsByTarget.get(social.targetKey(item.socialTarget)) ?? []}
            onReact={(reaction) => {
              setSocialActionError(false);
              void social
                .react(item.socialTarget, reaction)
                .catch(() => setSocialActionError(true));
            }}
            onComment={async (content) => {
              setSocialActionError(false);
              try {
                await social.comment(item.socialTarget, content);
              } catch (reason) {
                setSocialActionError(true);
                throw reason;
              }
            }}
            onDeleteComment={async (commentId) => {
              setSocialActionError(false);
              await social
                .removeComment(commentId)
                .catch(() => setSocialActionError(true));
            }}
            onShare={() => {
              const attachment = {
                kind: "recap" as const,
                scope: "group" as const,
                highlight: item.id,
                anchor: item.localDate,
                title: item.title,
              };
              stageChatShareImage(
                state.currentUserId,
                state.group.id,
                attachment,
                recapFeedImageUri(item),
              );
              router.navigate({
                pathname: "/(tabs)/chat",
                params: {
                  recapHighlight: item.id,
                  recapTitle: item.title,
                  recapAnchor: item.localDate,
                  recapShareAt: Date.now().toString(),
                },
              } as never);
            }}
          />
        ))}
      </View>
      {displayedFeed.length < visibleFeed.length ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show more group feed updates"
          onPress={() =>
            setRenderLimit((current) =>
              Math.min(visibleFeed.length, current + FEED_PAGE_SIZE),
            )
          }
          style={styles.showMore}
        >
          <Text style={[styles.summaryTitle, { color: accent }]}>Show more</Text>
          <Text style={[styles.body, { color: colors.muted }]}>Load the next {Math.min(FEED_PAGE_SIZE, visibleFeed.length - displayedFeed.length)} updates</Text>
        </Pressable>
      ) : null}
      {!visibleFeed.length ? <Card style={styles.empty}><Ionicons name="sparkles-outline" size={26} color={accent} /><Text style={[styles.summaryTitle, { color: colors.ink }]}>Nothing meaningful to recap yet</Text><Text style={[styles.body, { color: colors.muted }]}>Shared meals, workouts, photos, badges, challenges, and daily leaders will appear here.</Text></Card> : null}
    </Screen>
  );
}

type SocialHook = ReturnType<typeof useGroupSocialEngagement>;
type FeedMember = { member: Member; displayName: string };
type FeedCardProps = {
  item: RecapFeedItem;
  currentUserId: string;
  members: ReadonlyMap<string, FeedMember>;
  timeFormat: "12h" | "24h" | undefined;
  highlighted: boolean;
  onLayout: (y: number) => void;
  reactions: SocialHook["reactions"];
  comments: SocialHook["comments"];
  onReact: (reaction: GroupSocialReactionKind) => void;
  onComment: (content: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onShare: () => void;
};

function commentDateTimeLabel(
  createdAt: string,
  locale: string,
  timeFormat: "12h" | "24h" | undefined,
) {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return "";
  const includeYear = date.getFullYear() !== new Date().getFullYear();
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" as const } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  }).format(date);
}

function FeedCard({ item, currentUserId, members, timeFormat, highlighted, onLayout, reactions, comments, onReact, onComment, onDeleteComment, onShare }: FeedCardProps) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const locale = useLocale();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const member = item.memberId ? members.get(item.memberId)?.member : undefined;
  const counts = (reaction: GroupSocialReactionKind) => reactions.filter((candidate) => candidate.reaction === reaction).length;
  const mine = reactions.find((reaction) => reaction.userId === currentUserId);
  const macros = item.nutrition ? [
    { id: "Protein", value: item.nutrition.proteinG ?? 0, color: "#A66AE8" },
    { id: "Carbs", value: item.nutrition.carbsG ?? 0, color: "#E6A23C" },
    { id: "Fat", value: item.nutrition.fatG ?? 0, color: "#4BA6DE" },
  ] : [];
  const macroTotal = macros.reduce((sum, macro) => sum + macro.value, 0);
  return (
    <View onLayout={(event) => onLayout(event.nativeEvent.layout.y)} style={styles.feedItem}>
      <Card style={[styles.feedCard, { borderTopColor: item.color }, highlighted && { borderColor: "#E9873F", borderWidth: 2 }]}>
        <Pressable disabled={!item.deepLink} onPress={() => item.deepLink && router.navigate(item.deepLink as never)}>
          <View style={styles.feedHeading}>
            {member ? <Avatar initials={member.initials} color={member.color} uri={member.avatarUri} size={38} /> : <View style={[styles.feedIcon, { backgroundColor: `${item.color}20` }]}><Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={19} color={item.color} /></View>}
            <View style={styles.copy}>
              <Text style={[styles.eyebrow, { color: item.color }]}>{item.eyebrow}</Text>
              <Text style={[styles.feedTitle, { color: colors.ink }]}>{item.title}</Text>
              <Text style={[styles.feedTime, { color: colors.faint }]}>{friendlyDate(item.localDate)} · {relativeTime(item.createdAt)}</Text>
            </View>
            {item.value ? <Text style={[styles.feedValue, { color: item.color }]}>{item.value}</Text> : null}
          </View>
          {item.image ? <Image source={item.image} contentFit="cover" style={styles.feedImage} /> : null}
          <Text style={[styles.feedBody, { color: colors.muted }]}>{item.body}</Text>
          {macroTotal > 0 ? <View style={styles.macroBlock}><View style={[styles.macroTrack, { backgroundColor: colors.border }]}>{macros.map((macro) => <View key={macro.id} style={{ height: "100%", width: `${(macro.value / macroTotal) * 100}%`, backgroundColor: macro.color }} />)}</View><View style={styles.macroLegend}>{macros.map((macro) => <Text key={macro.id} style={[styles.macroText, { color: colors.muted }]}>{macro.id} {Math.round(macro.value)}g</Text>)}</View></View> : null}
        </Pressable>
        <View style={[styles.actions, { borderTopColor: colors.border }]}>
          <ReactionButton icon="heart" count={counts("heart")} active={mine?.reaction === "heart"} color="#E65D75" onPress={() => onReact("heart")} />
          <ReactionButton icon="party-popper" count={counts("cheer")} active={mine?.reaction === "cheer"} color="#E3A72F" onPress={() => onReact("cheer")} />
          <ReactionButton icon="thumbs-up" count={counts("thumbs_up")} active={mine?.reaction === "thumbs_up"} color={accent} onPress={() => onReact("thumbs_up")} />
          <ReactionButton icon="thumbs-down" count={counts("thumbs_down")} active={mine?.reaction === "thumbs_down"} color="#D87C42" onPress={() => onReact("thumbs_down")} />
          <Pressable onPress={() => setCommentsOpen((value) => !value)} style={styles.actionButton}><Ionicons name="chatbubble-outline" size={15} color={colors.muted} /><Text style={[styles.actionText, { color: colors.muted }]}>{comments.length || "Comment"}</Text></Pressable>
          <Pressable onPress={onShare} style={styles.actionButton}><Ionicons name="paper-plane-outline" size={15} color={colors.muted} /><Text style={[styles.actionText, { color: colors.muted }]}>Share</Text></Pressable>
        </View>
        {commentsOpen ? <View style={[styles.comments, { borderTopColor: colors.border }]}>
          {comments.map((comment) => {
            const author = members.get(comment.userId);
            return (
              <View key={comment.id} style={styles.commentRow}>
                <View style={styles.copy}>
                  <View style={styles.commentMeta}>
                    <Text style={[styles.commentAuthor, { color: colors.ink }]}>
                      {author?.displayName ?? "Member"}
                    </Text>
                    <Text style={[styles.commentTimestamp, { color: colors.faint }]}>
                      {commentDateTimeLabel(
                        comment.createdAt,
                        locale,
                        timeFormat,
                      )}
                    </Text>
                  </View>
                  <Text style={[styles.commentText, { color: colors.muted }]}>
                    {comment.content}
                  </Text>
                </View>
                {comment.userId === currentUserId ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Delete comment"
                    hitSlop={8}
                    onPress={() => void onDeleteComment(comment.id)}
                    style={({ pressed }) => [
                      styles.commentDelete,
                      { borderColor: `${palette.red}55` },
                      pressed && { opacity: 0.58 },
                    ]}
                  >
                    <Ionicons name="trash-outline" size={13} color={palette.red} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
          <View style={styles.commentComposer}><TextInput value={draft} onChangeText={setDraft} placeholder="Add a comment" placeholderTextColor={colors.faint} style={[styles.commentInput, { color: colors.ink, borderColor: colors.border, backgroundColor: colors.canvas }]} /><IconButton icon="send" label="Post comment" onPress={() => { const content = draft.trim(); if (!content) return; setDraft(""); void onComment(content).catch(() => setDraft(content)); }} /></View>
        </View> : null}
      </Card>
    </View>
  );
}

function sameFeedReactions(
  left: FeedCardProps["reactions"],
  right: FeedCardProps["reactions"],
) {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return item.userId === other?.userId &&
      item.reaction === other.reaction &&
      item.updatedAt === other.updatedAt;
  });
}

function sameFeedComments(
  left: FeedCardProps["comments"],
  right: FeedCardProps["comments"],
) {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return item.id === other?.id &&
      item.content === other.content &&
      item.updatedAt === other.updatedAt;
  });
}

const MemoFeedCard = React.memo(
  FeedCard,
  (left, right) =>
    left.item === right.item &&
    left.currentUserId === right.currentUserId &&
    left.members === right.members &&
    left.timeFormat === right.timeFormat &&
    left.highlighted === right.highlighted &&
    sameFeedReactions(left.reactions, right.reactions) &&
    sameFeedComments(left.comments, right.comments),
);

function ReactionButton({ icon, count, active, color, onPress }: { icon: "heart" | "thumbs-up" | "thumbs-down" | "party-popper"; count: number; active: boolean; color: string; onPress: () => void }) {
  const colors = useAppColors();
  const iconColor = active ? color : colors.muted;
  const reactionIcon = icon === "party-popper"
    ? <CheerIcon size={16} color={iconColor} />
    : <Ionicons name={active ? icon : `${icon}-outline`} size={15} color={iconColor} />;
  return <Pressable onPress={onPress} style={[styles.actionButton, active && { backgroundColor: `${color}18` }]}>{reactionIcon}{count ? <Text style={[styles.actionText, { color: iconColor }]}>{count}</Text> : null}</Pressable>;
}

const storyStyles = StyleSheet.create({
  screen: { flexGrow: 1, justifyContent: "center", paddingVertical: 24 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  progress: { flex: 1, flexDirection: "row", gap: 4 },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.border,
    overflow: "hidden",
  },
  segmentFill: { height: "100%", backgroundColor: palette.ink },
  close: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.card,
  },
  heading: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 12,
    marginBottom: 10,
  },
  story: {
    minHeight: 510,
    borderRadius: 30,
    padding: 26,
    justifyContent: "space-between",
    ...shadow,
  },
  icon: {
    width: 66,
    height: 66,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF26",
  },
  storyCopy: { marginVertical: 30 },
  eyebrow: {
    color: "#FFFFFFCC",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  title: {
    color: palette.white,
    fontSize: 31,
    lineHeight: 37,
    fontWeight: "900",
    marginTop: 12,
  },
  stat: {
    color: palette.white,
    fontSize: 38,
    lineHeight: 47,
    fontWeight: "900",
    letterSpacing: -1,
    marginTop: 22,
  },
  body: {
    color: "#FFFFFFE0",
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "700",
    marginTop: 14,
  },
  brand: {
    color: "#FFFFFFB8",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
  },
  feedButton: {
    minHeight: 48,
    marginTop: 12,
    borderRadius: 16,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  feedButtonText: { color: palette.ink, fontSize: 13, fontWeight: "900" },
  note: {
    color: palette.muted,
    fontSize: 9,
    lineHeight: 14,
    textAlign: "center",
    marginTop: 12,
  },
});

const styles = StyleSheet.create({
  copy: { flex: 1, minWidth: 0 },
  summaryTitle: { fontSize: 13, fontWeight: "900" },
  body: { fontSize: 9, lineHeight: 14, marginTop: 2 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  notice: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10 },
  feed: { gap: 10 }, feedItem: { width: "100%" },
  feedCard: { padding: 0, overflow: "hidden", borderTopWidth: 3 },
  feedHeading: { flexDirection: "row", alignItems: "center", gap: 9, padding: 11 },
  feedIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  eyebrow: { fontSize: 7, fontWeight: "900", letterSpacing: 0.9 },
  feedTitle: { fontSize: 11, lineHeight: 15, fontWeight: "900", marginTop: 1 },
  feedTime: { fontSize: 7, fontWeight: "700", marginTop: 2 },
  feedValue: { maxWidth: 96, fontSize: 12, fontWeight: "900", textAlign: "right" },
  feedBody: { fontSize: 9, lineHeight: 14, paddingHorizontal: 11, paddingBottom: 10 },
  feedImage: { width: "100%", aspectRatio: 1.72 },
  macroBlock: { paddingHorizontal: 11, paddingBottom: 10, gap: 5 },
  macroTrack: { height: 7, borderRadius: 5, overflow: "hidden", flexDirection: "row" },
  macroLegend: { flexDirection: "row", justifyContent: "space-between", gap: 6 },
  macroText: { fontSize: 7, fontWeight: "800" },
  actions: { minHeight: 42, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", paddingHorizontal: 6, gap: 2 },
  actionButton: { minWidth: 34, minHeight: 32, borderRadius: 10, paddingHorizontal: 7, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  actionText: { fontSize: 7, fontWeight: "900" },
  comments: { borderTopWidth: StyleSheet.hairlineWidth, padding: 10, gap: 8 },
  commentRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  commentMeta: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 5 },
  commentAuthor: { fontSize: 8, fontWeight: "900" },
  commentTimestamp: { fontSize: 7, fontWeight: "700" },
  commentText: { fontSize: 9, lineHeight: 13, marginTop: 1 },
  commentDelete: {
    width: 26,
    height: 26,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  commentComposer: { flexDirection: "row", alignItems: "center", gap: 6 },
  commentInput: { flex: 1, minHeight: 38, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, fontSize: 10 },
  empty: { alignItems: "center", gap: 6, padding: 24 },
  showMore: { minHeight: 48, alignItems: "center", justifyContent: "center", gap: 1, paddingVertical: 8 },
});
