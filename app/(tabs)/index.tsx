import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { MetricCard } from '@/src/components/MetricCard';
import { Avatar, Card, PageHeader, ProgressBar, Screen, SectionHeader } from '@/src/components/ui';
import { dateKey } from '@/src/domain/date';
import { memberDisplayName } from '@/src/domain/members';
import {
  dailyScore,
  effectiveGoalTarget,
  formatMetricValue,
  goalProgress,
  goalRemainingLabel,
  latestTextValue,
  rankedMembers,
  safeMetricValue,
  trackedGoalSummary,
  weeklyDeficitBalance,
} from '@/src/domain/metrics';
import { useApp } from '@/src/state/AppProvider';
import { useHealthSync } from '@/src/health/HealthSyncProvider';
import { palette } from '@/src/theme';
import { MetricDefinition } from '@/src/types';

const scoreMetric: MetricDefinition = {
  id: '__score', name: 'Overall score', icon: 'speedometer-outline', color: '#6A5ACD', unit: 'pts', dataType: 'calculated',
  aggregation: 'average', rankingDirection: 'higher', goal: { kind: 'at_least', target: 100 }, scoreWeight: 0,
  defaultVisibility: 'group', sections: { today: true, group: true, insights: true }, order: -1, activeFrom: '2000-01-01',
};

export default function TodayScreen() {
  const { state } = useApp();
  const health = useHealthSync();
  const today = dateKey();
  const user = state.group.members.find((member) => member.id === state.currentUserId)!;
  const featuredMetric = state.settings.featuredTodayCard === 'score'
    ? undefined
    : state.metrics.find((metric) => metric.id === state.settings.featuredTodayCard && metric.sections.today);
  const metrics = [...state.metrics]
    .filter((metric) => metric.sections.today && metric.activeFrom <= today && metric.id !== featuredMetric?.id)
    .sort((a, b) => a.order - b.order);
  const score = dailyScore(state, state.currentUserId, today);
  const scoreRanks = useMemo(
    () => state.group.members.map((member) => ({ member, value: dailyScore(state, member.id, today) })).sort((a, b) => b.value - a.value),
    [state, today],
  );
  const scoreRank = scoreRanks.findIndex((row) => row.member.id === state.currentUserId) + 1;
  const scoreAbove = scoreRank > 1 ? scoreRanks[scoreRank - 2] : undefined;
  const scoreRankLabel = scoreRank === 1
    ? '#1 in your group'
    : scoreAbove
      ? `#${scoreRank} · ${Math.round(scoreAbove.value - score)} pts behind #${scoreRank - 1} ${memberDisplayName(state, scoreAbove.member)}`
      : undefined;
  const weeklyBalance = weeklyDeficitBalance(state, state.currentUserId, today);
  const heroRows = featuredMetric ? rankedMembers(state, featuredMetric, today) : scoreRanks;
  const heroRank = heroRows.findIndex((row) => row.member.id === state.currentUserId) + 1;
  const heroValue = featuredMetric ? safeMetricValue(state, featuredMetric, state.currentUserId, today) : score;
  const heroGoal = featuredMetric ? effectiveGoalTarget(state, featuredMetric, state.currentUserId, today) : 100;
  const heroAbove = heroRank > 1 ? heroRows[heroRank - 2] : undefined;
  const goals = trackedGoalSummary(state, state.currentUserId, today);
  const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());

  function rankText(metric: MetricDefinition) {
    if (metric.dataType === 'text' || metric.defaultVisibility === 'private' || metric.scoreWeight <= 0) return undefined;
    const rows = rankedMembers(state, metric, today);
    const rank = rows.findIndex((row) => row.member.id === state.currentUserId) + 1;
    const above = rank > 1 ? rows[rank - 2] : undefined;
    if (!rank) return undefined;
    if (!above) return '#1 in your group';
    const gap = Math.abs(above.value - safeMetricValue(state, metric, state.currentUserId, today));
    return `#${rank} · ${formatMetricValue(metric, gap)} behind #${rank - 1} ${memberDisplayName(state, above.member)}`;
  }

  return <Screen refreshControl={<RefreshControl refreshing={health.status === 'syncing'} onRefresh={() => health.syncNow('pull').catch(() => undefined)} tintColor={palette.primary} colors={[palette.primary]} />}>
    <PageHeader eyebrow={dateLabel} title={`Good to see you, ${memberDisplayName(state, user)}.`} subtitle="Your goals, rank, and reporting—all in one place." />
    <Card style={styles.hero}>
      <View style={styles.goalLine}>
        <Ionicons name={goals.allMet ? 'trophy' : 'checkmark-done-outline'} size={15} color={palette.lime} />
        <Text style={styles.goalLineText}>{goals.allMet ? 'All daily goals met' : `${goals.met} of ${goals.total} daily goals met`}</Text>
      </View>
      <View style={styles.heroBody}>
        <View style={styles.heroCopy}>
          <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>{featuredMetric ? featuredMetric.name : "Today's score"}</Text></View>
          <Text style={styles.heroValue}>{featuredMetric ? formatMetricValue(featuredMetric, heroValue) : Math.round(heroValue)}</Text>
          {featuredMetric ? <Text style={styles.heroRemaining}>{goalRemainingLabel(state, featuredMetric, state.currentUserId, today)}</Text> : null}
          <Text style={styles.heroMeta}>#{heroRank || '—'} in {state.group.name}{heroAbove ? ` · ${featuredMetric ? formatMetricValue(featuredMetric, Math.abs(heroAbove.value - heroValue)) : `${Math.round(Math.abs(heroAbove.value - heroValue))} pts`} behind #${heroRank - 1} ${memberDisplayName(state, heroAbove.member)}` : ''}</Text>
          <View style={styles.heroProgress}><ProgressBar progress={featuredMetric ? goalProgress(featuredMetric, heroValue, heroGoal) : heroValue / 100} color={palette.lime} /></View>
        </View>
        <View style={styles.podium}>
          <Text style={styles.podiumLabel}>CURRENT LEADERS</Text>
          {heroRows.slice(0, 3).map((row, index) => <View key={row.member.id} style={[styles.leaderAvatar, index > 0 && styles.overlap]}><Avatar initials={row.member.initials} color={row.member.color} uri={row.member.avatarUri} size={38} /><View style={styles.rankBadge}><Text style={styles.rankBadgeText}>{index + 1}</Text></View></View>)}
        </View>
      </View>
    </Card>
    <SectionHeader title="Your metrics" action={<Pressable onPress={() => router.push('/customize?tab=today')} style={styles.textAction}><Ionicons name="options-outline" size={16} color={palette.primary} /><Text style={styles.textActionLabel}>Customize goals</Text></Pressable>} />
    <View style={styles.grid}>
      {featuredMetric ? <MetricCard metric={scoreMetric} value={score} rankLabel={scoreRankLabel} onPress={() => router.push('/group')} /> : null}
      <WeeklyBalanceCard balance={weeklyBalance.balance} actual={weeklyBalance.actual} target={weeklyBalance.target} days={weeklyBalance.days} />
      {metrics.map((metric) => {
        const value = safeMetricValue(state, metric, state.currentUserId, today);
        return <MetricCard
          key={metric.id}
          metric={metric}
          value={value}
          displayText={metric.dataType === 'text' ? latestTextValue(state, metric.id, state.currentUserId, today) : undefined}
          goalTarget={effectiveGoalTarget(state, metric, state.currentUserId, today)}
          remainingLabel={metric.dataType === 'text' || metric.dataType === 'photo' ? undefined : goalRemainingLabel(state, metric, state.currentUserId, today)}
          rankLabel={rankText(metric)}
          onPress={metric.dataType === 'calculated' || metric.dataType === 'photo' ? undefined : () => router.push({ pathname: '/log', params: { metric: metric.id } })}
        />;
      })}
    </View>
  </Screen>;
}

function WeeklyBalanceCard({ balance, actual, target, days }: { balance: number; actual: number; target: number; days: number }) {
  const ahead = balance >= 0;
  const weekday = new Date().getDay();
  const daysRemaining = 7 - ((weekday + 6) % 7);
  const dailyCatchUp = Math.ceil(Math.abs(balance) / Math.max(daysRemaining, 1));
  return <Card style={styles.balanceCard}>
    <View style={styles.balanceTop}><View style={styles.balanceIcon}><Ionicons name="calendar-number-outline" size={21} color={palette.purple} /></View><View style={[styles.balancePill, ahead ? styles.aheadPill : styles.behindPill]}><Text style={[styles.balancePillText, ahead ? styles.aheadText : styles.behindText]}>{ahead ? 'Ahead' : 'Catch up'}</Text></View></View>
    <Text style={styles.balanceName}>Weekly deficit balance</Text>
    <Text style={styles.balanceValue}>{Math.round(Math.abs(balance)).toLocaleString()} kcal</Text>
    <Text style={styles.balanceCopy}>{ahead ? 'available as flexibility while staying on this week’s plan' : `short of plan · about ${dailyCatchUp.toLocaleString()} kcal/day across ${daysRemaining} remaining day${daysRemaining === 1 ? '' : 's'}`}</Text>
    <Text style={styles.balanceMeta}>{Math.round(actual).toLocaleString()} actual / {Math.round(target).toLocaleString()} target through {days} day{days === 1 ? '' : 's'}</Text>
  </Card>;
}

const styles = StyleSheet.create({
  hero: { backgroundColor: palette.ink, borderColor: palette.ink, minHeight: 205, marginBottom: 24, overflow: 'hidden' },
  goalLine: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#354039' },
  goalLineText: { color: '#E5EBE6', fontSize: 11, fontWeight: '900' },
  heroBody: { flex: 1, flexDirection: 'row' },
  heroCopy: { flex: 1, justifyContent: 'center' },
  livePill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#2B362F', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.lime },
  liveText: { color: '#D8E1DA', fontSize: 11, fontWeight: '800' },
  heroValue: { color: palette.white, fontSize: 38, lineHeight: 47, fontWeight: '900', letterSpacing: -1.3, marginTop: 8 },
  heroRemaining: { color: palette.lime, fontSize: 10, lineHeight: 15, fontWeight: '800', marginBottom: 2 },
  heroMeta: { color: '#AFBAB2', fontSize: 11, lineHeight: 16, fontWeight: '700' },
  heroProgress: { marginTop: 14, maxWidth: 230 },
  podium: { width: 106, justifyContent: 'center', alignItems: 'flex-end' },
  podiumLabel: { color: '#AFBAB2', fontSize: 8, fontWeight: '800', marginBottom: 9 },
  leaderAvatar: { position: 'relative' },
  overlap: { marginTop: -8 },
  rankBadge: { position: 'absolute', right: -4, bottom: -1, width: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.lime, borderWidth: 2, borderColor: palette.ink },
  rankBadgeText: { color: palette.ink, fontSize: 8, fontWeight: '900' },
  textAction: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7 },
  textActionLabel: { color: palette.primary, fontSize: 12, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
  balanceCard: { width: '48.3%', minWidth: 155, padding: 16 },
  balanceTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  balanceIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#7756D918' },
  balancePill: { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 4 },
  aheadPill: { backgroundColor: palette.primarySoft },
  behindPill: { backgroundColor: '#FDEBE8' },
  balancePillText: { fontSize: 9, fontWeight: '900' },
  aheadText: { color: palette.primary },
  behindText: { color: palette.red },
  balanceName: { color: palette.muted, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  balanceValue: { color: palette.ink, fontSize: 22, lineHeight: 28, fontWeight: '800' },
  balanceCopy: { color: palette.muted, fontSize: 9, lineHeight: 14, fontWeight: '700', marginTop: 4 },
  balanceMeta: { color: palette.faint, fontSize: 8, lineHeight: 12, marginTop: 7 },
});
