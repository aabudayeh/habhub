import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useState } from 'react';
import { ImageStyle, Modal, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { AppText as Text } from "@/src/components/AppText";

import { palette } from '@/src/theme';
import { PhotoUpdate } from '@/src/types';

export function ExpandableImage({ uri, thumbnailStyle, containerStyle, label = 'Open full-size image', caption }: { uri: PhotoUpdate['uri']; thumbnailStyle?: StyleProp<ImageStyle>; containerStyle?: StyleProp<ViewStyle>; label?: string; caption?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={label} onPress={() => setOpen(true)} style={[styles.thumbnailButton, containerStyle]}>
      <Image source={typeof uri === 'string' ? { uri } : uri} style={[styles.thumbnail, thumbnailStyle]} contentFit="cover" transition={120} />
      <View style={styles.expandBadge}><Ionicons name="expand-outline" size={13} color={palette.white} /></View>
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <Pressable onPress={() => setOpen(false)} style={styles.backdrop}>
        <Pressable onPress={(event) => event.stopPropagation()} style={styles.fullWrap}>
          <Image source={typeof uri === 'string' ? { uri } : uri} style={styles.fullImage} contentFit="contain" transition={120} />
          {caption ? <Text style={styles.caption}>{caption}</Text> : null}
          <Pressable onPress={() => setOpen(false)} accessibilityLabel="Close image" style={styles.close}><Ionicons name="close" size={23} color={palette.white} /></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  thumbnailButton: { position: 'relative', alignSelf: 'flex-start' },
  thumbnail: { width: 92, height: 92, borderRadius: 14, backgroundColor: palette.border },
  expandBadge: { position: 'absolute', right: 6, bottom: 6, width: 25, height: 25, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#17211BCC' },
  backdrop: { flex: 1, backgroundColor: '#000000D9', alignItems: 'center', justifyContent: 'center', padding: 18 },
  fullWrap: { width: '100%', maxWidth: 900, height: '88%', alignItems: 'center', justifyContent: 'center' },
  fullImage: { width: '100%', height: '100%', borderRadius: 16 },
  caption: { position: 'absolute', left: 16, right: 58, bottom: 14, color: palette.white, fontSize: 12, lineHeight: 18, fontWeight: '700', backgroundColor: '#00000099', padding: 10, borderRadius: 10 },
  close: { position: 'absolute', right: 10, top: 10, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000099' },
});
