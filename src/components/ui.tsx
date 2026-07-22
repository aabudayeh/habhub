import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { PropsWithChildren, ReactNode, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  ScrollViewProps,
  TextInput as NativeTextInput,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";
import { AppText as Text } from "@/src/components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCloudSync } from "@/src/cloud/CloudSyncProvider";
import { useHealthSync } from "@/src/health/HealthSyncProvider";

import {
  palette,
  shadow,
  useAppColors,
  useCompactMode,
  useGroupAccent,
} from "@/src/theme";

export function Screen({
  children,
  contentContainerStyle,
  scrollRef,
  refreshControl,
  ...props
}: ScrollViewProps & { scrollRef?: React.RefObject<ScrollView | null> }) {
  const compact = useCompactMode();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const internalRef = useRef<ScrollView>(null);
  const activeRef = scrollRef ?? internalRef;
  const cloud = useCloudSync();
  const health = useHealthSync();
  useKeyboardReveal(activeRef);
  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.canvas }]}
      edges={["top"]}
    >
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          ref={activeRef}
          style={{ backgroundColor: colors.canvas }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          automaticallyAdjustKeyboardInsets
          refreshControl={
            refreshControl ?? (
              <RefreshControl
                refreshing={
                  cloud.status === "syncing" || health.status === "syncing"
                }
                onRefresh={async () => {
                  await cloud.syncNow().catch(() => undefined);
                  await cloud.refreshGroup().catch(() => undefined);
                  await health.syncNow("pull").catch(() => undefined);
                }}
                tintColor={accent}
              />
            )
          }
          contentContainerStyle={[
            styles.screen,
            compact && styles.screenCompact,
            contentContainerStyle,
          ]}
          {...props}
        >
          <View style={styles.content}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function useKeyboardReveal(
  scrollRef: React.RefObject<ScrollView | null>,
) {
  useEffect(() => {
    const subscription = Keyboard.addListener("keyboardDidShow", () => {
      const focused = NativeTextInput.State.currentlyFocusedInput?.();
      if (!focused) return;
      setTimeout(() => {
        scrollRef.current
          ?.getScrollResponder()
          ?.scrollResponderScrollNativeHandleToKeyboard(focused, 96, true);
      }, 20);
    });
    return () => subscription.remove();
  }, [scrollRef]);
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
  const accent = useGroupAccent();
  const colors = useAppColors();
  const compact = useCompactMode();
  return (
    <View style={[styles.header, compact && styles.headerCompact]}>
      <View style={styles.headerCopy}>
        {eyebrow ? (
          <Text style={[styles.eyebrow, { color: accent }]}>{eyebrow}</Text>
        ) : null}
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.78}
          style={[styles.title, { color: colors.ink }]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.headerActions}>
        {action}
        {showMenu ? (
          <IconButton
            icon="menu-outline"
            label="Open menu"
            onPress={() => router.navigate("/menu" as never)}
          />
        ) : null}
      </View>
    </View>
  );
}

export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  const compact = useCompactMode();
  const colors = useAppColors();
  return (
    <View
      style={[styles.sectionHeader, compact && styles.sectionHeaderCompact]}
    >
      <Text style={[styles.sectionTitle, { color: colors.ink }]}>{title}</Text>
      {action}
    </View>
  );
}

export function Card({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const compact = useCompactMode();
  const colors = useAppColors();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
        compact && styles.cardCompact,
        style,
      ]}
    >
      {children}
    </View>
  );
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
  const accent = useGroupAccent();
  const colors = useAppColors();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: colors.card, borderColor: colors.border },
        filled && styles.iconButtonFilled,
        filled && { backgroundColor: accent, borderColor: accent },
        pressed && styles.pressed,
      ]}
    >
      <Ionicons
        name={icon}
        size={20}
        color={filled ? palette.white : colors.ink}
      />
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  icon,
  variant = "primary",
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  loading?: boolean;
}) {
  const accent = useGroupAccent();
  const compact = useCompactMode();
  const colors = useAppColors();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        styles[`button_${variant}`],
        variant === "secondary" && {
          backgroundColor: colors.primarySoft,
          borderColor: colors.primarySoft,
        },
        variant === "ghost" && { borderColor: colors.border },
        variant === "primary" && {
          backgroundColor: accent,
          borderColor: accent,
        },
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === "primary" ? palette.white : accent}
        />
      ) : (
        <>
          {icon ? (
            <Ionicons
              name={icon}
              size={18}
              color={variant === "primary" ? palette.white : accent}
            />
          ) : null}
          <Text
            style={[
              styles.buttonText,
              {
                color:
                  variant === "primary"
                    ? palette.white
                    : variant === "danger"
                      ? palette.red
                      : accent,
              },
            ]}
          >
            {label}
          </Text>
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
  const accent = useGroupAccent();
  const compact = useCompactMode();
  const colors = useAppColors();
  const content = (
    <>
      {icon ? (
        <Ionicons
          name={icon}
          size={15}
          color={selected ? accent : colors.muted}
        />
      ) : null}
      <Text
        style={[
          styles.chipText,
          { color: colors.muted },
          selected && styles.chipTextSelected,
          selected && { color: accent },
        ]}
      >
        {label}
      </Text>
    </>
  );
  if (!onPress)
    return (
      <View
        style={[
          styles.chip,
          { backgroundColor: colors.card, borderColor: colors.border },
          compact && styles.chipCompact,
          selected && styles.chipSelected,
          selected && { backgroundColor: colors.primarySoft },
        ]}
      >
        {content}
      </View>
    );
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: colors.card, borderColor: colors.border },
        compact && styles.chipCompact,
        selected && styles.chipSelected,
        selected && { backgroundColor: colors.primarySoft },
        pressed && styles.pressed,
      ]}
    >
      {content}
    </Pressable>
  );
}

export function Avatar({
  initials,
  color,
  size = 42,
  uri,
}: {
  initials: string;
  color: string;
  size?: number;
  uri?: string;
}) {
  return (
    <View
      style={[
        styles.avatar,
        {
          backgroundColor: color,
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          contentFit="cover"
        />
      ) : (
        <Text
          preserveColor
          style={[
            styles.avatarText,
            { color: palette.white, fontSize: size * 0.32 },
          ]}
        >
          {initials}
        </Text>
      )}
    </View>
  );
}

export function ProgressBar({
  progress,
  color,
}: {
  progress: number;
  color?: string;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  return (
    <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
      <View
        style={[
          styles.progressFill,
          {
            backgroundColor: color ?? accent,
            width: `${Math.min(Math.max(progress, 0), 1) * 100}%`,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.canvas },
  screen: { paddingHorizontal: 18, paddingBottom: 120 },
  screenCompact: { paddingHorizontal: 12, paddingBottom: 90 },
  content: { width: "100%", maxWidth: 760, alignSelf: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingTop: 14,
    marginBottom: 22,
  },
  headerCompact: { paddingTop: 8, marginBottom: 13 },
  headerCopy: { flex: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  eyebrow: {
    color: palette.primary,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    fontSize: 11,
    fontWeight: "800",
    marginBottom: 6,
  },
  title: {
    color: palette.ink,
    fontSize: 28,
    lineHeight: 33,
    fontWeight: "800",
    letterSpacing: -0.6,
  },
  subtitle: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    marginBottom: 12,
  },
  sectionHeaderCompact: { marginTop: 5, marginBottom: 7 },
  sectionTitle: {
    color: palette.ink,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  card: {
    backgroundColor: palette.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 18,
    ...shadow,
  },
  cardCompact: { borderRadius: 17, padding: 12 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonFilled: {
    backgroundColor: palette.primary,
    borderColor: palette.primary,
  },
  button: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
  },
  buttonCompact: { minHeight: 40, paddingHorizontal: 13, borderRadius: 12 },
  button_primary: {
    backgroundColor: palette.primary,
    borderColor: palette.primary,
  },
  button_secondary: {
    backgroundColor: palette.primarySoft,
    borderColor: palette.primarySoft,
  },
  button_ghost: { backgroundColor: "transparent", borderColor: palette.border },
  button_danger: { backgroundColor: "#FFF1F0", borderColor: "#F3C6C3" },
  buttonText: { color: palette.primary, fontSize: 15, fontWeight: "800" },
  buttonTextPrimary: { color: palette.white },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  chip: {
    minHeight: 36,
    paddingHorizontal: 13,
    borderRadius: 18,
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  chipCompact: { minHeight: 30, paddingHorizontal: 10 },
  chipSelected: {
    backgroundColor: palette.primarySoft,
    borderColor: "#B9DFC9",
  },
  chipText: { color: palette.muted, fontSize: 13, fontWeight: "700" },
  chipTextSelected: { color: palette.primary },
  avatar: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarText: { color: palette.white, fontWeight: "800" },
  progressTrack: {
    height: 7,
    borderRadius: 4,
    backgroundColor: "#EBEFEB",
    overflow: "hidden",
  },
  progressFill: { height: 7, borderRadius: 4 },
});
