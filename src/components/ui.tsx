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
import { useTranslation } from "@/src/i18n";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useCloudSyncActions,
  useCloudSyncStatus,
} from "@/src/cloud/CloudSyncProvider";
import { useHealthSync } from "@/src/health/HealthSyncProvider";

import {
  palette,
  shadow,
  typography,
  useAppColors,
  useCompactMode,
  useGroupAccent,
} from "@/src/theme";
import { TutorialTarget } from "@/src/components/TutorialSpotlight";

export function Screen({
  children,
  contentContainerStyle,
  scrollRef,
  fixedTop,
  refreshControl,
  refreshEnabled = true,
  ...props
}: ScrollViewProps & {
  scrollRef?: React.RefObject<ScrollView | null>;
  fixedTop?: ReactNode;
  refreshEnabled?: boolean;
}) {
  const compact = useCompactMode();
  const colors = useAppColors();
  const internalRef = useRef<ScrollView>(null);
  const activeRef = scrollRef ?? internalRef;
  const insets = useSafeAreaInsets();
  const basePaddingBottom = compact ? 90 : 120;
  const userPaddingBottomRaw = StyleSheet.flatten(contentContainerStyle)?.paddingBottom;
  const userPaddingBottom =
    typeof userPaddingBottomRaw === "number" ? userPaddingBottomRaw : 0;
  const paddingBottom =
    Math.max(basePaddingBottom, userPaddingBottom ?? basePaddingBottom) +
    insets.bottom;
  useKeyboardReveal(activeRef);
  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.canvas }]}
      edges={["top", "bottom"]}
    >
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {fixedTop ? (
          <View
            style={[
              styles.fixedTop,
              compact && styles.fixedTopCompact,
              { backgroundColor: colors.canvas },
            ]}
          >
            <View style={styles.content}>{fixedTop}</View>
          </View>
        ) : null}
        <ScrollView
          ref={activeRef}
          style={{ backgroundColor: colors.canvas }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          automaticallyAdjustKeyboardInsets
          refreshControl={
            Platform.OS !== "web" && refreshEnabled
              ? refreshControl ?? (
                  <DefaultRefreshControl />
                )
              : undefined
          }
          contentContainerStyle={[
            styles.screen,
            compact && styles.screenCompact,
            { paddingBottom },
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
  action,
  showMenu = true,
  tutorialId,
  translateTitle = true,
  translateEyebrow = true,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  showMenu?: boolean;
  tutorialId?: string;
  translateTitle?: boolean;
  translateEyebrow?: boolean;
}) {
  const accent = useGroupAccent();
  const colors = useAppColors();
  const compact = useCompactMode();
  const header = (
    <View style={[styles.header, compact && styles.headerCompact]}>
      <View style={styles.headerCopy}>
        {eyebrow ? (
          <Text
            translate={translateEyebrow}
            style={[styles.eyebrow, { color: accent }]}
          >
            {eyebrow}
          </Text>
        ) : null}
        <Text
          translate={translateTitle}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.78}
          style={[
            styles.title,
            compact && styles.titleCompact,
            { color: colors.ink },
          ]}
        >
          {title}
        </Text>
      </View>
      <View style={styles.headerActions}>
        {action}
        {showMenu ? (
          <TutorialTarget id="menu-button">
          <IconButton
            icon="menu-outline"
            label="Open menu"
            onPress={() => router.navigate("/menu" as never)}
          />
          </TutorialTarget>
        ) : null}
      </View>
    </View>
  );
  return tutorialId ? (
    <TutorialTarget id={tutorialId}>{header}</TutorialTarget>
  ) : (
    header
  );
}

/**
 * Keep the large page tree out of the high-frequency cloud/health contexts.
 * Only this tiny refresh control updates while a background sync changes
 * status, so navigating and typing do not cause every Screen to re-render.
 */
function DefaultRefreshControl(
  props: Partial<React.ComponentProps<typeof RefreshControl>>,
) {
  const cloud = useCloudSyncActions();
  const cloudStatus = useCloudSyncStatus();
  const health = useHealthSync();
  const accent = useGroupAccent();
  return (
    <RefreshControl
      // Android ScrollView clones this element and injects the native scroll
      // view as its child. Forward every injected prop so page content is not
      // discarded by this context-isolating wrapper.
      {...props}
      refreshing={cloudStatus === "syncing" || health.status === "syncing"}
      onRefresh={async () => {
        await health.syncNow("pull").catch(() => undefined);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        await cloud.syncNow().catch(() => undefined);
        await cloud.refreshActivity().catch(() => undefined);
      }}
      tintColor={accent}
    />
  );
}

export function SectionHeader({
  title,
  action,
  translateTitle = true,
}: {
  title: string;
  action?: ReactNode;
  translateTitle?: boolean;
}) {
  const compact = useCompactMode();
  const colors = useAppColors();
  return (
    <View
      style={[styles.sectionHeader, compact && styles.sectionHeaderCompact]}
    >
      <Text
        translate={translateTitle}
        style={[styles.sectionTitle, { color: colors.ink }]}
      >
        {title}
      </Text>
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
  translate = true,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label: string;
  filled?: boolean;
  translate?: boolean;
}) {
  const accent = useGroupAccent();
  const colors = useAppColors();
  const t = useTranslation();
  return (
    <Pressable
      accessibilityLabel={translate ? t(label) : label}
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
  size = "default",
  disabled,
  loading,
  translate = true,
}: {
  label: string;
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "default" | "small";
  disabled?: boolean;
  loading?: boolean;
  translate?: boolean;
}) {
  const accent = useGroupAccent();
  const compact = useCompactMode();
  const colors = useAppColors();
  const t = useTranslation();
  return (
    <Pressable
      accessibilityLabel={translate ? t(label) : label}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        size === "small" && styles.buttonSmall,
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
              size={size === "small" ? 15 : 18}
              color={variant === "primary" ? palette.white : accent}
            />
          ) : null}
          <Text
            translate={translate}
            style={[
              styles.buttonText,
              size === "small" && styles.buttonTextSmall,
              {
                color:
                  variant === "primary"
                    ? palette.white
                    : variant === "danger"
                      ? palette.red
                      : accent,
              },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit={size === "small"}
            minimumFontScale={0.72}
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
  size = "default",
  translate = true,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  size?: "default" | "small";
  translate?: boolean;
}) {
  const accent = useGroupAccent();
  const compact = useCompactMode();
  const colors = useAppColors();
  const t = useTranslation();
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
        translate={translate}
        style={[
          styles.chipText,
          size === "small" && styles.chipTextSmall,
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
          size === "small" && styles.chipSmall,
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
      accessibilityLabel={translate ? t(label) : label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        size === "small" && styles.chipSmall,
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
          translate={false}
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
  layered = false,
  successColor = palette.lime,
}: {
  progress: number;
  color?: string;
  /** Keeps a completed "at least" goal full while extra target multiples refill in new shades. */
  layered?: boolean;
  successColor?: string;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const safeProgress = Math.max(0, Number.isFinite(progress) ? progress : 0);
  const completed = layered && safeProgress >= 1;
  const overflow = completed
    ? Math.min(1, Math.max(0, safeProgress - 1))
    : 0;
  const secondOverflow =
    completed && safeProgress >= 2
      ? Math.min(1, Math.max(0, safeProgress - 2))
      : 0;
  return (
    <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
      <View
        style={[
          styles.progressFill,
          {
            backgroundColor: completed ? successColor : (color ?? accent),
            width: `${Math.min(safeProgress, 1) * 100}%`,
          },
        ]}
      />
      {overflow > 0 ? (
        <View
          style={[
            styles.progressLayer,
            { backgroundColor: "#66C95E", width: `${overflow * 100}%` },
          ]}
        />
      ) : null}
      {secondOverflow > 0 ? (
        <View
          style={[
            styles.progressLayer,
            {
              backgroundColor: "#2F9E62",
              width: `${secondOverflow * 100}%`,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.canvas },
  screen: { paddingHorizontal: 18, paddingBottom: 120 },
  screenCompact: { paddingHorizontal: 12, paddingBottom: 90 },
  content: { width: "100%", maxWidth: 760, alignSelf: "center" },
  fixedTop: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 6 },
  fixedTopCompact: { paddingHorizontal: 12, paddingVertical: 4 },
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
    ...typography.eyebrow,
    marginBottom: 4,
  },
  title: {
    color: palette.ink,
    ...typography.pageTitle,
    letterSpacing: -0.35,
  },
  titleCompact: { fontSize: 18, lineHeight: 22, letterSpacing: -0.25 },
  subtitle: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  subtitleCompact: { fontSize: 10, lineHeight: 14, marginTop: 2 },
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
    ...typography.sectionTitle,
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
  buttonSmall: {
    minHeight: 34,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    gap: 5,
  },
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
  buttonText: { color: palette.primary, fontSize: 13, fontWeight: "800" },
  buttonTextSmall: { fontSize: 11 },
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
  chipSmall: { minHeight: 27, paddingHorizontal: 8, paddingVertical: 4 },
  chipSelected: {
    backgroundColor: palette.primarySoft,
    borderColor: "#B9DFC9",
  },
  chipText: { color: palette.muted, fontSize: 11, fontWeight: "800" },
  chipTextSmall: { fontSize: 9, fontWeight: "800" },
  chipTextSelected: { color: palette.primary },
  avatar: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarText: { color: palette.white, fontWeight: "800" },
  progressTrack: {
    position: "relative",
    height: 7,
    borderRadius: 4,
    backgroundColor: "#EBEFEB",
    overflow: "hidden",
  },
  progressFill: { height: 7, borderRadius: 4 },
  progressLayer: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 4,
  },
});
