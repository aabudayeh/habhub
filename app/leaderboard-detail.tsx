import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { ExpandableImage } from '@/src/components/ExpandableImage';
import { MetricSelector } from '@/src/components/MetricSelector';
import { MonthCalendar } from '@/src/components/MonthCalendar';
import { Avatar, Button, Card, Chip, IconButton, PageHeader, ProgressBar, Screen } from '@/src/components/ui';
import { dateKey, friendlyDate } from '@/src/domain/date';
import { leaderboardRows, LeaderboardPeriod, periodDates, periodTitle } from '@/src/domain/leaderboard';
import { memberDisplayName, memberOriginalLabel, memberRoleLabel } from '@/src/domain/members';
import { imageSourceUri } from '@/src/domain/media';
import { deficitRealityCheckAtDate, formatMetricValue } from '@/src/domain/metrics';
import { useApp } from '@/src/state/AppProvider';
import { palette } from '@/src/theme';
import { AppState, MetricEntry, PhotoUpdate } from '@/src/types';

const SCORE_ID = '__score';

export default function LeaderboardDetail() {
  const params = useLocalSearchParams<{ period?: string; anchor?: string; metrics?: string }>();
  const { state } = useApp();
  const [period, setPeriod] = useState<LeaderboardPeriod>((params.period as LeaderboardPeriod) || 'today');
  const [anchor, setAnchor] = useState(params.anchor || dateKey());
  const [showCalendar, setShowCalendar] = useState(false);
  const [openLogs, setOpenLogs] = useState<Record<string, boolean>>({});
  const dates = useMemo(() => periodDates(period, anchor), [anchor, period]);
  const visibleEntries = state.entries.filter((entry) => dates.includes(entry.localDate) && (entry.userId === state.currentUserId || entry.visibility === 'group'));
  const loggedIds = [...new Set(visibleEntries.map((entry) => entry.metricId))];
  const loggedKey = loggedIds.join('|');
  const available = state.metrics.filter((metric) => loggedIds.includes(metric.id) && metric.dataType !== 'photo');
  const requested = (params.metrics || '').split(',').filter(Boolean);
  const requestedAvailable = requested.filter((id) => id === SCORE_ID || loggedIds.includes(id));
  const [selectedIds, setSelectedIds] = useState<string[]>(requestedAvailable.length ? requestedAvailable : loggedIds.length ? loggedIds : [SCORE_ID]);

  useEffect(() => {
    const currentLogged = loggedKey.split('|').filter(Boolean);
    setSelectedIds((current) => {
      const valid = current.filter((id) => id === SCORE_ID || currentLogged.includes(id));
      return valid.length ? valid : currentLogged.length ? currentLogged : [SCORE_ID];
    });
  }, [loggedKey]);

  const metrics = available.filter((metric) => selectedIds.includes(metric.id));
  const rankingMetrics = metrics.filter((metric) => metric.dataType !== 'text');
  const includeScore = selectedIds.includes(SCORE_ID);
  const rows = leaderboardRows(state, rankingMetrics, dates, state.currentUserId, includeScore);
  const options = [
    { id: SCORE_ID, label: 'Overall score', icon: 'speedometer-outline' as const, color: palette.purple },
    ...available.map((metric) => ({ id: metric.id, label: metric.name, icon: metric.icon as keyof typeof Ionicons.glyphMap, color: metric.color })),
  ];

  function setRange(next: LeaderboardPeriod) {
    setPeriod(next);
    if (next === 'today') setAnchor(dateKey());
    setShowCalendar(next === 'custom');
  }

  return <Screen>
    <PageHeader eyebrow="Leaderboard details" title={periodTitle(period, anchor)} subtitle="Only shared values and your own private data appear." showMenu={false} action={<IconButton icon="close" label="Close" onPress={() => router.back()} />} />
    <View style={styles.filters}><Chip label="Today" selected={period === 'today'} onPress={() => setRange('today')} /><Chip label="Yesterday" selected={period === 'yesterday'} onPress={() => setRange('yesterday')} /><Chip label="7 days" selected={period === 'week'} onPress={() => setRange('week')} /><Chip label="Month" selected={period === 'month'} onPress={() => setRange('month')} /><Chip label="One day" icon="calendar-outline" selected={period === 'custom'} onPress={() => setRange('custom')} /></View>
    {period === 'custom' ? <Card style={styles.datePicker}><Pressable onPress={() => setShowCalendar((value) => !value)} style={styles.dateButton}><Ionicons name="calendar-outline" size={18} color={palette.primary} /><Text style={styles.dateText}>{friendlyDate(anchor)}</Text><Ionicons name={showCalendar ? 'chevron-up' : 'chevron-down'} size={18} color={palette.muted} /></Pressable>{showCalendar ? <MonthCalendar monthDate={anchor} selectedDate={anchor} onSelect={(date) => { setAnchor(date); setShowCalendar(false); }} onMonthChange={setAnchor} /> : null}</Card> : null}
    <MetricSelector title="Filter this view" items={options} selectedIds={selectedIds} onChange={setSelectedIds} emptyLabel="No shared logs in this range" />
    <View style={styles.range}><Ionicons name="calendar-outline" size={15} color={palette.primary} /><Text style={styles.rangeText}>{dates[0]} → {dates[dates.length - 1]} · {dates.length} day{dates.length === 1 ? '' : 's'}</Text></View>
    <View style={styles.members}>{rows.map((row, index) => {
      const entries = visibleEntries.filter((entry) => entry.userId === row.member.id && metrics.some((metric) => metric.id === entry.metricId));
      const expanded = Boolean(openLogs[row.member.id]);
      const weightDay = dates.length === 1 && entries.some((entry) => entry.metricId === 'weight');
      const alignment = weightDay ? deficitRealityCheckAtDate(state, row.member.id, dates[0]) : undefined;
      return <Card key={row.member.id} style={styles.memberCard}>
        <Pressable onPress={() => router.push({ pathname: '/member/[id]', params: { id: row.member.id, period, anchor, metrics: selectedIds.join(',') } } as never)} style={styles.heading}>
          <Text style={[styles.rank, index < 3 && styles.podium]}>#{index + 1}</Text><Avatar initials={row.member.initials} color={row.member.color} uri={row.member.avatarUri} size={44} />
          <View style={styles.copy}><Text style={styles.name}>{memberDisplayName(state, row.member)}{row.member.id === state.currentUserId ? ' · You' : ''}</Text><Text style={styles.role}>{memberOriginalLabel(state, row.member) ?? memberRoleLabel(row.member)}</Text></View>
          {includeScore ? <View><Text style={styles.score}>{Math.round(row.score)}</Text><Text style={styles.scoreLabel}>score</Text></View> : null}<Ionicons name="chevron-forward" size={16} color={palette.faint} />
        </Pressable>
        {includeScore ? <ProgressBar progress={row.score / 100} color={row.member.color} /> : null}
        <View style={styles.metricList}>{row.metrics.map(({ metric, result }) => <View key={metric.id} style={styles.metric}><View style={[styles.metricIcon, { backgroundColor: `${metric.color}18` }]}><Ionicons name={metric.icon as keyof typeof Ionicons.glyphMap} size={17} color={metric.color} /></View><View style={styles.copy}><Text style={styles.metricName}>{metric.name}</Text><Text style={styles.metricSub}>{result.averageLabel ?? `${result.visibleDays} visible day${result.visibleDays === 1 ? '' : 's'}`}</Text></View><Text style={[styles.metricValue, result.mode === 'private' && styles.private]}>{result.label}</Text></View>)}</View>
        {alignment ? <View style={styles.alignment}><Ionicons name={alignment.status === 'aligned' ? 'checkmark-circle' : 'analytics-outline'} size={20} color={palette.primary} /><View style={styles.copy}><Text style={styles.logValue}>Reporting alignment</Text><Text style={styles.note}>{alignment.status === 'aligned' ? 'Scale change roughly matches the reported deficit.' : alignment.status === 'insufficient' ? 'A prior weight entry is needed.' : `Reported ${Math.round(alignment.reportedDailyDeficit)} vs scale estimate ${Math.round(alignment.actualDailyDeficit)} kcal/day.`}</Text></View></View> : null}
        {entries.length ? <View style={styles.logs}><Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setOpenLogs((current) => ({ ...current, [row.member.id]: !expanded }))} style={styles.logToggle}><Text style={styles.blockTitle}>SHARED LOGS · {entries.length}</Text><Text style={styles.logHint}>{expanded ? 'Hide' : 'Show'}</Text><Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={palette.primary} /></Pressable>{expanded ? entries.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).map((entry) => <LogRow key={entry.id} entry={entry} state={state} />) : null}</View> : null}
        <PhotoCompare state={state} memberId={row.member.id} dates={dates} />
      </Card>;
    })}</View>
  </Screen>;
}

function LogRow({ entry, state }: { entry: MetricEntry; state: AppState }) {
  const metric = state.metrics.find((item) => item.id === entry.metricId);
  if (!metric) return null;
  const value = typeof entry.value === 'string' ? entry.value : formatMetricValue(metric, entry.value === true ? 1 : entry.value === false ? 0 : Number(entry.value));
  return <View style={[styles.log, { borderLeftColor: metric.color, backgroundColor: `${metric.color}0D` }]}>
    <View style={styles.logBody}><View style={styles.logMetric}><Ionicons name={metric.icon as keyof typeof Ionicons.glyphMap} size={13} color={metric.color} /><Text style={[styles.logMetricText, { color: metric.color }]}>{metric.name}</Text></View><View style={styles.logTop}><Text style={styles.logValue}>{value}{entry.label ? ` · ${entry.label}` : ''}</Text><Text style={styles.logDate}>{friendlyDate(entry.localDate)}</Text></View>{entry.note ? <Text style={styles.note}>{entry.note}</Text> : null}{entry.nutrition ? <Text style={styles.nutrition}>{[['Protein', entry.nutrition.proteinG, 'g'], ['Carbs', entry.nutrition.carbsG, 'g'], ['Fat', entry.nutrition.fatG, 'g'], ['Fiber', entry.nutrition.fiberG, 'g'], ['Sodium', entry.nutrition.sodiumMg, 'mg']].filter((item) => item[1]).map((item) => `${item[0]} ${item[1]}${item[2]}`).join(' · ')}</Text> : null}</View>
    {entry.imageUri ? <ExpandableImage uri={entry.imageUri} thumbnailStyle={styles.logImage} /> : null}
  </View>;
}

function PhotoCompare({ state, memberId, dates }: { state: AppState; memberId: string; dates: string[] }) {
  const visible = state.photos.filter((photo) => photo.userId === memberId && (memberId === state.currentUserId || photo.visibility === 'group')).sort((a, b) => b.localDate.localeCompare(a.localDate));
  const primary = visible.find((photo) => dates.includes(photo.localDate));
  const olderDates = [...new Set(visible.filter((photo) => primary && photo.localDate < primary.localDate).map((photo) => photo.localDate))].sort().reverse();
  const primaryDate = primary?.localDate ?? '';
  const defaultOlderDate = olderDates[0] ?? '';
  const [compareDate, setCompareDate] = useState<string[]>([]);
  useEffect(() => setCompareDate(defaultOlderDate ? [defaultOlderDate] : []), [memberId, primaryDate, defaultOlderDate]);
  const comparison = visible.find((photo) => photo.localDate === compareDate[0]);
  if (!primary) return null;

  function weight(day: string) {
    const entry = state.entries.filter((item) => item.userId === memberId && item.metricId === 'weight').sort((a, b) => Math.abs(new Date(`${a.localDate}T12:00:00`).getTime() - new Date(`${day}T12:00:00`).getTime()) - Math.abs(new Date(`${b.localDate}T12:00:00`).getTime() - new Date(`${day}T12:00:00`).getTime()))[0];
    return entry ? `${Number(entry.value).toFixed(1)} kg${entry.localDate === day ? '' : ' nearby'}` : 'No weight log';
  }

  async function save() {
    const photos = [primary, comparison].filter(Boolean) as PhotoUpdate[];
    if (photos.length < 2) return;
    if (Platform.OS !== 'web') {
      await Share.share({ message: `Paceboard comparison\n${photos.map((photo) => `${photo.localDate} · ${weight(photo.localDate)}`).join('\n')}` });
      return;
    }
    try {
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 850;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
      context.fillStyle = '#F5F7F2'; context.fillRect(0, 0, 1200, 850); context.fillStyle = '#17211B'; context.font = 'bold 34px sans-serif'; context.fillText('Paceboard progress comparison', 45, 55);
      const images = await Promise.all(photos.map((photo) => new Promise<HTMLImageElement>((resolve, reject) => { const image = document.createElement('img'); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Photo unavailable')); image.src = imageSourceUri(photo.uri); })));
      images.forEach((image, index) => { const x = 45 + index * 565; context.drawImage(image, x, 90, 540, 620); context.textAlign = 'center'; context.fillStyle = '#17211B'; context.font = 'bold 23px sans-serif'; context.fillText(photos[index].localDate, x + 270, 755); context.fillStyle = '#176B4D'; context.font = 'bold 18px sans-serif'; context.fillText(weight(photos[index].localDate), x + 270, 790); });
      canvas.toBlob((blob) => { if (!blob) return; const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `paceboard-${memberId}-comparison.png`; link.click(); URL.revokeObjectURL(url); }, 'image/png');
    } catch (error) {
      Alert.alert('Could not save collage', error instanceof Error ? error.message : 'Try again.');
    }
  }

  return <View style={styles.photos}>
    <Text style={styles.blockTitle}>PROGRESS PHOTO</Text>
    <View style={styles.photoGrid}>{[primary, comparison].filter(Boolean).map((photo) => <View key={photo!.id} style={styles.photoItem}><ExpandableImage uri={photo!.uri} thumbnailStyle={styles.photo} /><Text style={styles.photoDate}>{photo!.localDate}</Text><Text style={styles.photoWeight}>{weight(photo!.localDate)}</Text></View>)}</View>
    {olderDates.length ? <MetricSelector title="Older comparison date" items={olderDates.map((day) => ({ id: day, label: day, icon: 'calendar-outline', sublabel: weight(day) }))} selectedIds={compareDate} onChange={setCompareDate} multiple={false} /> : null}
    {comparison ? <Button label={Platform.OS === 'web' ? 'Download collage' : 'Share comparison'} icon={Platform.OS === 'web' ? 'download-outline' : 'share-outline'} variant="ghost" onPress={save} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 11 }, datePicker: { padding: 10, marginBottom: 10 }, dateButton: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 4 }, dateText: { flex: 1, color: palette.ink, fontSize: 13, fontWeight: '900' }, range: { flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 13 }, rangeText: { color: palette.muted, fontSize: 10, fontWeight: '700' }, members: { gap: 11 }, memberCard: { padding: 13 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 9 }, rank: { width: 27, color: palette.faint, fontSize: 12, fontWeight: '900' }, podium: { color: palette.amber, fontSize: 15 }, copy: { flex: 1 }, name: { color: palette.ink, fontSize: 14, fontWeight: '900' }, role: { color: palette.muted, fontSize: 9, marginTop: 2 }, score: { color: palette.ink, fontSize: 18, fontWeight: '900', textAlign: 'center' }, scoreLabel: { color: palette.faint, fontSize: 8, textAlign: 'center' }, metricList: { marginTop: 9 }, metric: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: palette.border }, metricIcon: { width: 35, height: 35, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, metricName: { color: palette.ink, fontSize: 11, fontWeight: '900' }, metricSub: { color: palette.muted, fontSize: 8, marginTop: 2 }, metricValue: { color: palette.primary, fontSize: 12, fontWeight: '900' }, private: { color: palette.faint, fontStyle: 'italic' },
  alignment: { flexDirection: 'row', gap: 9, backgroundColor: palette.primarySoft, borderRadius: 13, padding: 10, marginTop: 10 }, logs: { marginTop: 12 }, logToggle: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 }, blockTitle: { flex: 1, color: palette.faint, fontSize: 9, fontWeight: '900', letterSpacing: 1 }, logHint: { color: palette.primary, fontSize: 8, fontWeight: '900', marginRight: 5 }, log: { flexDirection: 'row', gap: 8, borderRadius: 12, padding: 9, marginTop: 6, borderLeftWidth: 3 }, logBody: { flex: 1 }, logMetric: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 }, logMetricText: { fontSize: 8, fontWeight: '900', textTransform: 'uppercase' }, logTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 9 }, logValue: { flex: 1, color: palette.ink, fontSize: 11, fontWeight: '900' }, logDate: { color: palette.faint, fontSize: 8 }, note: { color: palette.muted, fontSize: 9, lineHeight: 13, marginTop: 3 }, nutrition: { color: palette.primary, fontSize: 9, fontWeight: '800', lineHeight: 13, marginTop: 4 }, logImage: { width: 64, height: 64, borderRadius: 10 },
  photos: { marginTop: 14, gap: 8 }, photoGrid: { flexDirection: 'row', gap: 8 }, photoItem: { flex: 1 }, photo: { width: 145, height: 175, borderRadius: 13 }, photoDate: { color: palette.ink, fontSize: 10, fontWeight: '900', textAlign: 'center', marginTop: 4 }, photoWeight: { color: palette.primary, fontSize: 8, fontWeight: '800', textAlign: 'center', marginTop: 2 },
});
