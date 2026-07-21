import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from "@/src/components/AppText";

import { formatMetricValue, goalProgress, goalReached } from '@/src/domain/metrics';
import { MetricDefinition } from '@/src/types';
import { palette, shadow, useAppColors, useCompactMode, useGroupAccent } from '@/src/theme';
import { ProgressBar } from './ui';

export function MetricCard({ metric, value, displayText, rankLabel, goalTarget, remainingLabel, onPress }: { metric: MetricDefinition; value: number; displayText?: string; rankLabel?: string; goalTarget?: number; remainingLabel?: string; onPress?: () => void }) {
  const compact=useCompactMode();const colors=useAppColors();const accent=useGroupAccent();
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
      style={({ pressed }) => [styles.card,{backgroundColor:colors.card,borderColor:colors.border},compact&&styles.cardCompact, pressed && styles.pressed]}>
      <View style={[styles.topRow,compact&&styles.topRowCompact]}>
        <View style={[styles.iconWrap, { backgroundColor: `${metric.color}16` }]}>
          <Ionicons name={metric.icon as keyof typeof Ionicons.glyphMap} size={compact?17:21} color={metric.color} />
        </View>
        {metric.dataType !== 'text' ? <View style={[styles.status, reached && styles.statusReached]}>
          <Ionicons name={reached ? 'checkmark' : 'ellipse'} size={12} color={reached ? accent : colors.faint} />
          {!compact?<Text style={[styles.statusText,{color:colors.faint}, reached && {color:accent}]}>{reached ? 'Goal met' : 'In progress'}</Text>:null}
        </View> : <View style={styles.status}><Ionicons name="document-text-outline" size={13} color={palette.faint}/><Text style={styles.statusText}>Journal</Text></View>}
      </View>
      <Text style={[styles.name,{color:colors.muted},compact&&styles.nameCompact]}>{metric.name}</Text>
      <Text style={[styles.value,{color:colors.ink},compact&&styles.valueCompact]} numberOfLines={1}>{metric.dataType === 'text' ? displayText || 'No entry yet' : formatMetricValue(metric, value)}</Text>
      {remainingLabel ? <Text numberOfLines={1} style={[styles.remainingText,{color:colors.muted},compact&&styles.detailCompact]}>{remainingLabel}</Text> : null}
      {rankLabel&&!compact ? <Text style={[styles.rankText,{color:accent}]}>{rankLabel}</Text> : null}
      {metric.dataType !== 'text' ? <View style={[styles.progressRow,compact&&styles.progressRowCompact]}>
        <View style={styles.progressGrow}>
          <ProgressBar progress={progress} color={metric.color} />
        </View>
        <Text style={styles.percent}>{progressLabel}</Text>
      </View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: '48%', backgroundColor: palette.card, borderRadius: 20, borderWidth: 1, borderColor: palette.border, padding: 14, ...shadow },
  cardCompact:{width:'100%',paddingHorizontal:11,paddingVertical:8,borderRadius:14,minHeight:82},
  pressed: { opacity: 0.75, transform: [{ scale: 0.985 }] },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 16 },
  topRowCompact:{marginBottom:5},
  iconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  status: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  statusReached: { backgroundColor: palette.primarySoft, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 4 },
  statusText: { fontSize: 10, color: palette.faint, fontWeight: '700' },
  statusTextReached: { color: palette.primary },
  name: { color: palette.muted, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  value: { color: palette.ink, fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.45 },
  valueCompact:{fontSize:18,lineHeight:22},nameCompact:{fontSize:11,marginBottom:1},detailCompact:{fontSize:8,lineHeight:11,marginTop:1},
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 13 },
  progressRowCompact:{marginTop:5},
  progressGrow: { flex: 1 },
  percent: { color: palette.muted, fontSize: 10, fontWeight: '800', minWidth: 38, textAlign: 'right' },
  rankText: { color: palette.primary, fontSize: 10, fontWeight: '800', marginTop: 5 },
  remainingText: { color: palette.muted, fontSize: 10, lineHeight: 15, fontWeight: '700', marginTop: 4 },
});
