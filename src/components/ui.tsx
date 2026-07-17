import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  ScrollViewProps,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette, shadow } from '@/src/theme';

export function Screen({ children, contentContainerStyle, ...props }: ScrollViewProps) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.screen, contentContainerStyle]}
        {...props}>
        <View style={styles.content}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
  showMenu = true,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  showMenu?: boolean;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <View style={styles.headerActions}>
        {action}
        {showMenu ? <IconButton icon="menu-outline" label="Open menu" onPress={() => router.push('/menu' as never)} /> : null}
      </View>
    </View>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action}
    </View>
  );
}

export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function IconButton({
  icon,
  onPress,
  label,
  filled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label: string;
  filled?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, filled && styles.iconButtonFilled, pressed && styles.pressed]}>
      <Ionicons name={icon} size={20} color={filled ? palette.white : palette.ink} />
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${variant}`],
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? palette.white : palette.primary} />
      ) : (
        <>
          {icon ? (
            <Ionicons name={icon} size={18} color={variant === 'primary' ? palette.white : palette.primary} />
          ) : null}
          <Text style={[styles.buttonText, variant === 'primary' && styles.buttonTextPrimary]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const content = (
    <>
      {icon ? <Ionicons name={icon} size={15} color={selected ? palette.primary : palette.muted} /> : null}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </>
  );
  if (!onPress) return <View style={[styles.chip, selected && styles.chipSelected]}>{content}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

export function Avatar({ initials, color, size = 42, uri }: { initials: string; color: string; size?: number; uri?: string }) {
  return (
    <View style={[styles.avatar, { backgroundColor: color, width: size, height: size, borderRadius: size / 2 }]}> 
      {uri ? <Image source={{ uri }} style={{ width:size, height:size }} contentFit="cover" /> : <Text style={[styles.avatarText, { fontSize: size * 0.32 }]}>{initials}</Text>}
    </View>
  );
}

export function ProgressBar({ progress, color = palette.primary }: { progress: number; color?: string }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { backgroundColor: color, width: `${Math.min(Math.max(progress, 0), 1) * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.canvas },
  screen: { paddingHorizontal: 18, paddingBottom: 120 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingTop: 16, marginBottom: 24 },
  headerCopy: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrow: { color: palette.primary, textTransform: 'uppercase', letterSpacing: 1.5, fontSize: 11, fontWeight: '800', marginBottom: 6 },
  title: { color: palette.ink, fontSize: 30, lineHeight: 35, fontWeight: '800', letterSpacing: -0.8 },
  subtitle: { color: palette.muted, fontSize: 15, lineHeight: 21, marginTop: 6 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 12 },
  sectionTitle: { color: palette.ink, fontSize: 18, fontWeight: '800', letterSpacing: -0.25 },
  card: { backgroundColor: palette.card, borderRadius: 22, borderWidth: 1, borderColor: palette.border, padding: 18, ...shadow },
  iconButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border, alignItems: 'center', justifyContent: 'center' },
  iconButtonFilled: { backgroundColor: palette.primary, borderColor: palette.primary },
  button: { minHeight: 48, paddingHorizontal: 18, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1 },
  button_primary: { backgroundColor: palette.primary, borderColor: palette.primary },
  button_secondary: { backgroundColor: palette.primarySoft, borderColor: palette.primarySoft },
  button_ghost: { backgroundColor: 'transparent', borderColor: palette.border },
  button_danger: { backgroundColor: '#FFF1F0', borderColor: '#F3C6C3' },
  buttonText: { color: palette.primary, fontSize: 15, fontWeight: '800' },
  buttonTextPrimary: { color: palette.white },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  chip: { minHeight: 36, paddingHorizontal: 13, borderRadius: 18, backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  chipSelected: { backgroundColor: palette.primarySoft, borderColor: '#B9DFC9' },
  chipText: { color: palette.muted, fontSize: 13, fontWeight: '700' },
  chipTextSelected: { color: palette.primary },
  avatar: { alignItems: 'center', justifyContent: 'center', overflow:'hidden' },
  avatarText: { color: palette.white, fontWeight: '800' },
  progressTrack: { height: 7, borderRadius: 4, backgroundColor: '#EBEFEB', overflow: 'hidden' },
  progressFill: { height: 7, borderRadius: 4 },
});
