import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import React, {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";

type TargetRect = { x: number; y: number; width: number; height: number };
type TutorialRegistry = {
  targets: Record<string, TargetRect>;
  register: (id: string, rect: TargetRect) => void;
  unregister: (id: string) => void;
};

const TutorialContext = createContext<TutorialRegistry | null>(null);

export function TutorialProvider({ children }: PropsWithChildren) {
  const [targets, setTargets] = useState<Record<string, TargetRect>>({});
  const register = useCallback((id: string, rect: TargetRect) => {
    setTargets((current) => {
      const before = current[id];
      if (
        before &&
        Math.abs(before.x - rect.x) < 1 &&
        Math.abs(before.y - rect.y) < 1 &&
        Math.abs(before.width - rect.width) < 1 &&
        Math.abs(before.height - rect.height) < 1
      )
        return current;
      return { ...current, [id]: rect };
    });
  }, []);
  const unregister = useCallback((id: string) => {
    setTargets((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);
  const value = useMemo<TutorialRegistry>(
    () => ({
      targets,
      register,
      unregister,
    }),
    [register, targets, unregister],
  );
  return (
    <TutorialContext.Provider value={value}>
      {children}
    </TutorialContext.Provider>
  );
}

export function TutorialTarget({
  id,
  children,
  style,
}: PropsWithChildren<{ id: string; style?: object }>) {
  const registry = useContext(TutorialContext);
  const ref = useRef<View>(null);
  const register = registry?.register;
  const unregister = registry?.unregister;
  const measure = useCallback((_event?: LayoutChangeEvent) => {
    requestAnimationFrame(() =>
      ref.current?.measureInWindow((x, y, width, height) => {
        if (width > 0 && height > 0)
          register?.(id, { x, y, width, height });
      }),
    );
  }, [id, register]);

  useEffect(() => {
    const timer = setTimeout(measure, 80);
    return () => {
      clearTimeout(timer);
      unregister?.(id);
    };
  }, [id, measure, unregister]);

  return (
    <View ref={ref} collapsable={false} onLayout={measure} style={style}>
      {children}
    </View>
  );
}

type TutorialStep = {
  target: string;
  path: string;
  title: string;
  copy: string;
  button: string;
  nextPath?: string;
};

const STEPS: readonly TutorialStep[] = [
  {
    target: "today-hero",
    path: "/",
    title: "Your day at a glance",
    copy: "This focus card shows how many tracked goals are complete. The items below open their logs and progress.",
    button: "Next",
  },
  {
    target: "tab-insights",
    path: "/",
    title: "See your progress",
    copy: "Tap Progress to explore weekly, monthly, and yearly patterns.",
    button: "Open Progress",
    nextPath: "/insights",
  },
  {
    target: "progress-visual",
    path: "/insights",
    title: "Patterns without clutter",
    copy: "Swipe periods, tap a day for its log, or switch layouts. Long-press cards when you want to customize them.",
    button: "Next",
  },
  {
    target: "menu-button",
    path: "/insights",
    title: "Everything else stays tucked away",
    copy: "Tap the menu button for your profile, connections, display, groups, and advanced tools.",
    button: "Open Menu",
    nextPath: "/menu",
  },
  {
    target: "menu-display",
    path: "/menu",
    title: "Make it yours",
    copy: "Open Display to choose colors, visible tabs, compact mode, and your default landing page.",
    button: "Open Display",
    nextPath: "/display-settings",
  },
  {
    target: "personal-theme",
    path: "/display-settings",
    title: "Personal or group color",
    copy: "Choose any palette color here and decide whether it overrides each group’s shared theme.",
    button: "Next",
  },
  {
    target: "display-layout",
    path: "/display-settings",
    title: "Only show what you use",
    copy: "Navigation and optional pages can be hidden or reordered here. You can replay this guide from the menu anytime.",
    button: "Finish",
  },
];

export function TutorialSpotlight() {
  const { state, updateSettings } = useApp();
  const registry = useContext(TutorialContext);
  const pathname = usePathname();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const authRoute = [
    "/sign-in",
    "/onboarding",
    "/auth-callback",
    "/update-password",
    "/join",
  ].some((route) => pathname.startsWith(route));
  const active =
    state.settings.onboardingComplete &&
    !state.settings.tutorialComplete &&
    !authRoute;
  const step = STEPS[index];
  const raw = registry?.targets[step?.target];
  const rect = raw
    ? {
        x: Math.max(8, raw.x - 6),
        y: Math.max(8, raw.y - 6),
        width: Math.min(width - 16, raw.width + 12),
        height: raw.height + 12,
      }
    : undefined;

  useEffect(() => {
    if (!active || !step || pathname === step.path) return;
    const timer = setTimeout(() => router.replace(step.path as never), 0);
    return () => clearTimeout(timer);
  }, [active, pathname, step]);

  if (!active || !step) return null;

  function finish() {
    updateSettings({ tutorialComplete: true });
    router.replace("/" as never);
  }

  function advance() {
    if (index >= STEPS.length - 1) {
      finish();
      return;
    }
    const nextPath = step.nextPath;
    setIndex((value) => value + 1);
    if (nextPath) router.replace(nextPath as never);
  }

  const calloutBelow = !rect || rect.y < height * 0.5;
  const calloutStyle = rect
    ? calloutBelow
      ? { top: Math.min(height - 230, rect.y + rect.height + 15) }
      : { bottom: Math.max(18, height - rect.y + 15) }
    : { top: height * 0.34 };

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      {rect ? (
        <>
          <View style={[styles.shade, { left: 0, top: 0, right: 0, height: rect.y }]} />
          <View style={[styles.shade, { left: 0, top: rect.y, width: rect.x, height: rect.height }]} />
          <View
            style={[
              styles.shade,
              {
                left: rect.x + rect.width,
                right: 0,
                top: rect.y,
                height: rect.height,
              },
            ]}
          />
          <View
            style={[
              styles.shade,
              { left: 0, right: 0, top: rect.y + rect.height, bottom: 0 },
            ]}
          />
          <Pressable
            accessibilityLabel={`${step.title}. ${step.button}`}
            onPress={advance}
            style={[
              styles.spotlight,
              {
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: rect.height,
                borderColor: accent,
              },
            ]}
          />
        </>
      ) : (
        <View style={[styles.shade, StyleSheet.absoluteFill]} />
      )}
      <View
        style={[
          styles.callout,
          calloutStyle,
          { backgroundColor: colors.card, borderColor: accent },
        ]}
      >
        <View style={styles.calloutTop}>
          <View style={[styles.stepIcon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="navigate" size={17} color={accent} />
          </View>
          <Text style={[styles.counter, { color: colors.muted }]}>
            {index + 1}/{STEPS.length}
          </Text>
          <Pressable onPress={finish} hitSlop={10}>
            <Text style={[styles.skip, { color: colors.muted }]}>Skip</Text>
          </Pressable>
        </View>
        <Text style={[styles.title, { color: colors.ink }]}>{step.title}</Text>
        <Text style={[styles.copy, { color: colors.muted }]}>{step.copy}</Text>
        <Pressable
          onPress={advance}
          style={[styles.button, { backgroundColor: accent }]}
        >
          <Text preserveColor style={styles.buttonText}>{step.button}</Text>
          <Ionicons
            name={index === STEPS.length - 1 ? "checkmark" : "arrow-forward"}
            size={16}
            color={palette.white}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10000,
    elevation: 10000,
  },
  shade: {
    position: "absolute",
    backgroundColor: "rgba(0,0,0,0.66)",
  },
  spotlight: {
    position: "absolute",
    borderWidth: 3,
    borderRadius: 16,
    backgroundColor: "transparent",
  },
  callout: {
    position: "absolute",
    left: 18,
    right: 18,
    borderWidth: 1,
    borderRadius: 19,
    padding: 16,
    shadowColor: "#000000",
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 18,
  },
  calloutTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  stepIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  counter: { flex: 1, fontSize: 9, fontWeight: "800" },
  skip: { fontSize: 9, fontWeight: "900" },
  title: { fontSize: 16, fontWeight: "900", marginTop: 11 },
  copy: { fontSize: 10, lineHeight: 16, marginTop: 5 },
  button: {
    height: 42,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 14,
  },
  buttonText: { color: palette.white, fontSize: 10, fontWeight: "900" },
});
