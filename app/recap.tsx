import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Screen } from '@/src/components/ui';
import { buildRecapStories, RecapScope } from '@/src/domain/recaps';
import { useApp } from '@/src/state/AppProvider';
import { palette, shadow } from '@/src/theme';

export default function RecapScreen() {
  const { state } = useApp();
  const params = useLocalSearchParams<{ scope?: string }>();
  const scope: RecapScope = params.scope === 'group' ? 'group' : 'personal';
  const stories = useMemo(() => buildRecapStories(state, scope), [scope, state]);
  const [index, setIndex] = useState(0);
  const story = stories[index];

  function previous() {
    if (index === 0) return router.back();
    setIndex((value) => value - 1);
  }

  function next() {
    if (index >= stories.length - 1) return router.back();
    setIndex((value) => value + 1);
  }

  if (!story) return null;
  return <Screen contentContainerStyle={styles.screen}>
    <View style={styles.topRow}>
      <View style={styles.progress}>{stories.map((item, itemIndex) => <View key={item.id} style={[styles.segment, itemIndex <= index && styles.segmentActive]} />)}</View>
      <Pressable onPress={() => router.back()} accessibilityLabel="Close recap" style={styles.close}><Ionicons name="close" size={22} color={palette.ink} /></Pressable>
    </View>
    <Text style={styles.heading}>{scope === 'group' ? 'Group recap' : 'Your recap'} · {index + 1} of {stories.length}</Text>
    <Card style={[styles.story, { backgroundColor: story.color, borderColor: story.color }]}>
      <View style={styles.icon}><Ionicons name={story.icon as keyof typeof Ionicons.glyphMap} size={38} color={palette.white} /></View>
      <View style={styles.storyCopy}>
        <Text style={styles.eyebrow}>{story.eyebrow}</Text>
        <Text style={styles.title}>{story.title}</Text>
        <Text style={styles.stat}>{story.stat}</Text>
        <Text style={styles.body}>{story.body}</Text>
      </View>
      <Text style={styles.brand}>PACEBOARD</Text>
    </Card>
    <View style={styles.actions}>
      <Pressable onPress={previous} style={styles.action}><Ionicons name="arrow-back" size={18} color={palette.ink} /><Text style={styles.actionText}>{index === 0 ? 'Close' : 'Back'}</Text></Pressable>
      <Pressable onPress={next} style={[styles.action, styles.next]}><Text style={styles.nextText}>{index === stories.length - 1 ? 'Done' : 'Next'}</Text><Ionicons name={index === stories.length - 1 ? 'checkmark' : 'arrow-forward'} size={18} color={palette.white} /></Pressable>
    </View>
    <Text style={styles.note}>Recaps refresh and reshuffle daily. Values are estimates based on logged data.</Text>
  </Screen>;
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, justifyContent: 'center', paddingVertical: 24 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progress: { flex: 1, flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: palette.border },
  segmentActive: { backgroundColor: palette.ink },
  close: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.card },
  heading: { color: palette.muted, fontSize: 11, fontWeight: '800', marginTop: 12, marginBottom: 10 },
  story: { minHeight: 510, borderRadius: 30, padding: 26, justifyContent: 'space-between', ...shadow },
  icon: { width: 66, height: 66, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF26' },
  storyCopy: { marginVertical: 30 },
  eyebrow: { color: '#FFFFFFCC', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  title: { color: palette.white, fontSize: 31, lineHeight: 37, fontWeight: '900', marginTop: 12 },
  stat: { color: palette.white, fontSize: 38, lineHeight: 47, fontWeight: '900', letterSpacing: -1, marginTop: 22 },
  body: { color: '#FFFFFFE0', fontSize: 15, lineHeight: 23, fontWeight: '700', marginTop: 14 },
  brand: { color: '#FFFFFFB8', fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  action: { flex: 1, minHeight: 50, borderRadius: 16, backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  next: { backgroundColor: palette.ink, borderColor: palette.ink },
  actionText: { color: palette.ink, fontSize: 13, fontWeight: '900' },
  nextText: { color: palette.white, fontSize: 13, fontWeight: '900' },
  note: { color: palette.muted, fontSize: 9, lineHeight: 14, textAlign: 'center', marginTop: 12 },
});
