import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatMetricValue, goalProgress, goalReached } from '@/src/domain/metrics';
import { MetricDefinition } from '@/src/types';
import { palette, shadow } from '@/src/theme';
import { ProgressBar } from './ui';

export function MetricCard({ metric, value, displayText, rankLabel, goalTarget, remainingLabel, onPress }: { metric: MetricDefinition; value: number; displayText?: string; rankLabel?: string; goalTarget?: number; remainingLabel?: string; onPress?: () => void }) {
  const progress = goalProgress(metric, value, goalTarget);
  const reached = goalReached(metric, value, goalTarget);
  const progressLabel = metric.goal.kind === 'at_most'
    ? reached ? 'Within' : 'Over'
    : metric.goal.kind === 'exact'
      ? reached ? 'On goal' : value < (goalTarget ?? metric.goal.target) ? 'Under' : 'Over'
      : metric.goal.kind === 'complete'
        ? reached ? 'Done' : 'Not yet'
        : `${Math.round(progress * 100)}%`;
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.topRow}>
        <View style={[styles.iconWrap, { backgroundColor: `${metric.color}16` }]}>
          <Ionicons name={metric.icon as keyof typeof Ionicons.glyphMap} size={21} color={metric.color} />
        </View>
        {metric.dataType !== 'text' ? <View style={[styles.status, reached && styles.statusReached]}>
          <Ionicons name={reached ? 'checkmark' : 'ellipse'} size={12} color={reached ? palette.primary : palette.faint} />
          <Text style={[styles.statusText, reached && styles.statusTextReached]}>{reached ? 'Goal met' : 'In progress'}</Text>
        </View> : <View style={styles.status}><Ionicons name="document-text-outline" size={13} color={palette.faint}/><Text style={styles.statusText}>Journal</Text></View>}
      </View>
      <Text style={styles.name}>{metric.name}</Text>
      <Text style={styles.value} numberOfLines={2}>{metric.dataType === 'text' ? displayText || 'No entry yet' : formatMetricValue(metric, value)}</Text>
      {remainingLabel ? <Text style={styles.remainingText}>{remainingLabel}</Text> : null}
      {rankLabel ? <Text style={styles.rankText}>{rankLabel}</Text> : null}
      {metric.dataType !== 'text' ? <View style={styles.progressRow}>
        <View style={styles.progressGrow}>
          <ProgressBar progress={progress} color={metric.color} />
        </View>
        <Text style={styles.percent}>{progressLabel}</Text>
      </View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: '48.3%', minWidth: 155, backgroundColor: palette.card, borderRadius: 20, borderWidth: 1, borderColor: palette.border, padding: 16, ...shadow },
  pressed: { opacity: 0.75, transform: [{ scale: 0.985 }] },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 16 },
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  status: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  statusReached: { backgroundColor: palette.primarySoft, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 4 },
  statusText: { fontSize: 10, color: palette.faint, fontWeight: '700' },
  statusTextReached: { color: palette.primary },
  name: { color: palette.muted, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  value: { color: palette.ink, fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.45 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 13 },
  progressGrow: { flex: 1 },
  percent: { color: palette.muted, fontSize: 10, fontWeight: '800', minWidth: 38, textAlign: 'right' },
  rankText: { color: palette.primary, fontSize: 10, fontWeight: '800', marginTop: 5 },
  remainingText: { color: palette.muted, fontSize: 10, lineHeight: 15, fontWeight: '700', marginTop: 4 },
});
