import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "@/src/components/AppText";
import { MonthCalendar } from "@/src/components/MonthCalendar";
import { DateRangeNavigator, PeriodChoiceBar } from "@/src/components/PeriodNavigator";
import { Avatar, Card, Chip, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { GroupSocialReactionKind } from "@/src/cloud/groupSocial";
import { useGroupChallenges } from "@/src/cloud/useGroupChallenges";
import { useGroupSocialEngagement } from "@/src/cloud/useGroupSocialEngagement";
import { buildBadges } from "@/src/domain/badges";
import { dateKey, dateKeyWithOffset, friendlyDate, relativeTime } from "@/src/domain/date";
import { LeaderboardPeriod, periodDates, shiftedPeriodAnchor } from "@/src/domain/leaderboard";
import { memberDisplayName } from "@/src/domain/members";
import { buildGroupRecapFeed, buildRecapStories, RecapFeedItem, RecapScope } from "@/src/domain/recaps";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";

type FeedFilter = "all" | "logs" | "wins" | "badges";
const feedFilters: { id: FeedFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "logs", label: "Logs" },
  { id: "wins", label: "Leaderboard" },
  { id: "badges", label: "Badges" },
];

function filterFeed(items: readonly RecapFeedItem[], filter: FeedFilter) {
  if (filter === "logs") return items.filter((item) => ["log", "meal", "workout", "photo"].includes(item.kind));
  if (filter === "wins") return items.filter((item) => item.kind === "leader");
  if (filter === "badges") return items.filter((item) => item.kind === "badge");
  return items;
}

export default function RecapScreen() {
  const { state, sendMessage, updateSettings } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const params = useLocalSearchParams<{ scope?: string; highlight?: string; period?: string; anchor?: string }>();
  const scope: RecapScope = params.scope === "personal" ? "personal" : "group";
  const [period, setPeriod] = useState<LeaderboardPeriod>((params.period as LeaderboardPeriod) || "week");
  const [anchor, setAnchor] = useState(params.anchor || dateKey());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [highlightedItemId, setHighlightedItemId] = useState(params.highlight);
  const scrollRef = useRef<ScrollView>(null);
  const feedY = useRef(0);
  const itemY = useRef(new Map<string, number>());
  const dateNavigatorOpen = state.settings.recapDateNavigatorCollapsed === false;
  const dates = useMemo(
    () => periodDates(period, anchor, state.settings.weekStartsOn ?? 1),
    [anchor, period, state.settings.weekStartsOn],
  );
  const challengeCloud = useGroupChallenges(state.group.id);
  const badges = useMemo(
    () => buildBadges(state, anchor, challengeCloud.challenges),
    [anchor, challengeCloud.challenges, state],
  );
  const feed = useMemo(() => buildGroupRecapFeed(state, dates, badges), [badges, dates, state]);
  const visibleFeed = useMemo(() => filterFeed(feed, filter), [feed, filter]);
  const targets = useMemo(() => visibleFeed.map((item) => item.socialTarget), [visibleFeed]);
  const social = useGroupSocialEngagement(state.group.id, targets);
  const personalStories = useMemo(() => buildRecapStories(state, "personal", anchor), [anchor, state]);

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
    if (!params.highlight || !visibleFeed.length) return;
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
  }, [params.highlight, visibleFeed]);

  if (scope === "personal") {
    return (
      <Screen scrollRef={scrollRef}>
        <PageHeader eyebrow="Your momentum" title="Personal recap" subtitle="What moved this week and where the next win is." showMenu={false} action={<IconButton icon="close" label="Close" onPress={() => router.back()} />} />
        <View style={styles.storyGrid}>
          {personalStories.map((story) => (
            <Card key={story.id} style={[styles.storyCard, { borderLeftColor: story.color }]}>
              <View style={[styles.storyIcon, { backgroundColor: `${story.color}20` }]}>
                <Ionicons name={story.icon as keyof typeof Ionicons.glyphMap} size={20} color={story.color} />
              </View>
              <View style={styles.copy}>
                <Text style={[styles.eyebrow, { color: story.color }]}>{story.eyebrow}</Text>
                <Text style={[styles.storyTitle, { color: colors.ink }]}>{story.title}</Text>
                <Text style={[styles.storyStat, { color: colors.ink }]}>{story.stat}</Text>
                <Text style={[styles.body, { color: colors.muted }]}>{story.body}</Text>
              </View>
            </Card>
          ))}
        </View>
      </Screen>
    );
  }

  const dateLabel = dates.length > 1
    ? `${friendlyDate(dates[0])} – ${friendlyDate(dates[dates.length - 1])}`
    : friendlyDate(dates[0] ?? anchor);
  return (
    <Screen scrollRef={scrollRef}>
      <PageHeader eyebrow={state.group.name} translateEyebrow={false} title="Group recap" subtitle="The meaningful moments—not a stream of background samples." showMenu={false} action={<IconButton icon="close" label="Close" onPress={() => router.back()} />} />
      <Card style={styles.feedSummary}>
        <View style={[styles.summaryIcon, { backgroundColor: colors.primarySoft }]}><Ionicons name="newspaper-outline" size={20} color={accent} /></View>
        <View style={styles.copy}>
          <Text style={[styles.summaryTitle, { color: colors.ink }]}>The group story</Text>
          <Text style={[styles.body, { color: colors.muted }]}>{visibleFeed.length} meaningful update{visibleFeed.length === 1 ? "" : "s"} · {dateLabel}</Text>
        </View>
      </Card>
      <PeriodChoiceBar period={period} onChange={choosePeriod} dateViewOpen={dateNavigatorOpen} onToggleDateView={toggleDateNavigator} />
      {period !== "overall" && dateNavigatorOpen ? (
        <DateRangeNavigator period={period} anchor={anchor} dates={dates} calendarOpen={calendarOpen} onToggleCalendar={() => setCalendarOpen((value) => !value)} onShift={shiftRange}>
          <MonthCalendar monthDate={anchor} selectedDate={anchor} onMonthChange={setAnchor} onSelect={(date) => { setAnchor(date); setPeriod("custom"); setCalendarOpen(false); }} />
        </DateRangeNavigator>
      ) : null}
      <View style={styles.filterRow}>{feedFilters.map((item) => <Chip key={item.id} label={item.label} selected={filter === item.id} onPress={() => setFilter(item.id)} />)}</View>
      {social.error ? <Card style={styles.notice}><Ionicons name="cloud-offline-outline" size={16} color={colors.muted} /><Text style={[styles.body, { color: colors.muted }]}>Reactions will retry when the group reconnects.</Text></Card> : null}
      <View
        onLayout={(event) => {
          feedY.current = event.nativeEvent.layout.y;
        }}
        style={styles.feed}
      >
        {visibleFeed.map((item) => (
          <FeedCard
            key={item.id}
            item={item}
            highlighted={highlightedItemId === item.id}
            onLayout={(y) => itemY.current.set(item.id, y)}
            reactions={social.reactionsByTarget.get(social.targetKey(item.socialTarget)) ?? []}
            comments={social.commentsByTarget.get(social.targetKey(item.socialTarget)) ?? []}
            onReact={(reaction) => void social.react(item.socialTarget, reaction)}
            onComment={(content) => social.comment(item.socialTarget, content)}
            onDeleteComment={social.removeComment}
            onShare={() => sendMessage(`Shared from Group recap: ${item.title}\nhabhub://recap?scope=group&highlight=${encodeURIComponent(item.id)}`)}
          />
        ))}
      </View>
      {!visibleFeed.length ? <Card style={styles.empty}><Ionicons name="sparkles-outline" size={26} color={accent} /><Text style={[styles.summaryTitle, { color: colors.ink }]}>Nothing meaningful to recap yet</Text><Text style={[styles.body, { color: colors.muted }]}>Shared meals, workouts, photos, badges, and daily leaders will appear here.</Text></Card> : null}
    </Screen>
  );
}

type SocialHook = ReturnType<typeof useGroupSocialEngagement>;

function FeedCard({ item, highlighted, onLayout, reactions, comments, onReact, onComment, onDeleteComment, onShare }: {
  item: RecapFeedItem;
  highlighted: boolean;
  onLayout: (y: number) => void;
  reactions: SocialHook["reactions"];
  comments: SocialHook["comments"];
  onReact: (reaction: GroupSocialReactionKind) => void;
  onComment: (content: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onShare: () => void;
}) {
  const { state } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const member = item.memberId ? state.group.members.find((entry) => entry.id === item.memberId) : undefined;
  const counts = (reaction: GroupSocialReactionKind) => reactions.filter((candidate) => candidate.reaction === reaction).length;
  const mine = reactions.find((reaction) => reaction.userId === state.currentUserId);
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
          <ReactionButton icon="thumbs-up" count={counts("thumbs_up")} active={mine?.reaction === "thumbs_up"} color={accent} onPress={() => onReact("thumbs_up")} />
          <ReactionButton icon="thumbs-down" count={counts("thumbs_down")} active={mine?.reaction === "thumbs_down"} color="#D87C42" onPress={() => onReact("thumbs_down")} />
          <Pressable onPress={() => setCommentsOpen((value) => !value)} style={styles.actionButton}><Ionicons name="chatbubble-outline" size={15} color={colors.muted} /><Text style={[styles.actionText, { color: colors.muted }]}>{comments.length || "Comment"}</Text></Pressable>
          <Pressable onPress={onShare} style={styles.actionButton}><Ionicons name="paper-plane-outline" size={15} color={colors.muted} /><Text style={[styles.actionText, { color: colors.muted }]}>Share</Text></Pressable>
        </View>
        {commentsOpen ? <View style={[styles.comments, { borderTopColor: colors.border }]}>
          {comments.map((comment) => { const author = state.group.members.find((entry) => entry.id === comment.userId); return <View key={comment.id} style={styles.commentRow}><View style={styles.copy}><Text style={[styles.commentAuthor, { color: colors.ink }]}>{author ? memberDisplayName(state, author) : "Member"}</Text><Text style={[styles.commentText, { color: colors.muted }]}>{comment.content}</Text></View>{comment.userId === state.currentUserId ? <IconButton icon="trash-outline" label="Delete comment" onPress={() => void onDeleteComment(comment.id)} /> : null}</View>; })}
          <View style={styles.commentComposer}><TextInput value={draft} onChangeText={setDraft} placeholder="Add a comment" placeholderTextColor={colors.faint} style={[styles.commentInput, { color: colors.ink, borderColor: colors.border, backgroundColor: colors.canvas }]} /><IconButton icon="send" label="Post comment" onPress={() => { const content = draft.trim(); if (!content) return; setDraft(""); void onComment(content).catch(() => setDraft(content)); }} /></View>
        </View> : null}
      </Card>
    </View>
  );
}

function ReactionButton({ icon, count, active, color, onPress }: { icon: "heart" | "thumbs-up" | "thumbs-down"; count: number; active: boolean; color: string; onPress: () => void }) {
  const colors = useAppColors();
  const outline = `${icon}-outline` as keyof typeof Ionicons.glyphMap;
  return <Pressable onPress={onPress} style={[styles.actionButton, active && { backgroundColor: `${color}18` }]}><Ionicons name={active ? icon : outline} size={15} color={active ? color : colors.muted} />{count ? <Text style={[styles.actionText, { color: active ? color : colors.muted }]}>{count}</Text> : null}</Pressable>;
}

const styles = StyleSheet.create({
  copy: { flex: 1, minWidth: 0 },
  feedSummary: { flexDirection: "row", alignItems: "center", gap: 10, padding: 11, marginBottom: 8 },
  summaryIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
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
  commentRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  commentAuthor: { fontSize: 8, fontWeight: "900" }, commentText: { fontSize: 9, lineHeight: 13, marginTop: 1 },
  commentComposer: { flexDirection: "row", alignItems: "center", gap: 6 },
  commentInput: { flex: 1, minHeight: 38, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, fontSize: 10 },
  empty: { alignItems: "center", gap: 6, padding: 24 },
  storyGrid: { gap: 9 },
  storyCard: { minHeight: 112, borderLeftWidth: 4, flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12 },
  storyIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  storyTitle: { fontSize: 12, fontWeight: "900", marginTop: 2 }, storyStat: { fontSize: 18, fontWeight: "900", marginTop: 5 },
});
