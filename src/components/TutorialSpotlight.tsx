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
  BackHandler,
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
  setMeasurer: (id: string, measure?: () => void) => void;
  requestMeasure: (id: string) => void;
};

const TutorialContext = createContext<TutorialRegistry | null>(null);

export function TutorialProvider({ children }: PropsWithChildren) {
  const [targets, setTargets] = useState<Record<string, TargetRect>>({});
  const measurers = useRef<Record<string, () => void>>({});
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
  const setMeasurer = useCallback((id: string, measure?: () => void) => {
    if (measure) measurers.current[id] = measure;
    else delete measurers.current[id];
  }, []);
  const requestMeasure = useCallback((id: string) => {
    measurers.current[id]?.();
  }, []);
  const value = useMemo<TutorialRegistry>(
    () => ({ targets, register, unregister, setMeasurer, requestMeasure }),
    [register, requestMeasure, setMeasurer, targets, unregister],
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
  const setMeasurer = registry?.setMeasurer;
  const measure = useCallback(
    (_event?: LayoutChangeEvent) => {
      requestAnimationFrame(() =>
        ref.current?.measureInWindow((x, y, width, height) => {
          if (width > 0 && height > 0)
            register?.(id, { x, y, width, height });
        }),
      );
    },
    [id, register],
  );

  useEffect(() => {
    setMeasurer?.(id, measure);
    const timers = [0, 80, 240].map((delay) => setTimeout(measure, delay));
    return () => {
      timers.forEach(clearTimeout);
      setMeasurer?.(id);
      unregister?.(id);
    };
  }, [id, measure, setMeasurer, unregister]);

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

export const BASIC_TUTORIAL_GUIDE = {
  id: "essential",
  title: "HabHub basics",
  detail: "A short walkthrough of Today, logging, Progress, and display settings",
  icon: "compass-outline",
  path: "/",
} as const;

const BASIC_STEPS: readonly TutorialStep[] = [
  {
    target: "today-hero",
    path: "/",
    title: "Your day at a glance",
    copy: "This card summarizes completion for the goals you flagged to track each day. Tap it later to open Status.",
    button: "Next",
  },
  {
    target: "tab-log",
    path: "/",
    title: "Add an entry",
    copy: "Log opens the trackers available on your account so you can record a value for the date you choose.",
    button: "Open Log",
    nextPath: "/log",
  },
  {
    target: "log-header",
    path: "/log",
    title: "Choose what to log",
    copy: "Pick a tracker, then enter its value and optional details. Synced and calculated trackers show their history instead.",
    button: "Next",
  },
  {
    target: "tab-insights",
    path: "/log",
    title: "See your progress",
    copy: "Progress shows patterns across your tracked goals and other available trackers.",
    button: "Open Progress",
    nextPath: "/insights",
  },
  {
    target: "progress-visual",
    path: "/insights",
    title: "Review patterns over time",
    copy: "Switch the date range or layout, then tap a day to open its daily details.",
    button: "Next",
  },
  {
    target: "menu-button",
    path: "/insights",
    title: "Find the rest of HabHub",
    copy: "The menu keeps your profile, connections, display options, groups, and settings together.",
    button: "Open Menu",
    nextPath: "/menu",
  },
  {
    target: "menu-display",
    path: "/menu",
    title: "Make the layout yours",
    copy: "Open Display to choose your colors, visible pages, tab order, and default landing page.",
    button: "Open Display",
    nextPath: "/display-settings",
  },
  {
    target: "personal-theme",
    path: "/display-settings",
    title: "Choose your appearance",
    copy: "Your personal theme can override a group color without changing what friends see.",
    button: "Next",
  },
  {
    target: "display-layout",
    path: "/display-settings",
    title: "Keep only what you use",
    copy: "Show, hide, or reorder optional pages here. You can replay this basic guide from the menu at any time.",
    button: "Finish",
  },
];

function landingPath(landingPage: string | undefined) {
  return !landingPage || landingPage === "index" ? "/" : `/${landingPage}`;
}

export function TutorialSpotlight() {
  const { state, updateSettings } = useApp();
  const registry = useContext(TutorialContext);
  const requestTargetMeasure = registry?.requestMeasure;
  const pathname = usePathname();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const overlayRef = useRef<View>(null);
  const [overlayOrigin, setOverlayOrigin] = useState({ x: 0, y: 0 });
  const authRoute = [
    "/sign-in",
    "/onboarding",
    "/auth-callback",
    "/update-password",
    "/join",
  ].some((route) => pathname.startsWith(route));
  const active =
    !dismissed &&
    state.settings.onboardingComplete &&
    (!state.settings.tutorialComplete ||
      state.settings.tutorialGuideId === BASIC_TUTORIAL_GUIDE.id) &&
    !authRoute;
  const step = BASIC_STEPS[index];
  const raw = registry?.targets[step?.target];
  const relative = raw
    ? {
        x: raw.x - overlayOrigin.x,
        y: raw.y - overlayOrigin.y,
        width: raw.width,
        height: raw.height,
      }
    : undefined;
  const visible =
    relative &&
    relative.x < width &&
    relative.y < height &&
    relative.x + relative.width > 0 &&
    relative.y + relative.height > 0;
  const targetWidth = relative ? Math.min(width - 16, relative.width + 12) : 0;
  const targetHeight = relative
    ? Math.min(height - 16, relative.height + 12)
    : 0;
  const rect =
    relative && visible
      ? {
          x: Math.max(8, Math.min(width - targetWidth - 8, relative.x - 6)),
          y: Math.max(8, Math.min(height - targetHeight - 8, relative.y - 6)),
          width: targetWidth,
          height: targetHeight,
        }
      : undefined;

  const measureOverlay = useCallback(() => {
    overlayRef.current?.measureInWindow((x, y) => {
      setOverlayOrigin((current) =>
        Math.abs(current.x - x) < 1 && Math.abs(current.y - y) < 1
          ? current
          : { x, y },
      );
    });
  }, []);

  const finish = useCallback(() => {
    setDismissed(true);
    updateSettings({
      tutorialComplete: true,
      tutorialGuideId: undefined,
      tutorialGuideRunId: undefined,
    });
    const route = landingPath(state.settings.defaultLandingPage);
    setTimeout(() => router.replace(route as never), 0);
  }, [state.settings.defaultLandingPage, updateSettings]);

  useEffect(() => {
    setIndex(0);
    setDismissed(false);
  }, [state.settings.tutorialGuideRunId]);

  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        finish();
        return true;
      },
    );
    return () => subscription.remove();
  }, [active, finish]);

  useEffect(() => {
    if (!active || !step || pathname === step.path) return;
    const timer = setTimeout(() => router.replace(step.path as never), 0);
    return () => clearTimeout(timer);
  }, [active, pathname, step]);

  useEffect(() => {
    if (!active || !step) return;
    const refresh = () => {
      measureOverlay();
      requestTargetMeasure?.(step.target);
    };
    const timers = [0, 80, 220, 500, 1000].map((delay) =>
      setTimeout(refresh, delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [
    active,
    height,
    index,
    measureOverlay,
    pathname,
    requestTargetMeasure,
    step,
    width,
  ]);

  if (!active || !step) return null;

  function advance() {
    if (index >= BASIC_STEPS.length - 1) {
      finish();
      return;
    }
    setIndex((value) => value + 1);
    if (step.nextPath) router.replace(step.nextPath as never);
  }

  const calloutBelow = !rect || rect.y < height * 0.5;
  const calloutStyle = rect
    ? calloutBelow
      ? { top: Math.min(Math.max(18, height - 230), rect.y + rect.height + 15) }
      : { bottom: Math.max(18, height - rect.y + 15) }
    : { top: Math.max(18, height * 0.34) };

  return (
    <View
      ref={overlayRef}
      collapsable={false}
      onLayout={measureOverlay}
      style={styles.overlay}
      pointerEvents="box-none"
      accessibilityViewIsModal
    >
      {rect ? (
        <>
          <View style={[styles.shade, { left: 0, top: 0, right: 0, height: rect.y }]} />
          <View style={[styles.shade, { left: 0, top: rect.y, width: rect.x, height: rect.height }]} />
          <View style={[styles.shade, { left: rect.x + rect.width, right: 0, top: rect.y, height: rect.height }]} />
          <View style={[styles.shade, { left: 0, right: 0, top: rect.y + rect.height, bottom: 0 }]} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${step.title}. ${step.button}`}
            onPress={advance}
            style={[styles.spotlight, { left: rect.x, top: rect.y, width: rect.width, height: rect.height, borderColor: accent }]}
          />
        </>
      ) : (
        <View style={[styles.shade, StyleSheet.absoluteFill]} />
      )}
      <View style={[styles.callout, calloutStyle, { backgroundColor: colors.card, borderColor: accent }]}>
        <View style={styles.calloutTop}>
          <View style={[styles.stepIcon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="navigate" size={17} color={accent} />
          </View>
          <Text style={[styles.counter, { color: colors.muted }]}>
            {index + 1}/{BASIC_STEPS.length}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip basic guide"
            onPress={finish}
            hitSlop={10}
          >
            <Text style={[styles.skip, { color: colors.muted }]}>Skip</Text>
          </Pressable>
        </View>
        <Text style={[styles.title, { color: colors.ink }]}>{step.title}</Text>
        <Text style={[styles.copy, { color: colors.muted }]}>{step.copy}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={step.button}
          onPress={advance}
          style={[styles.button, { backgroundColor: accent }]}
        >
          <Text preserveColor style={styles.buttonText}>{step.button}</Text>
          <Ionicons
            name={index === BASIC_STEPS.length - 1 ? "checkmark" : "arrow-forward"}
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
  shade: { position: "absolute", backgroundColor: "rgba(0,0,0,0.66)" },
  spotlight: {
    position: "absolute",
    borderWidth: 3,
    borderRadius: 16,
    backgroundColor: "transparent",
  },
  callout: {
    position: "absolute",
    alignSelf: "center",
    width: "auto",
    maxWidth: 540,
    left: 12,
    right: 12,
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
    minHeight: 44,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 14,
  },
  buttonText: { color: palette.white, fontSize: 10, fontWeight: "900" },
});
