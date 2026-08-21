import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { router, usePathname } from "expo-router";
import React, {
  PropsWithChildren,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  BackHandler,
  findNodeHandle,
  InteractionManager,
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
import {
  calloutLayout,
  relativeTargetRect,
  spotlightRect,
} from "@/src/tutorial/geometry";
import { BASIC_TUTORIAL_GUIDE } from "@/src/tutorial/basicGuide";
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
} from "@/src/tutorial/session";
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
}: PropsWithChildren<{
  id: string;
  style?: StyleProp<ViewStyle>;
  reveal?: () => void;
  onTutorialActivate?: () => void;
}>) {
  const tutorial = useOptionalTutorial();
  const scrollContext = React.useContext(TutorialScrollContext);
  const ref = useRef<View>(null);
  const lastWindowY = useRef(0);
  const autoRevealDoneRef = useRef(false);
  const autoRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const instanceId = useRef(++targetInstanceSequence).current;
  const { height: windowHeight } = useWindowDimensions();
  const activeTargetId =
    tutorial?.activeStep?.anchor?.target ?? tutorial?.activeStep?.target;
  const enabled = activeTargetId === id;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const registerTarget = tutorial?.registerTarget;
  const unregisterTarget = tutorial?.unregisterTarget;
  const setTargetMeasurer = tutorial?.setTargetMeasurer;
  const setTargetRevealer = tutorial?.setTargetRevealer;
  const setTargetActivator = tutorial?.setTargetActivator;
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
    setTargetActivator?.(id, instanceId, onTutorialActivate);
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
    id,
    instanceId,
    measure,
    measureNow,
    onTutorialActivate,
    reveal,
    scrollContext,
    setTargetMeasurer,
    setTargetActivator,
    setTargetRevealer,
    unregisterTarget,
  ]);

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

export function TutorialSpotlight() {
  const tutorial = useOptionalTutorial();
  if (!tutorial) return null;
  return <TutorialSpotlightContent />;
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
  const fade = useRef(new Animated.Value(0)).current;
  const curtain = useRef(new Animated.Value(0)).current;
  const routedParameterizedStep = useRef<string | undefined>(undefined);
  const settledPath = useRef<string | undefined>(undefined);
  const settledStep = useRef<string | undefined>(undefined);
  const localizedGuide = activeGuide
    ? localizedTutorialGuide(activeGuide, language)
    : undefined;
  const localizedStep = localizedGuide?.steps[activeSession?.stepIndex ?? -1];
  const active =
    Boolean(activeGuide && activeSession && step) && !isBlockedRoute(pathname);
  const stepIdentity = activeSession
    ? `${activeSession.runId}:${activeSession.stepId}`
    : "inactive";
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
  const realPracticeAvailable =
    observedPractice && isolatedPreviewActive && Boolean(rect);
  const canPassThrough = realPracticeAvailable && !anchorActivatable;
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
    const timer = setTimeout(() => {
      interaction = InteractionManager.runAfterInteractions(() =>
        router.navigate(route as never),
      );
    }, 900);
    return () => {
      clearTimeout(timer);
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
      activeGuide?.path,
      activeSession?.demoAnchorDate,
    );
    if (destination)
      setTimeout(() => router.navigate(destination as never), transitionDurationMs);
  }, [
    activeGuide?.path,
    activeSession?.demoAnchorDate,
    skipGuide,
    transitionDurationMs,
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

  function advance() {
    const isLast = activeSession!.stepIndex >= activeGuide!.steps.length - 1;
    if (isLast) {
      finishGuide();
      const destination =
        activeGuide!.id === "essential"
          ? "/quick-guide?completed=essential"
          : activeGuide!.path;
      const resolved = resolvedTutorialRoute(
        destination,
        activeSession!.demoAnchorDate,
      );
      if (resolved)
        setTimeout(() => router.navigate(resolved as never), transitionDurationMs);
      return;
    }
    // The next step owns its required route. Route enforcement waits briefly
    // and navigates only if the successful app action did not already do so.
    nextStep();
  }

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
  const missingRequiredAnchor = anchorRequired && !rect && anchorTimedOut;
  const nextDisabled =
    !pageSettled ||
    waitingForRoute ||
    waitingForAnchor ||
    (realPracticeAvailable && !practiceComplete);
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

      <View
        testID="tutorial-callout"
        onLayout={(event) => setCalloutHeight(event.nativeEvent.layout.height)}
        style={[
          styles.callout,
          {
            left: layout.left,
            top: layout.top,
            width: layout.width,
            // The callout is glass over the live app, not a colored card. BlurView
            // supplies the readable tint while this low-alpha wash avoids an
            // opaque block on platforms whose blur warms up a frame late.
            backgroundColor: colors.isDark
              ? "rgba(8,18,34,0.08)"
              : "rgba(255,255,255,0.06)",
            borderColor: accent,
          },
        ]}
      >
        <BlurView
          pointerEvents="none"
          intensity={Platform.OS === "android" ? 34 : 48}
          tint={
            colors.isDark
              ? "systemUltraThinMaterialDark"
              : "systemUltraThinMaterial"
          }
          experimentalBlurMethod={
            Platform.OS === "android" ? "dimezisBlurView" : undefined
          }
          style={styles.calloutBlur}
        />
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
              name={step.interaction?.mode === "practice" ? "hand-left" : "navigate"}
              size={17}
              color={accent}
            />
          </View>
          <View style={styles.counterCopy}>
            <Text style={[styles.counter, { color: colors.muted }]}>
              {sectionTitle ? `${sectionTitle} / ` : ""}
              {activeSession.stepIndex + 1}/{activeGuide.steps.length}
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
        {displayStep.interaction?.instruction ? (
          <View style={[styles.practice, { backgroundColor: colors.primarySoft }]}>
            <Ionicons
              name={practiceComplete ? "checkmark-circle" : "finger-print-outline"}
              size={16}
              color={practiceComplete ? "#149D67" : accent}
            />
            <Text style={[styles.practiceText, { color: colors.ink }]}>
              {practiceComplete ? t("Nice - practice complete.") : displayStep.interaction.instruction}
            </Text>
          </View>
        ) : null}
        {accessibleRehearsalAvailable && step.interaction?.actionId ? (
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
              <Ionicons name="ellipsis-horizontal" size={17} color={palette.white} />
            ) : null}
            <Text preserveColor style={styles.buttonText}>{primaryLabel}</Text>
            {!waitingForAnchor && !waitingForRoute ? (
              <Ionicons
                name={
                  activeSession.stepIndex >= activeGuide.steps.length - 1
                    ? "checkmark"
                    : "arrow-forward"
                }
                size={16}
                color={palette.white}
              />
            ) : null}
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
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
  calloutBlur: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    overflow: "hidden",
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
