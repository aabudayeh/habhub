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
    () => ({
      targets,
      register,
      unregister,
      setMeasurer,
      requestMeasure,
    }),
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
  const measure = useCallback((_event?: LayoutChangeEvent) => {
    requestAnimationFrame(() =>
      ref.current?.measureInWindow((x, y, width, height) => {
        if (width > 0 && height > 0)
          register?.(id, { x, y, width, height });
      }),
    );
  }, [id, register]);

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

export const TUTORIAL_GUIDES = [
  { id: "full", title: "Essential tour", detail: "The main flow from Today through Progress and settings", icon: "compass-outline", path: "/" },
  { id: "today", title: "Today", detail: "Completion, tracked flags, tiles, pins, history, to-dos, filters, and edit mode", icon: "today-outline", path: "/" },
  { id: "log", title: "Log", detail: "Tracker selection, dates, privacy, notes, photos, food, and activity timers", icon: "add-circle-outline", path: "/log" },
  { id: "progress", title: "Progress", detail: "Overview, grid and compact layouts, ranges, filters, details, editing, and Performance", icon: "stats-chart-outline", path: "/insights" },
  { id: "leaderboard", title: "Leaderboard", detail: "Rankings, personal targets, ranges, profiles, shared logs, and group controls", icon: "people-outline", path: "/group" },
  { id: "chat", title: "Chat", detail: "Group and private conversations, unread states, media, profiles, mute, and alerts", icon: "chatbubbles-outline", path: "/chat" },
  { id: "gym", title: "Workout", detail: "Programs, exercise ordering, sets, timers, rest, templates, notes, and history", icon: "barbell-outline", path: "/gym" },
  { id: "schedule", title: "Schedule", detail: "Week navigation, reminders, deadlines, slots, recurrence, and edit gestures", icon: "calendar-outline", path: "/calendar" },
  { id: "journal", title: "Journal", detail: "Date ranges, search, multi-label filters, tracker links, formatting, images, and checklists", icon: "book-outline", path: "/journal" },
  { id: "performance", title: "Performance", detail: "Comparison ranges, overall baselines, strengths, focus areas, filters, pins, and saved views", icon: "speedometer-outline", path: "/performance" },
  { id: "settings", title: "Settings & menu", detail: "Profile, goals, cloud, health, notifications, display, navigation, groups, and advanced tools", icon: "settings-outline", path: "/menu" },
] as const;

const pageGuide = (
  path: string,
  target: string,
  tab: string,
  title: string,
  overview: string,
  detail: string,
): readonly TutorialStep[] => [
  { target, path, title, copy: overview, button: "Next" },
  { target, path, title: `${title} shortcuts`, copy: detail, button: "Next" },
  {
    target,
    path,
    title: "Dates and ranges",
    copy: "Swipe or use the date controls to move through days and completed calendar periods. Tap a centered date where available to open the collapsed calendar.",
    button: "Next",
  },
  {
    target,
    path,
    title: "Filters and saved views",
    copy: "The filter control can show tracked goals, all trackers, or a custom saved list. Hiding an item from a page never deletes its entries.",
    button: "Next",
  },
  {
    target,
    path,
    title: "Open the detail",
    copy: "Tap a card, value, avatar, or scheduled item to open its relevant log, comparison, profile, or editor. The + action adds data on the date already being viewed.",
    button: "Next",
  },
  {
    target,
    path,
    title: "Edit mode",
    copy: "Long-press where edit mode is supported. Drag to reorder; use pin, visibility, date, edit, and remove controls; then add an existing tracker without recreating it.",
    button: "Next",
  },
  {
    target,
    path,
    title: "Help without clutter",
    copy: "Tap nearby info icons for goal logic, visibility, calculations, charts, and gestures. Pull down outside edit mode to request fresh health and cloud data.",
    button: "Next",
  },
  {
    target: `tab-${tab}`,
    path,
    title: "Return anytime",
    copy: "This navigation item opens the page. Optional pages can be hidden or reordered from Display settings.",
    button: "Finish",
  },
];

const GUIDES: Record<string, readonly TutorialStep[]> = {
  full: STEPS,
  today: pageGuide(
    "/",
    "today-hero",
    "index",
    "Today",
    "Your completion indicator, tracked goals, optional history strips, and to-dos live here.",
    "Tap a tile to review entries. Hold the page for edit mode, where you can pin, reorder, hide, or add existing trackers.",
  ),
  log: pageGuide(
    "/log",
    "log-header",
    "log",
    "Log",
    "Choose any manual tracker, then set its date, time, value, note, image, and visibility in one flow.",
    "Food supports search and nutrition details; timed activities launch the timer. Synced or calculated trackers open history instead.",
  ),
  progress: [
    {
      target: "progress-visual",
      path: "/insights",
      title: "Progress overview",
      copy: "Overview combines up to six selected trackers, with the same calendar period used for both the visual and summaries.",
      button: "Next",
    },
    {
      target: "progress-modes",
      path: "/insights",
      title: "Grid map",
      copy: "Switch to Grid map for one calendar heatmap per tracker. Week, month, and year show logged, missed, completed, skipped, and vacation days.",
      button: "Next",
    },
    {
      target: "progress-modes",
      path: "/insights",
      title: "Compact grid",
      copy: "The grid icon toggles an ultra-compact layout that keeps only each tracker name, completion percentage, and heatmap.",
      button: "Next",
    },
    {
      target: "progress-modes",
      path: "/insights",
      title: "Filters and card order",
      copy: "Choose tracked goals, all trackers, or a saved custom view. Long-press a card to reorder or remove it from this page, edit its tracked-goal start, or add another existing tracker.",
      button: "Next",
    },
    {
      target: "progress-visual",
      path: "/insights",
      title: "Move through time",
      copy: "Tap the date-range control to cycle ranges. Swipe the visual left or right to move to the previous or next week, month, or year.",
      button: "Next",
    },
    {
      target: "progress-visual",
      path: "/insights",
      title: "Read the colors",
      copy: "Grey means not logged, orange means logged without a goal, red means missed, pink means skipped or vacation, and lime means completed. Tap the info icon whenever you need the legend.",
      button: "Next",
    },
    {
      target: "progress-visual",
      path: "/insights",
      title: "Daily details",
      copy: "Tap a calendar day to see logged and calculated values, tracked-goal status, notes, and photos. Each section stays collapsed until you need its full entries.",
      button: "Next",
    },
    {
      target: "progress-visual",
      path: "/insights",
      title: "Details and performance",
      copy: "Tap a day or tracker for its entries. Long-press cards to organize the view, or open Performance for goal-aware comparisons.",
      button: "Next",
    },
    {
      target: "tab-insights",
      path: "/insights",
      title: "Return anytime",
      copy: "Progress stays available here unless you hide or reorder the tab in Display settings.",
      button: "Finish",
    },
  ],
  leaderboard: pageGuide(
    "/group",
    "leaderboard-header",
    "group",
    "Leaderboard",
    "Rankings use shared values and each member’s personal target while the group competition rule decides order.",
    "Swipe date ranges, tap an avatar for head-to-head comparison, or tap a value for shared entries and goal detail.",
  ),
  chat: pageGuide(
    "/chat",
    "chat-header",
    "chat",
    "Chat",
    "Switch between the group conversation and private friends from the conversation header.",
    "Messages update through realtime, support images and timestamps, and respect per-chat mute and notification preferences.",
  ),
  gym: pageGuide(
    "/gym",
    "gym-header",
    "gym",
    "Workout",
    "Build reusable workout days, log sets, weights, reps, notes, and optional timed rests.",
    "The workout timer follows sets and exercises; history feeds workout trackers, active energy, recaps, and group rankings.",
  ),
  schedule: pageGuide(
    "/calendar",
    "schedule-header",
    "calendar",
    "Schedule",
    "The week grid combines tracker reminders, to-do reminders, and deadlines using your chosen week and time format.",
    "Tap an item to edit it; double-tap or hold a slot to add one. Edit mode reorders and removes scheduled items.",
  ),
  journal: pageGuide(
    "/journal",
    "journal-header",
    "journal",
    "Journal",
    "Journal gathers authored notes plus notes attached to tracker, workout, and exercise entries.",
    "Search all text, select multiple labels, and create formatted notes with images, links, and checklists.",
  ),
  performance: pageGuide(
    "/performance",
    "performance-header",
    "performance",
    "Performance",
    "Compare completed days, weeks, months, or years with the preceding period or your overall average, using goal-aware direction.",
    "Custom mode compares any two date ranges. Prioritize gainers, steady items, or focus areas; pin important trackers and hold cards to edit the view.",
  ),
  settings: [
    {
      target: "menu-display",
      path: "/menu",
      title: "The settings hub",
      copy: "Profile, cloud and health, notifications, display, groups, and advanced tracker tools are organized here.",
      button: "Next",
    },
    {
      target: "settings-header",
      path: "/settings",
      title: "Cloud and health sync",
      copy: "Inspect sync health, choose a battery schedule, manage devices, and request older health history here.",
      button: "Next",
    },
    {
      target: "settings-header",
      path: "/settings",
      title: "Notifications",
      copy: "Control push alerts, quiet hours, chat and group updates, plus each tracker’s reminders. Schedule opens the same reminders in calendar form.",
      button: "Next",
    },
    {
      target: "settings-header",
      path: "/settings",
      title: "Profile and goals",
      copy: "Body and energy settings drive weight, intake, deficit or surplus estimates. Metric goals only list trackers that are active for this account.",
      button: "Next",
    },
    {
      target: "personal-theme",
      path: "/display-settings",
      title: "A theme just for you",
      copy: "Your personal theme can override a group color without changing what friends see.",
      button: "Next",
    },
    {
      target: "display-layout",
      path: "/display-settings",
      title: "Layout and navigation",
      copy: "Choose compact mode, text size, time format, completion behavior, shortcuts, visible tabs, tab order, and the default landing page.",
      button: "Next",
    },
    {
      target: "display-layout",
      path: "/display-settings",
      title: "Groups and advanced tools",
      copy: "Group settings manage members, approval, shared trackers, competition rules, rest days, and group color. Advanced tracker settings remain available without crowding daily use.",
      button: "Next",
    },
    {
      target: "display-layout",
      path: "/display-settings",
      title: "Replay any page guide",
      copy: "Quick Guide keeps a full walkthrough for every major page, so hiding a tab or skipping onboarding never removes the help.",
      button: "Finish",
    },
  ],
};

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
  const guideId = state.settings.tutorialGuideId ?? "full";
  const steps = GUIDES[guideId] ?? GUIDES.full;
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
      Boolean(state.settings.tutorialGuideId)) &&
    !authRoute;
  const step = steps[index];
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
  const targetWidth = relative
    ? Math.min(width - 16, relative.width + 12)
    : 0;
  const targetHeight = relative
    ? Math.min(height - 16, relative.height + 12)
    : 0;
  const rect =
    relative && visible
      ? {
          x: Math.max(
            8,
            Math.min(width - targetWidth - 8, relative.x - 6),
          ),
          y: Math.max(
            8,
            Math.min(height - targetHeight - 8, relative.y - 6),
          ),
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
    // Hide the overlay immediately. Persisting/cloud-syncing the preference can
    // then finish without leaving a touch-blocking layer over the last page.
    setDismissed(true);
    updateSettings({
      tutorialComplete: true,
      tutorialGuideId: undefined,
      tutorialGuideRunId: undefined,
    });
    if (guideId === "full")
      setTimeout(() => router.replace("/" as never), 0);
  }, [guideId, updateSettings]);

  useEffect(() => {
    setIndex(0);
    setDismissed(false);
  }, [guideId, state.settings.tutorialGuideRunId]);

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
    return () => {
      timers.forEach(clearTimeout);
    };
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
    if (index >= steps.length - 1) {
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
    <View
      ref={overlayRef}
      collapsable={false}
      onLayout={measureOverlay}
      style={styles.overlay}
      pointerEvents="box-none"
    >
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
            {index + 1}/{steps.length}
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
            name={index === steps.length - 1 ? "checkmark" : "arrow-forward"}
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
