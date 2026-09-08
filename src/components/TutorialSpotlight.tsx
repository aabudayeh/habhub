import { Ionicons } from "@expo/vector-icons";
import { router, usePathname, useSegments } from "expo-router";
import React, {
  PropsWithChildren,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  Easing,
  findNodeHandle,
  InteractionManager,
  Keyboard,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  useWindowDimensions,
  View,
  ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "@/src/components/AppText";
import { useLocalization } from "@/src/i18n";
import { localizedTutorialGuide } from "@/src/i18n/tutorial";
import { useApp } from "@/src/state/AppProvider";
import { activeLiveSetupStep, skipAllTutorialsSettings, tutorialPageAlreadyLearned, tutorialReadingTimeMs, tutorialWatchTiming } from "@/src/domain/tutorialUsability";
import { readableTextColor } from "@/src/domain/colors";
import {
  calloutLayout,
  relativeTargetRect,
  spotlightRect,
} from "@/src/tutorial/geometry";
import { BASIC_TUTORIAL_GUIDE } from "@/src/tutorial/basicGuide";
import { activeTutorialModalHost, subscribeTutorialModalHost } from "@/src/tutorial/modalHost";
import { tutorialPromptForPath } from "@/src/tutorial/firstVisit";
import {
  TutorialIsolatedPreviewBoundary,
  TutorialProvider,
  useOptionalTutorial,
  useTutorial,
} from "@/src/tutorial/TutorialContext";
import {
  resolvedTutorialRoute,
  routeForStep,
  routeMatchesStep,
  safeTutorialRoute,
  tutorialRoutePath,
} from "@/src/tutorial/session";
import {
  markTutorialPagePrompted,
  readPromptedTutorialPages,
} from "@/src/tutorial/storage";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";

export {
  BASIC_TUTORIAL_GUIDE,
  TutorialIsolatedPreviewBoundary,
  TutorialProvider,
  useOptionalTutorial,
  useTutorial,
};

let targetInstanceSequence = 0;

type TutorialKeyboardEvent = {
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
  currentTarget: HTMLElement;
};

function trapTutorialFocus(event: TutorialKeyboardEvent) {
  if (event.key !== "Tab") return;
  const nodes = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (node) =>
      !node.hasAttribute("disabled") &&
      node.getAttribute("aria-disabled") !== "true" &&
      node.getAttribute("aria-hidden") !== "true",
  );
  if (!nodes.length) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  const activeIndex = nodes.indexOf(active as HTMLElement);
  const nextIndex = event.shiftKey
    ? activeIndex <= 0
      ? nodes.length - 1
      : activeIndex - 1
    : activeIndex < 0 || activeIndex >= nodes.length - 1
      ? 0
      : activeIndex + 1;
  event.preventDefault();
  nodes[nextIndex]?.focus();
}

type TutorialScrollContextValue = {
  reveal: (targetY: number) => void;
  setActiveTargetMeasurer: (
    instanceId: number,
    measure?: () => void,
  ) => void;
};

const TutorialScrollContext = React.createContext<TutorialScrollContextValue | null>(
  null,
);

/**
 * A Screen can provide its own scroll implementation without coupling the
 * tutorial engine to ScrollView. `reveal` receives the target's window Y.
 */
export function TutorialScrollProvider({
  children,
  reveal,
  setActiveTargetMeasurer,
}: PropsWithChildren<{
  reveal: (targetY: number) => void;
  setActiveTargetMeasurer: TutorialScrollContextValue["setActiveTargetMeasurer"];
}>) {
  const value = React.useMemo(
    () => ({ reveal, setActiveTargetMeasurer }),
    [reveal, setActiveTargetMeasurer],
  );
  return (
    <TutorialScrollContext.Provider value={value}>
      {children}
    </TutorialScrollContext.Provider>
  );
}

export function TutorialTarget({
  id,
  children,
  style,
  reveal,
  onTutorialActivate,
  onTutorialDeactivate,
}: PropsWithChildren<{
  id: string;
  style?: StyleProp<ViewStyle>;
  reveal?: () => void;
  onTutorialActivate?: () => void;
  /**
   * Clears transient UI opened by Watch mode (for example, a modal or sheet).
   * This runs only after this target's tutorial activator actually ran and the
   * owning step, route, or guide is leaving.
   */
  onTutorialDeactivate?: () => void;
}>) {
  const tutorial = useOptionalTutorial();
  const scrollContext = React.useContext(TutorialScrollContext);
  const ref = useRef<View>(null);
  const lastWindowY = useRef(0);
  const autoRevealDoneRef = useRef(false);
  const autoRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tutorialActivatedRef = useRef(false);
  const onTutorialActivateRef = useRef(onTutorialActivate);
  const onTutorialDeactivateRef = useRef(onTutorialDeactivate);
  const instanceId = useRef(++targetInstanceSequence).current;
  const { height: windowHeight } = useWindowDimensions();
  const activeTargetId =
    tutorial?.activeStep?.anchor?.target ?? tutorial?.activeStep?.target;
  const enabled = activeTargetId === id;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  onTutorialActivateRef.current = onTutorialActivate;
  onTutorialDeactivateRef.current = onTutorialDeactivate;
  const registerTarget = tutorial?.registerTarget;
  const unregisterTarget = tutorial?.unregisterTarget;
  const setTargetMeasurer = tutorial?.setTargetMeasurer;
  const setTargetRevealer = tutorial?.setTargetRevealer;
  const setTargetActivator = tutorial?.setTargetActivator;
  const activateForTutorial = useCallback(() => {
    tutorialActivatedRef.current = true;
    onTutorialActivateRef.current?.();
  }, []);
  const hasTutorialActivator = Boolean(onTutorialActivate);
  const activeStepIdentity = enabled
    ? `${tutorial?.activeSession?.runId ?? ""}:${tutorial?.activeStep?.id ?? ""}:${id}`
    : undefined;
  const measureNow = useCallback(() => {
    if (!enabledRef.current) return;
    ref.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        lastWindowY.current = y;
        registerTarget?.(id, instanceId, { x, y, width, height });
        const outsideUsableViewport =
          y < 72 || y + height > Math.max(120, windowHeight - 88);
        if (outsideUsableViewport && !autoRevealDoneRef.current) {
          autoRevealDoneRef.current = true;
          autoRevealTimerRef.current = setTimeout(() => {
            if (reveal) reveal();
            else scrollContext?.reveal(lastWindowY.current);
            autoRevealTimerRef.current = null;
          }, 1020);
        }
      }
    });
  }, [id, instanceId, registerTarget, reveal, scrollContext, windowHeight]);
  const measure = useCallback(
    (_event?: LayoutChangeEvent) => {
      requestAnimationFrame(measureNow);
    },
    [measureNow],
  );

  useEffect(() => {
    if (!enabled) return;
    autoRevealDoneRef.current = false;
    setTargetMeasurer?.(id, instanceId, measure);
    scrollContext?.setActiveTargetMeasurer(instanceId, measureNow);
    setTargetActivator?.(
      id,
      instanceId,
      hasTutorialActivator ? activateForTutorial : undefined,
    );
    const revealTarget =
      reveal ??
      (scrollContext
        ? () => scrollContext.reveal(lastWindowY.current)
        : undefined);
    setTargetRevealer?.(id, instanceId, revealTarget);
    const timers = [0, 80, 240].map((delay) => setTimeout(measure, delay));
    return () => {
      timers.forEach(clearTimeout);
      if (autoRevealTimerRef.current !== null) {
        clearTimeout(autoRevealTimerRef.current);
        autoRevealTimerRef.current = null;
      }
      autoRevealDoneRef.current = false;
      setTargetMeasurer?.(id, instanceId);
      scrollContext?.setActiveTargetMeasurer(instanceId);
      setTargetActivator?.(id, instanceId);
      setTargetRevealer?.(id, instanceId);
      unregisterTarget?.(id, instanceId);
    };
  }, [
    enabled,
    activateForTutorial,
    hasTutorialActivator,
    id,
    instanceId,
    measure,
    measureNow,
    reveal,
    scrollContext,
    setTargetMeasurer,
    setTargetActivator,
    setTargetRevealer,
    unregisterTarget,
  ]);

  useEffect(() => {
    if (!activeStepIdentity) return;
    return () => {
      if (!tutorialActivatedRef.current) return;
      tutorialActivatedRef.current = false;
      onTutorialDeactivateRef.current?.();
    };
  }, [activeStepIdentity]);

  return (
    <View
      ref={ref}
      collapsable={!enabled}
      onLayout={enabled ? measure : undefined}
      style={style}
    >
      {children}
    </View>
  );
}

function isBlockedRoute(pathname: string) {
  return [
    "/sign-in",
    "/onboarding",
    "/auth-callback",
    "/auth/callback",
    "/update-password",
    "/join",
    "/extension",
  ].some((route) => pathname.startsWith(route));
}

export function TutorialSpotlight({ modalHostId }: { modalHostId?: string } = {}) {
  const tutorial = useOptionalTutorial();
  const activeModalHost = useSyncExternalStore(
    subscribeTutorialModalHost,
    activeTutorialModalHost,
    () => undefined,
  );
  if (!tutorial) return null;
  if (activeModalHost !== modalHostId) return null;
  if (modalHostId && !tutorial.activeSession) return null;
  return <TutorialSpotlightSurface />;
}

function TutorialSpotlightSurface() {
  const { activeSession, transitionPhase } = useTutorial();
  if (activeSession || transitionPhase !== "idle")
    return <TutorialSpotlightContent />;
  return <TutorialFirstVisitPrompt />;
}

function TutorialFirstVisitPrompt() {
  const { state, updateSettings } = useApp();
  const { guides, hydrated, progressByGuide, startGuide } = useTutorial();
  const pathname = usePathname();
  const segments = useSegments();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const onAccent = readableTextColor(accent);
  const { language, t } = useLocalization();
  const [promptedPageId, setPromptedPageId] = useState<string>();
  const [keyboardVisible, setKeyboardVisible] = useState(Keyboard.isVisible());
  const insets = useSafeAreaInsets();
  const page = tutorialPromptForPath(pathname);
  const pageId = page?.pageId;
  const pageGuideId = page?.guideId;
  const pageStepId = page?.stepId;
  const pageTitle = page?.title;
  const accountId = state.currentUserId || "anonymous";
  const guide = guides.find((item) => item.id === pageGuideId);
  const pageAlreadyLearned = tutorialPageAlreadyLearned(guide, pageStepId, progressByGuide);
  const liveSetupActive = Boolean(activeLiveSetupStep(state.settings));

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    const onWebFocus = (event?: FocusEvent) => {
      const element = event?.type === "focusout" ? event.relatedTarget : document.activeElement;
      setKeyboardVisible(
        element instanceof HTMLElement && (
          element.tagName === "TEXTAREA" ||
          (element.tagName === "INPUT" && !["button", "checkbox", "radio", "submit"].includes((element as HTMLInputElement).type)) ||
          element.isContentEditable
        ),
      );
    };
    if (Platform.OS === "web") {
      onWebFocus();
      document.addEventListener("focusin", onWebFocus);
      document.addEventListener("focusout", onWebFocus);
    }
    return () => {
      show.remove();
      hide.remove();
      if (Platform.OS === "web") {
        document.removeEventListener("focusin", onWebFocus);
        document.removeEventListener("focusout", onWebFocus);
      }
    };
  }, []);

  useEffect(() => {
    setPromptedPageId(undefined);
    if (
      !hydrated ||
      !state.settings.onboardingComplete ||
      !state.settings.tutorialComplete ||
      state.settings.tutorialPromptsDisabled ||
      liveSetupActive ||
      pageAlreadyLearned ||
      !pageId ||
      !pageGuideId
    )
      return;
    let cancelled = false;
    let revealTimer: ReturnType<typeof setTimeout> | undefined;
    void readPromptedTutorialPages(accountId).then((pageIds) => {
      if (cancelled || pageIds.includes(pageId)) return;
      revealTimer = setTimeout(() => {
        if (!cancelled) setPromptedPageId(pageId);
      }, 650);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      if (revealTimer) clearTimeout(revealTimer);
    };
  }, [
    accountId,
    hydrated,
    pageGuideId,
    pageId,
    pageStepId,
    pageAlreadyLearned,
    state.settings.onboardingComplete,
    state.settings.tutorialComplete,
    state.settings.tutorialPromptsDisabled,
    liveSetupActive,
  ]);

  if (!pageId || !pageGuideId || promptedPageId !== pageId || keyboardVisible || liveSetupActive || state.settings.tutorialPromptsDisabled) return null;
  if (!guide) return null;
  const localizedGuide = localizedTutorialGuide(guide, language);
  const promptTitle = pageTitle
    ? t(pageTitle)
    : localizedGuide.sections?.[0]?.title ?? localizedGuide.title;

  const rememberPrompt = () => {
    setPromptedPageId(undefined);
    void markTutorialPagePrompted(accountId, pageId).catch(() => undefined);
  };
  const launch = (mode: "watch" | "practice") => {
    rememberPrompt();
    startGuide(guide.id, {
      resume: false,
      mode,
      stepId: pageStepId,
      returnPath: pathname,
    });
  };

  return (
    <View
      style={[styles.firstVisitLayer, { paddingBottom: Math.max(14, insets.bottom + (segments[0] === "(tabs)" ? 67 : 12)) }]}
      pointerEvents="box-none"
    >
      <View
        style={[
          styles.firstVisitCard,
          { backgroundColor: colors.card, borderColor: accent },
        ]}
      >
        <View style={[styles.firstVisitIcon, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="sparkles" size={18} color={accent} />
        </View>
        <View style={styles.firstVisitCopy}>
          <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[styles.firstVisitTitle, { color: colors.ink }]}>
            {t("First time on {name}?").replace(
              "{name}",
              promptTitle,
            )}
          </Text>
          <Text style={[styles.firstVisitDetail, { color: colors.muted }]}>
            {t("Watch a quick pointer tour, or practice safely with demo data. Your own entries stay untouched.")}
          </Text>
          <View style={styles.firstVisitActions}>
            <Pressable
              accessibilityRole="button"
              onPress={rememberPrompt}
              style={[styles.firstVisitSkip, { borderColor: colors.border }]}
            >
              <Text style={[styles.firstVisitSkipText, { color: colors.muted }]}>
                {t("Skip for now")}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => launch("watch")}
              style={[styles.firstVisitChoice, { borderColor: accent }]}
            >
              <Ionicons name="play" size={14} color={accent} />
              <Text style={[styles.firstVisitChoiceText, { color: accent }]}>
                {t("Watch")}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => launch("practice")}
              style={[styles.firstVisitChoice, { backgroundColor: accent, borderColor: accent }]}
            >
              <Ionicons name="hand-left" size={14} color={onAccent} />
              <Text preserveColor style={[styles.firstVisitPracticeText, { color: onAccent }]}>
                {t("Practice")}
              </Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => { rememberPrompt(); updateSettings(skipAllTutorialsSettings()); }}
            style={styles.firstVisitSkipAll}
          >
            <Text style={[styles.firstVisitSkipText, { color: colors.muted }]}>{t("Skip all tutorials")}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function TutorialSpotlightContent() {
  const {
    activeGuide,
    activeSession,
    activeStep: step,
    finishGuide,
    skipGuide,
    nextStep,
    previousStep,
    reportPracticeAction,
    completePracticeAccessibly,
    requestTargetMeasure,
    requestTargetReveal,
    activatableTargets,
    requestTargetActivation,
    targets,
    isolatedPreviewActive,
    transitionPhase,
    transitionDurationMs,
  } = useTutorial();
  const pathname = usePathname();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const onAccent = readableTextColor(accent);
  const { language, t } = useLocalization();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const overlayRef = useRef<View>(null);
  const accessibilityIntroRef = useRef<View>(null);
  const [overlayOrigin, setOverlayOrigin] = useState({ x: 0, y: 0 });
  const [anchorTimedOut, setAnchorTimedOut] = useState(false);
  const [pageSettled, setPageSettled] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [calloutHeight, setCalloutHeight] = useState(214);
  const [watchPaused, setWatchPaused] = useState(false);
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;
  const curtain = useRef(new Animated.Value(0)).current;
  const pointerProgress = useRef(new Animated.Value(0)).current;
  const routedParameterizedStep = useRef<string | undefined>(undefined);
  const settledPath = useRef<string | undefined>(undefined);
  const settledStep = useRef<string | undefined>(undefined);
  const watchActionStep = useRef<string | undefined>(undefined);
  const watchAdvance = useRef<() => void>(() => undefined);
  const localizedGuide = activeGuide
    ? localizedTutorialGuide(activeGuide, language)
    : undefined;
  const localizedStep = localizedGuide?.steps[activeSession?.stepIndex ?? -1];
  const active =
    Boolean(activeGuide && activeSession && step) && !isBlockedRoute(pathname);
  const stepIdentity = activeSession
    ? `${activeSession.runId}:${activeSession.stepId}`
    : "inactive";
  const currentStepIdentity = useRef(stepIdentity);
  currentStepIdentity.current = stepIdentity;
  useEffect(() => { watchActionStep.current = undefined; }, [stepIdentity]);
  const targetId = step?.anchor?.target ?? step?.target;
  const raw = targetId ? targets[targetId] : undefined;
  const relative = raw ? relativeTargetRect(raw, overlayOrigin) : undefined;
  const rect = relative
    ? spotlightRect(relative, { width, height }, step?.anchor?.padding)
    : undefined;
  const anchorRequired = Boolean(targetId && step?.anchor?.required !== false);
  const demoAnchorDate = activeSession?.demoAnchorDate;
  const waitingForRoute = Boolean(
    step && !routeMatchesStep(pathname, step, demoAnchorDate),
  );
  const waitingForAnchor =
    active && anchorRequired && !rect && !anchorTimedOut && !waitingForRoute;
  const practiceComplete = Boolean(
    step?.interaction?.actionId &&
      activeSession?.practiceActionIds.includes(step.interaction.actionId),
  );
  const observedPractice =
    step?.interaction?.mode === "practice" &&
    step.interaction.completion === "observed-action";
  const anchorActivatable = Boolean(
    targetId && activatableTargets[targetId],
  );
  const practiceCompleteRef = useRef(practiceComplete);
  practiceCompleteRef.current = practiceComplete;
  const watchMode = activeSession?.experienceMode === "watch";
  const watchReadingTime = tutorialReadingTimeMs(
    localizedStep?.title ?? step?.title,
    localizedStep?.copy ?? step?.copy,
    localizedStep?.interaction?.instruction ?? step?.interaction?.instruction,
  );
  const watchTiming = tutorialWatchTiming(watchReadingTime,
    Boolean(step?.interaction?.actionId && anchorActivatable && isolatedPreviewActive),
    step?.interaction?.autoAdvance === true);
  const watchActionDelay = watchTiming.actionAtMs;
  const realPracticeAvailable =
    observedPractice && isolatedPreviewActive && Boolean(rect);
  const canPassThrough =
    !watchMode && realPracticeAvailable;
  const accessibleRehearsalAvailable = Boolean(
    observedPractice &&
      isolatedPreviewActive &&
      step?.interaction?.actionId &&
      !practiceComplete,
  );
  const layout = calloutLayout({
    screen: { width, height },
    spotlight: rect,
    calloutHeight,
    safeTop: insets.top,
    safeBottom: insets.bottom,
  });
  const shadeColor = colors.isDark
    ? "rgba(2,7,18,0.52)"
    : "rgba(8,15,24,0.38)";

  const measureOverlay = useCallback(() => {
    overlayRef.current?.measureInWindow((x, y) => {
      setOverlayOrigin((current) =>
        Math.abs(current.x - x) < 1 && Math.abs(current.y - y) < 1
          ? current
          : { x, y },
      );
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => setWatchPaused(false), [activeSession?.runId]);

  useEffect(() => {
    // React Native Web reports true unconditionally; browsers do not expose
    // screen-reader detection. Keep the explicit accessible Pause control.
    if (Platform.OS === "web") return;
    let mounted = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (mounted) setScreenReaderEnabled(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", setScreenReaderEnabled);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (screenReaderEnabled) setWatchPaused(true);
  }, [screenReaderEnabled, activeSession?.runId]);

  useEffect(() => {
    fade.stopAnimation();
    if (!active || !pageSettled) {
      fade.setValue(0);
      return;
    }
    if (reduceMotion) {
      fade.setValue(1);
      return;
    }
    fade.setValue(0);
    const animation = Animated.timing(fade, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [active, fade, pageSettled, reduceMotion, stepIdentity]);

  useEffect(() => {
    if (!active || waitingForRoute) {
      setPageSettled(false);
      return;
    }
    const settlementKey = `${stepIdentity}:${pathname}`;
    if (settledStep.current === settlementKey) {
      setPageSettled(true);
      return;
    }
    const samePage = settledPath.current === pathname;
    setPageSettled(false);
    const timer = setTimeout(
      () => {
        settledPath.current = pathname;
        settledStep.current = settlementKey;
        setPageSettled(true);
      },
      reduceMotion ? 0 : samePage ? 460 : 950,
    );
    return () => clearTimeout(timer);
  }, [active, pathname, reduceMotion, stepIdentity, waitingForRoute]);

  useEffect(() => {
    if (!active || !step || !pageSettled) return;
    const timer = setTimeout(() => {
      if (Platform.OS === "web") {
        (
          accessibilityIntroRef.current as unknown as HTMLElement | undefined
        )?.focus?.();
        return;
      }
      const node = findNodeHandle(accessibilityIntroRef.current);
      if (node !== null) AccessibilityInfo.setAccessibilityFocus(node);
    }, Platform.OS === "web" || reduceMotion ? 0 : 80);
    return () => clearTimeout(timer);
  }, [active, pageSettled, reduceMotion, step, stepIdentity]);

  useEffect(() => {
    curtain.stopAnimation();
    const covered = transitionPhase === "entering" || transitionPhase === "exiting";
    if (reduceMotion || transitionDurationMs === 0) {
      curtain.setValue(covered ? 1 : 0);
      return;
    }
    const animation = Animated.timing(curtain, {
      toValue: covered ? 1 : 0,
      duration: transitionDurationMs,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [curtain, reduceMotion, transitionDurationMs, transitionPhase]);

  useEffect(() => {
    setAnchorTimedOut(false);
    if (!active || !step || !anchorRequired || rect || waitingForRoute) return;
    const timer = setTimeout(
      () => setAnchorTimedOut(true),
      Math.max(400, step.anchor?.waitMs ?? 1800),
    );
    return () => clearTimeout(timer);
  }, [active, anchorRequired, rect, step, stepIdentity, waitingForRoute]);

  useEffect(() => {
    // A mounted target can still measure below the visible ScrollView. Reveal
    // every target once the user has had a moment to see the new page, then
    // let Screen's scroll listener remeasure the cutout as it moves.
    if (!active || !pageSettled || waitingForRoute || !targetId) return;
    const timers = [120, 520, 1100].map((delay) =>
      setTimeout(() => requestTargetReveal(targetId), delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [
    active,
    pageSettled,
    requestTargetReveal,
    stepIdentity,
    targetId,
    waitingForRoute,
  ]);

  useEffect(() => {
    if (!active || !step || !activeSession) return;
    const route = routeForStep(step, activeSession.demoAnchorDate);
    const pathMatches = routeMatchesStep(
      pathname,
      step,
      activeSession.demoAnchorDate,
    );
    const parameterized = /[?#]/.test(route);
    if (
      pathMatches &&
      (!parameterized || routedParameterizedStep.current === stepIdentity)
    )
      return;
    if (!safeTutorialRoute(route)) return;
    routedParameterizedStep.current = stepIdentity;
    // Give the real control a chance to perform its own navigation first.
    // This avoids replacing a transparent/modal screen while React Navigation
    // is still presenting it, which can leave Android with a blank surface.
    let interaction:
      | ReturnType<typeof InteractionManager.runAfterInteractions>
      | undefined;
    let nativeNavigationWatchdog: ReturnType<typeof setTimeout> | undefined;
    let navigated = false;
    const navigateIfCurrent = () => {
      if (navigated || currentStepIdentity.current !== stepIdentity) return;
      navigated = true;
      router.navigate(route as never);
    };
    const timer = setTimeout(() => {
      // React Native Web can keep InteractionManager busy indefinitely while
      // animated tutorial/Today surfaces are mounted. Route immediately there;
      // on native retain the modal-safety delay, with a bounded watchdog so an
      // unrelated long-running interaction can never strand the guide.
      if (Platform.OS === "web") {
        navigateIfCurrent();
        return;
      }
      interaction = InteractionManager.runAfterInteractions(navigateIfCurrent);
      nativeNavigationWatchdog = setTimeout(navigateIfCurrent, 1_400);
    }, 900);
    return () => {
      clearTimeout(timer);
      if (nativeNavigationWatchdog) clearTimeout(nativeNavigationWatchdog);
      interaction?.cancel();
    };
  }, [active, activeSession, pathname, step, stepIdentity]);

  useEffect(() => {
    if (!active || !step || !targetId) return;
    const refresh = () => {
      measureOverlay();
      requestTargetMeasure(targetId);
    };
    const timers = [0, 70, 180, 420, 900, 1500].map((delay) =>
      setTimeout(refresh, delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [
    active,
    height,
    measureOverlay,
    pathname,
    requestTargetMeasure,
    step,
    stepIdentity,
    targetId,
    width,
  ]);

  const exit = useCallback(() => {
    skipGuide();
    const destination = resolvedTutorialRoute(
      activeSession?.returnPath ?? activeGuide?.path,
      activeSession?.demoAnchorDate,
    );
    if (destination)
      setTimeout(() => router.navigate(destination as never), transitionDurationMs);
  }, [
    activeGuide?.path,
    activeSession?.demoAnchorDate,
    activeSession?.returnPath,
    skipGuide,
    transitionDurationMs,
  ]);

  const advance = useCallback(() => {
    if (!activeSession || !activeGuide || !step) return;
    const isLast = activeSession.stepIndex >= activeGuide.steps.length - 1;
    if (isLast) {
      finishGuide();
      const destination =
        activeGuide.id === "essential"
          ? "/quick-guide?completed=essential"
          : activeSession.returnPath ?? activeGuide.path;
      const resolved = resolvedTutorialRoute(
        destination,
        activeSession.demoAnchorDate,
      );
      if (resolved)
        setTimeout(
          () => router.navigate(resolved as never),
          transitionDurationMs,
        );
      return;
    }

    const explicitDestination = resolvedTutorialRoute(
      step.navigation?.after,
      activeSession.demoAnchorDate,
    );
    nextStep();
    if (!explicitDestination) return;
    setTimeout(() => {
      const returningToTabs = tutorialRoutePath(explicitDestination) === "/";
      if (returningToTabs && pathname === "/view-filters")
        router.dismissTo(explicitDestination as never);
      else router.navigate(explicitDestination as never);
    }, Math.max(40, transitionDurationMs));
  }, [
    activeGuide,
    activeSession,
    finishGuide,
    nextStep,
    pathname,
    step,
    transitionDurationMs,
  ]);
  watchAdvance.current = advance;

  useEffect(() => {
    pointerProgress.stopAnimation();
    pointerProgress.setValue(0);
    if (
      !active ||
      !watchMode ||
      watchPaused ||
      !pageSettled ||
      waitingForRoute ||
      waitingForAnchor
    )
      return;
    if (reduceMotion) {
      pointerProgress.setValue(1);
      return;
    }
    const animation = Animated.sequence([
      Animated.delay(watchActionDelay !== undefined ? Math.max(0, watchActionDelay - 960) : 0),
      Animated.timing(pointerProgress, {
        toValue: 0.72,
        duration: 720,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(pointerProgress, {
        toValue: 1,
        duration: 240,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [
    active,
    pageSettled,
    pointerProgress,
    reduceMotion,
    stepIdentity,
    step?.interaction?.actionId,
    waitingForAnchor,
    waitingForRoute,
    watchMode,
    watchPaused,
    watchActionDelay,
  ]);

  useEffect(() => {
    if (
      !active ||
      !watchMode ||
      watchPaused ||
      !pageSettled ||
      waitingForRoute ||
      waitingForAnchor
    )
      return;
    const actionId = step?.interaction?.actionId;
    // Navigation actions advance immediately when they report success. Give
    // the text its full reading interval before demonstrating that click.
    const actionTimer = actionId && !practiceCompleteRef.current && watchActionDelay !== undefined && isolatedPreviewActive && watchActionStep.current !== stepIdentity
      ? setTimeout(() => {
          if (currentStepIdentity.current !== stepIdentity) return;
          watchActionStep.current = stepIdentity;
          // Only a real handler may report an observed action. Traversal is
          // not evidence that a to-do, edit, chart or workout action happened.
          if (targetId && anchorActivatable) requestTargetActivation(targetId);
        }, watchActionDelay)
      : undefined;
    const advanceTimer = setTimeout(
      () => {
        if (currentStepIdentity.current === stepIdentity) watchAdvance.current();
      },
      watchTiming.advanceAtMs,
    );
    return () => {
      if (actionTimer) clearTimeout(actionTimer);
      clearTimeout(advanceTimer);
    };
  }, [
    active,
    anchorActivatable,
    pageSettled,
    isolatedPreviewActive,
    requestTargetActivation,
    step?.interaction?.actionId,
    step?.interaction?.autoAdvance,
    stepIdentity,
    targetId,
    waitingForAnchor,
    waitingForRoute,
    watchMode,
    watchPaused,
    watchTiming.advanceAtMs,
    watchActionDelay,
  ]);

  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (activeSession && activeSession.stepIndex > 0) previousStep();
        else exit();
        return true;
      },
    );
    return () => subscription.remove();
  }, [active, activeSession, exit, previousStep]);

  if (
    transitionPhase === "idle" &&
    (!active || !activeGuide || !activeSession || !step)
  )
    return null;

  if (!activeGuide || !activeSession || !step || !localizedGuide || !localizedStep)
    return (
      <Animated.View
        pointerEvents="none"
        style={[
          styles.transitionCurtain,
          {
            opacity: curtain,
            backgroundColor: colors.isDark
              ? "rgba(7,17,39,0.76)"
              : "rgba(247,241,222,0.72)",
          },
        ]}
      />
    );

  // Keep the newly opened page completely visible for a beat before drawing
  // the next shade/callout. The route itself remains interactive only after
  // the isolated tutorial target is intentionally exposed below.
  if (transitionPhase === "active" && (waitingForRoute || !pageSettled))
    return null;

  const displayGuide = localizedGuide;
  const displayStep = localizedStep;

  function back() {
    if (activeSession!.stepIndex <= 0) return;
    previousStep();
  }

  function rehearseAnchor() {
    const interaction = step!.interaction;
    if (
      interaction?.mode === "practice" &&
      interaction.actionId &&
      interaction.completion === "tap-anchor"
    )
      reportPracticeAction(interaction.actionId, "tutorial-local");
  }

  function activateOrRehearseAnchor() {
    if (
      observedPractice &&
      targetId &&
      anchorActivatable &&
      requestTargetActivation(targetId)
    )
      return;
    rehearseAnchor();
  }

  const primaryLabel =
    activeSession.stepIndex >= activeGuide.steps.length - 1
      ? t("Finish")
      : (displayStep.primaryLabel ?? t("Next"));
  const sectionTitle = displayGuide.sections?.find(
    (section) => section.id === displayStep.sectionId,
  )?.title;
  const sectionSteps = activeGuide.steps.filter(
    (candidate) => candidate.sectionId === step.sectionId,
  );
  const sectionStepIndex = Math.max(
    0,
    sectionSteps.findIndex((candidate) => candidate.id === step.id),
  );
  const sectionCounter = t("Step {current} of {total}")
    .replace("{current}", String(sectionStepIndex + 1))
    .replace("{total}", String(sectionSteps.length));
  const missingRequiredAnchor = anchorRequired && !rect && anchorTimedOut;
  const nextDisabled =
    !pageSettled ||
    waitingForRoute ||
    waitingForAnchor ||
    (!watchMode && realPracticeAvailable && !practiceComplete);
  const webFocusTrapProps =
    Platform.OS === "web"
      ? {
          onKeyDown: (event: TutorialKeyboardEvent) =>
            trapTutorialFocus(event),
        }
      : {};

  return (
    <Animated.View
      {...webFocusTrapProps}
      ref={overlayRef}
      collapsable={false}
      onLayout={measureOverlay}
      style={[styles.overlay, { opacity: fade }]}
      pointerEvents="box-none"
      accessibilityViewIsModal
      aria-modal
      importantForAccessibility="yes"
      accessibilityLiveRegion="polite"
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.transitionCurtain,
          {
            opacity: curtain,
            backgroundColor: colors.isDark
              ? "rgba(7,17,39,0.76)"
              : "rgba(247,241,222,0.72)",
          },
        ]}
      />
      {rect ? (
        <>
          <View
            pointerEvents="auto"
            style={[styles.shade, { backgroundColor: shadeColor, left: 0, top: 0, right: 0, height: rect.y }]}
          />
          <View
            pointerEvents="auto"
            style={[
              styles.shade,
              { backgroundColor: shadeColor, left: 0, top: rect.y, width: rect.x, height: rect.height },
            ]}
          />
          <View
            pointerEvents="auto"
            style={[
              styles.shade,
              {
                backgroundColor: shadeColor,
                left: rect.x + rect.width,
                right: 0,
                top: rect.y,
                height: rect.height,
              },
            ]}
          />
          <View
            pointerEvents="auto"
            style={[
              styles.shade,
              { backgroundColor: shadeColor, left: 0, right: 0, top: rect.y + rect.height, bottom: 0 },
            ]}
          />
          <Pressable
            pointerEvents={canPassThrough ? "none" : "auto"}
            accessibilityRole="button"
            accessibilityLabel={
              canPassThrough
                ? undefined
                : `${displayStep.title}. ${displayStep.interaction?.instruction ?? t("Highlighted control")}`
            }
            onPress={activateOrRehearseAnchor}
            style={[
              styles.spotlight,
              {
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: rect.height,
                borderColor: practiceComplete ? "#38D996" : accent,
                borderRadius: step.anchor?.radius ?? 16,
              },
            ]}
          />
        </>
      ) : (
        <View
          pointerEvents="auto"
          style={[
            styles.shade,
            StyleSheet.absoluteFill,
            { backgroundColor: shadeColor },
          ]}
        />
      )}

      {watchMode && rect && watchActionDelay !== undefined ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.watchPointer,
            {
              left: rect.x + rect.width / 2 - 20,
              top: rect.y + rect.height / 2 - 20,
              backgroundColor: accent,
              opacity: pointerProgress.interpolate({
                inputRange: [0, 0.28, 1],
                outputRange: [0, 1, 1],
              }),
              transform: [
                {
                  translateY: pointerProgress.interpolate({
                    inputRange: [0, 0.72, 1],
                    outputRange: [-34, 0, 2],
                  }),
                },
                {
                  scale: pointerProgress.interpolate({
                    inputRange: [0, 0.72, 0.88, 1],
                    outputRange: [0.8, 1, 0.84, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <Ionicons name="hand-left" size={21} color={onAccent} />
        </Animated.View>
      ) : null}

      <View
        testID="tutorial-callout"
        onLayout={(event) => setCalloutHeight(event.nativeEvent.layout.height)}
        style={[
          styles.callout,
          {
            left: layout.left,
            top: layout.top,
            width: layout.width,
            // Text must remain readable over charts and dense tracker cards,
            // including browsers and devices without reliable backdrop blur.
            backgroundColor: colors.card,
            borderColor: accent,
          },
        ]}
      >
        <View
          ref={accessibilityIntroRef}
          accessible
          accessibilityRole="header"
          accessibilityLabel={`${displayStep.title}. ${displayStep.copy}${
            displayStep.interaction?.instruction
              ? ` ${displayStep.interaction.instruction}`
              : ""
          }`}
          importantForAccessibility="yes"
          tabIndex={Platform.OS === "web" ? -1 : undefined}
          style={styles.accessibilityIntro}
        />
        <View style={styles.calloutTop}>
          <View style={[styles.stepIcon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons
              name={watchMode ? "play" : step.interaction?.mode === "practice" ? "hand-left" : "navigate"}
              size={17}
              color={accent}
            />
          </View>
          <View style={styles.counterCopy}>
            <Text style={[styles.counter, { color: colors.muted }]}>
              {sectionTitle ? `${sectionTitle} · ` : ""}
              {sectionCounter}
            </Text>
            <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: accent,
                    width: `${((activeSession.stepIndex + 1) / activeGuide.steps.length) * 100}%`,
                  },
                ]}
              />
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Skip {name}").replace("{name}", displayGuide.title)}
            onPress={exit}
            hitSlop={10}
          >
            <Text style={[styles.skip, { color: colors.muted }]}>{t("Skip")}</Text>
          </Pressable>
        </View>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
          {displayStep.title}
        </Text>
        <Text style={[styles.copy, { color: colors.muted }]}>{displayStep.copy}</Text>
        {watchMode ? (
          <View style={[styles.watchStatus, { backgroundColor: colors.primarySoft }]}>
            <View style={styles.watchStatusCopy}>
              <Ionicons
                name={watchPaused ? "pause-circle" : "play-circle"}
                size={16}
                color={accent}
              />
              <Text style={[styles.watchStatusText, { color: colors.ink }]}>
                {t(watchPaused ? "Watch paused" : "Auto-playing this tour")}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(watchPaused ? "Continue watching" : "Pause watch mode")}
              onPress={() => setWatchPaused((paused) => !paused)}
              hitSlop={8}
              style={[styles.watchToggle, { borderColor: accent }]}
            >
              <Text style={[styles.watchToggleText, { color: accent }]}>
                {t(watchPaused ? "Continue" : "Pause")}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {displayStep.interaction?.instruction ? (
          <View style={[styles.practice, { backgroundColor: colors.primarySoft }]}>
            <Ionicons
              name={practiceComplete ? "checkmark-circle" : "finger-print-outline"}
              size={16}
              color={practiceComplete ? "#149D67" : accent}
            />
            <Text style={[styles.practiceText, { color: colors.ink }]}>
              {practiceComplete ? t("Nice - practice complete.") : watchMode && !anchorActivatable
                ? t("Read this step, then try the action in Practice.")
                : displayStep.interaction.instruction}
            </Text>
          </View>
        ) : null}
        {!watchMode && accessibleRehearsalAvailable && step.interaction?.actionId ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Complete simulated practice")}
            accessibilityHint={t(
              "This marks only the tutorial step complete. It does not activate the highlighted control.",
            )}
            onPress={() => {
              const actionId = step.interaction?.actionId;
              if (actionId) completePracticeAccessibly(actionId);
            }}
            style={[
              styles.accessiblePractice,
              { borderColor: colors.border },
            ]}
          >
            <Ionicons
              name="accessibility-outline"
              size={15}
              color={accent}
            />
            <Text style={[styles.accessiblePracticeText, { color: accent }]}>
              {"Complete simulated practice"}
            </Text>
          </Pressable>
        ) : null}
        {missingRequiredAnchor ? (
          <Text style={[styles.anchorNote, { color: colors.muted }]}>
            {t("This control is not available in the current layout. You can still continue and revisit this guide later.")}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Previous tutorial step")}
            accessibilityState={{ disabled: activeSession.stepIndex <= 0 }}
            disabled={activeSession.stepIndex <= 0}
            onPress={back}
            style={[
              styles.backButton,
              { borderColor: colors.border },
              activeSession.stepIndex <= 0 && styles.disabled,
            ]}
          >
            <Ionicons name="arrow-back" size={16} color={colors.ink} />
            <Text style={[styles.backText, { color: colors.ink }]}>{t("Back")}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={primaryLabel}
            testID="tutorial-next"
            accessibilityState={{ disabled: nextDisabled }}
            disabled={nextDisabled}
            onPress={advance}
            style={[
              styles.button,
              { backgroundColor: accent },
              nextDisabled && styles.disabled,
            ]}
          >
            {waitingForAnchor || waitingForRoute ? (
              <Ionicons name="ellipsis-horizontal" size={17} color={onAccent} />
            ) : null}
            <Text preserveColor style={[styles.buttonText, { color: onAccent }]}>{primaryLabel}</Text>
            {!waitingForAnchor && !waitingForRoute ? (
              <Ionicons
                name={
                  activeSession.stepIndex >= activeGuide.steps.length - 1
                    ? "checkmark"
                    : "arrow-forward"
                }
                size={16}
                color={onAccent}
              />
            ) : null}
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  firstVisitLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9998,
    elevation: 9998,
    justifyContent: "flex-end",
    padding: 14,
  },
  firstVisitCard: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    borderWidth: 1,
    borderRadius: 20,
    padding: 13,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
  },
  firstVisitIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  firstVisitCopy: { flex: 1, gap: 4 },
  firstVisitTitle: { fontSize: 14, lineHeight: 19, fontWeight: "900" },
  firstVisitDetail: { fontSize: 12, lineHeight: 18 },
  firstVisitActions: {
    marginTop: 7,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 7,
  },
  firstVisitSkip: {
    minHeight: 44,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  firstVisitSkipText: { fontSize: 11, fontWeight: "800" },
  firstVisitSkipAll: { minHeight: 44, alignItems: "center", justifyContent: "center", alignSelf: "stretch" },
  firstVisitChoice: {
    minHeight: 44,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  firstVisitChoiceText: { fontSize: 11, fontWeight: "900" },
  firstVisitPracticeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10000,
    elevation: 10000,
  },
  transitionCurtain: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10002,
    elevation: 10002,
  },
  shade: { position: "absolute" },
  spotlight: {
    position: "absolute",
    borderWidth: 3,
    backgroundColor: "transparent",
    shadowColor: "#000000",
    shadowOpacity: Platform.OS === "web" ? 0.3 : 0,
    shadowRadius: 10,
  },
  watchPointer: {
    position: "absolute",
    zIndex: 10001,
    elevation: 10001,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#000000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  callout: {
    position: "absolute",
    maxHeight: "82%",
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 20,
  },
  accessibilityIntro: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
  },
  calloutTop: { flexDirection: "row", alignItems: "center", gap: 9 },
  stepIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  counterCopy: { flex: 1, gap: 5 },
  counter: { fontSize: 10, fontWeight: "800" },
  progressTrack: { height: 3, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: 3, borderRadius: 2 },
  skip: { fontSize: 11, fontWeight: "900", paddingVertical: 4 },
  title: { fontSize: 17, fontWeight: "900", marginTop: 12 },
  copy: { fontSize: 12, lineHeight: 18, marginTop: 6 },
  watchStatus: {
    marginTop: 10,
    minHeight: 38,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  watchStatusCopy: { flex: 1, flexDirection: "row", alignItems: "center", gap: 7 },
  watchStatusText: { flex: 1, fontSize: 10, lineHeight: 14, fontWeight: "800" },
  watchToggle: {
    minHeight: 44,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  watchToggleText: { fontSize: 11, fontWeight: "900" },
  practice: {
    marginTop: 10,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  practiceText: { flex: 1, fontSize: 11, lineHeight: 16, fontWeight: "700" },
  accessiblePractice: {
    minHeight: 38,
    marginTop: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  accessiblePracticeText: { fontSize: 10, lineHeight: 15, fontWeight: "900" },
  anchorNote: { fontSize: 10, lineHeight: 15, marginTop: 9 },
  actions: { flexDirection: "row", gap: 9, marginTop: 14 },
  backButton: {
    minHeight: 44,
    minWidth: 88,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  backText: { fontSize: 11, fontWeight: "900" },
  button: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 13,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  buttonText: { color: palette.white, fontSize: 11, fontWeight: "900" },
  disabled: { opacity: 0.42 },
});
