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
import { AccessibilityInfo } from "react-native";

import { useApp } from "@/src/state/AppProvider";
import {
  clearActiveTutorial,
  readActiveTutorial,
  readTutorialProgress,
  writeActiveTutorial,
  writeTutorialProgress,
} from "@/src/tutorial/storage";
import {
  createTutorialSession,
  moveTutorialSession,
  reanchorTutorialSession,
  recordTutorialPracticeAction,
  sessionProgress,
  tutorialCloseSettings,
  tutorialGuideTrigger,
  tutorialSessionBlocksTrigger,
} from "@/src/tutorial/session";
import type {
  ActiveTutorialSession,
  TutorialGuide,
  TutorialEvent,
  TutorialProgress,
  TutorialStep,
  TutorialStartOptions,
} from "@/src/tutorial/types";
import type { TutorialRect } from "@/src/tutorial/geometry";
import { TUTORIAL_GUIDES } from "@/src/tutorial/guides";

type TargetRegistration = TutorialRect & { measuredAt: number };
type TargetInstances = Map<string, Map<number, TargetRegistration>>;

type TutorialContextValue = {
  guides: readonly TutorialGuide[];
  activeGuide?: TutorialGuide;
  activeStep?: TutorialStep;
  activeSession: ActiveTutorialSession | null;
  activeSectionId?: string;
  demoStateKey?: string;
  demoAnchorDate?: string;
  isolatedPreviewActive: boolean;
  transitionPhase:
    | "idle"
    | "entering"
    | "active"
    | "exiting"
    | "revealing";
  transitionDurationMs: number;
  progressByGuide: Record<string, TutorialProgress | undefined>;
  hydrated: boolean;
  startGuide: (guideId: string, options?: TutorialStartOptions) => boolean;
  nextStep: () => boolean;
  previousStep: () => boolean;
  finishGuide: () => void;
  skipGuide: () => void;
  reportPracticeAction: (
    actionId: string,
    scope?: "tutorial-local" | "isolated-preview",
  ) => boolean;
  completePracticeAccessibly: (actionId: string) => boolean;
  reportEvent: (event: TutorialEvent) => boolean;
  registerIsolatedPreview: (
    instanceId: number,
    demoStateKey?: string,
  ) => void;
  unregisterIsolatedPreview: (instanceId: number) => void;
  targets: Record<string, TutorialRect | undefined>;
  registerTarget: (
    id: string,
    instanceId: number,
    rect: TutorialRect,
  ) => void;
  unregisterTarget: (id: string, instanceId: number) => void;
  setTargetMeasurer: (
    id: string,
    instanceId: number,
    measure?: () => void,
  ) => void;
  requestTargetMeasure: (id: string) => void;
  setTargetRevealer: (
    id: string,
    instanceId: number,
    reveal?: () => void,
  ) => void;
  requestTargetReveal: (id: string) => void;
};

const TutorialContext = createContext<TutorialContextValue | null>(null);
const TUTORIAL_TRANSITION_MS = 180;

function currentTarget(
  instances: Map<number, TargetRegistration> | undefined,
): TargetRegistration | undefined {
  if (!instances?.size) return undefined;
  return [...instances.values()]
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .sort((left, right) => right.measuredAt - left.measuredAt)[0];
}

export function TutorialProvider({
  children,
  guides = TUTORIAL_GUIDES,
}: PropsWithChildren<{ guides?: readonly TutorialGuide[] }>) {
  const { state, updateSettings, flushLocalPersistence } = useApp();
  const accountId = state.currentUserId || "anonymous";
  const [activeSession, setActiveSessionState] =
    useState<ActiveTutorialSession | null>(null);
  const activeSessionRef = useRef(activeSession);
  const pendingSessionRef = useRef<ActiveTutorialSession | null>(null);
  const transitionTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [transitionPhase, setTransitionPhase] = useState<
    "idle" | "entering" | "active" | "exiting" | "revealing"
  >("idle");
  const [reduceMotion, setReduceMotion] = useState(false);
  const transitionDurationMs = reduceMotion ? 0 : TUTORIAL_TRANSITION_MS;
  const transitionDurationRef = useRef(transitionDurationMs);
  const [progressByGuide, setProgressByGuide] = useState<
    Record<string, TutorialProgress | undefined>
  >({});
  const [hydrated, setHydrated] = useState(false);
  const targetInstances = useRef<TargetInstances>(new Map());
  const targetMeasurers = useRef(
    new Map<string, Map<number, () => void>>(),
  );
  const targetRevealers = useRef(
    new Map<string, Map<number, () => void>>(),
  );
  const [targets, setTargets] = useState<
    Record<string, TutorialRect | undefined>
  >({});
  const storageQueue = useRef(Promise.resolve());
  const handledSettingsTrigger = useRef<string | undefined>(undefined);
  const previewInstances = useRef(
    new Map<number, { demoStateKey?: string; mountedAt: number }>(),
  );
  const [previewBoundary, setPreviewBoundary] = useState<{
    demoStateKey?: string;
  } | null>(null);
  const guideSignature = useMemo(
    () => guides.map((guide) => `${guide.id}@${guide.version}`).join("|"),
    [guides],
  );
  const guideMap = useMemo(
    () => new Map(guides.map((guide) => [guide.id, guide])),
    [guides],
  );

  const setActiveSession = useCallback(
    (session: ActiveTutorialSession | null) => {
      activeSessionRef.current = session;
      setActiveSessionState(session);
    },
    [],
  );

  const clearTransitionTimers = useCallback(() => {
    transitionTimers.current.forEach(clearTimeout);
    transitionTimers.current = [];
  }, []);

  const scheduleTransition = useCallback(
    (work: () => void, delay: number) => {
      const timer = setTimeout(() => {
        transitionTimers.current = transitionTimers.current.filter(
          (candidate) => candidate !== timer,
        );
        work();
      }, delay);
      transitionTimers.current.push(timer);
    },
    [],
  );

  const enterSession = useCallback(
    (session: ActiveTutorialSession) => {
      clearTransitionTimers();
      pendingSessionRef.current = session;
      setTransitionPhase("entering");
      scheduleTransition(() => {
        const pending = pendingSessionRef.current;
        if (!pending) return;
        pendingSessionRef.current = null;
        setActiveSession(pending);
        setTransitionPhase("active");
      }, transitionDurationRef.current);
    },
    [clearTransitionTimers, scheduleTransition, setActiveSession],
  );

  useEffect(() => {
    transitionDurationRef.current = transitionDurationMs;
  }, [transitionDurationMs]);

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

  useEffect(() => clearTransitionTimers, [clearTransitionTimers]);

  const enqueueStorage = useCallback((work: () => Promise<unknown>) => {
    storageQueue.current = storageQueue.current
      .catch(() => undefined)
      .then(work)
      .then(() => undefined);
  }, []);

  const persistSession = useCallback(
    (session: ActiveTutorialSession) => {
      const progress = sessionProgress(session, false);
      setProgressByGuide((current) => ({
        ...current,
        [session.guideId]: progress,
      }));
      enqueueStorage(async () => {
        await writeActiveTutorial(accountId, session);
        await writeTutorialProgress(accountId, progress);
      });
    },
    [accountId, enqueueStorage],
  );

  useEffect(() => {
    let cancelled = false;
    handledSettingsTrigger.current = undefined;
    clearTransitionTimers();
    pendingSessionRef.current = null;
    setTransitionPhase("idle");
    setHydrated(false);
    setActiveSession(null);
    Promise.all([
      readActiveTutorial(accountId, guides),
      Promise.all(
        guides.map(async (guide) => [
          guide.id,
          await readTutorialProgress(accountId, guide),
        ] as const),
      ),
    ])
      .then(([storedActive, storedProgress]) => {
        if (cancelled) return;
        const progress = Object.fromEntries(
          storedProgress.filter((entry) => Boolean(entry[1])),
        ) as Record<string, TutorialProgress | undefined>;
        setProgressByGuide(progress);
        if (storedActive) {
          const resumed = reanchorTutorialSession(storedActive);
          enterSession(resumed);
          if (resumed !== storedActive) persistSession(resumed);
        }
        else setActiveSession(null);
        setHydrated(true);
      })
      .catch(() => {
        if (cancelled) return;
        setProgressByGuide({});
        setActiveSession(null);
        setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [
    accountId,
    clearTransitionTimers,
    enterSession,
    guideSignature,
    guides,
    persistSession,
    setActiveSession,
  ]);

  const startGuide = useCallback(
    (guideId: string, options?: TutorialStartOptions) => {
      const guide = guideMap.get(guideId);
      if (!guide?.steps.length) return false;
      const session = createTutorialSession(guide, {
        progress: progressByGuide[guide.id],
        resume: options?.resume,
        stepId: options?.stepId,
      });
      enterSession(session);
      persistSession(session);
      return true;
    },
    [enterSession, guideMap, persistSession, progressByGuide],
  );

  useEffect(() => {
    if (!hydrated || !state.settings.onboardingComplete) return;
    const guideId = tutorialGuideTrigger({
      tutorialComplete: state.settings.tutorialComplete,
      tutorialGuideId: state.settings.tutorialGuideId,
    });
    if (!guideId || !guideMap.has(guideId)) return;
    const trigger = `${accountId}:${guideId}:${state.settings.tutorialGuideRunId ?? "resume"}`;
    if (handledSettingsTrigger.current === trigger) return;
    handledSettingsTrigger.current = trigger;
    if (
      tutorialSessionBlocksTrigger(
        activeSessionRef.current?.guideId,
        pendingSessionRef.current?.guideId,
      )
    )
      return;
    const replay = state.settings.tutorialGuideRunId !== undefined;
    startGuide(guideId, { resume: !replay });
  }, [
    accountId,
    guideMap,
    hydrated,
    startGuide,
    state.settings.onboardingComplete,
    state.settings.tutorialComplete,
    state.settings.tutorialGuideId,
    state.settings.tutorialGuideRunId,
  ]);

  const nextStep = useCallback(() => {
    const session = activeSessionRef.current;
    const guide = session ? guideMap.get(session.guideId) : undefined;
    if (!session || !guide || session.stepIndex >= guide.steps.length - 1)
      return false;
    const next = moveTutorialSession(guide, session, 1);
    setActiveSession(next);
    persistSession(next);
    return true;
  }, [guideMap, persistSession, setActiveSession]);

  const previousStep = useCallback(() => {
    const session = activeSessionRef.current;
    const guide = session ? guideMap.get(session.guideId) : undefined;
    if (!session || !guide || session.stepIndex <= 0) return false;
    const next = moveTutorialSession(guide, session, -1);
    setActiveSession(next);
    persistSession(next);
    return true;
  }, [guideMap, persistSession, setActiveSession]);

  const closeGuide = useCallback(
    (completed: boolean) => {
      const session = activeSessionRef.current;
      if (!session) return;
      const progress = sessionProgress(session, completed);
      setProgressByGuide((current) => ({
        ...current,
        [session.guideId]: progress,
      }));
      if (transitionPhase === "exiting" || transitionPhase === "revealing")
        return;
      updateSettings(
        tutorialCloseSettings(session.guideId, completed, {
          tutorialComplete: state.settings.tutorialComplete,
          advancedTutorialComplete:
            state.settings.advancedTutorialComplete ?? false,
        }),
      );
      enqueueStorage(() => flushLocalPersistence());
      enqueueStorage(async () => {
        await writeTutorialProgress(accountId, progress);
        await clearActiveTutorial(accountId);
      });
      clearTransitionTimers();
      setTransitionPhase("exiting");
      scheduleTransition(() => {
        pendingSessionRef.current = null;
        setActiveSession(null);
        setTransitionPhase("revealing");
        scheduleTransition(
          () => setTransitionPhase("idle"),
          transitionDurationMs,
        );
      }, transitionDurationMs);
    },
    [
      accountId,
      clearTransitionTimers,
      enqueueStorage,
      flushLocalPersistence,
      scheduleTransition,
      setActiveSession,
      state.settings.advancedTutorialComplete,
      state.settings.tutorialComplete,
      transitionDurationMs,
      transitionPhase,
      updateSettings,
    ],
  );

  const finishGuide = useCallback(() => closeGuide(true), [closeGuide]);
  const skipGuide = useCallback(() => closeGuide(false), [closeGuide]);

  const storePracticeAction = useCallback(
    (
      guide: TutorialGuide,
      session: ActiveTutorialSession,
      actionId: string,
      autoAdvance: boolean,
    ) => {
      const next = recordTutorialPracticeAction(guide, session, actionId, {
        autoAdvance,
      });
      setActiveSession(next);
      persistSession(next);
      return true;
    },
    [persistSession, setActiveSession],
  );

  const reportPracticeAction = useCallback(
    (
      actionId: string,
      scope: "tutorial-local" | "isolated-preview" = "tutorial-local",
    ) => {
      const session = activeSessionRef.current;
      const guide = session ? guideMap.get(session.guideId) : undefined;
      const step = guide?.steps[session?.stepIndex ?? -1];
      const interaction = step?.interaction;
      if (
        !session ||
        !guide ||
        interaction?.mode !== "practice" ||
        interaction.actionId !== actionId
      )
        return false;
      // An observed application action is intentionally ignored unless a
      // future, explicit preview-state boundary supplies an isolated scope.
      if (
        interaction.completion === "observed-action" &&
        (scope !== "isolated-preview" || !previewBoundary)
      )
        return false;
      return storePracticeAction(
        guide,
        session,
        actionId,
        scope === "isolated-preview" && interaction.autoAdvance === true,
      );
    },
    [guideMap, previewBoundary, storePracticeAction],
  );

  const completePracticeAccessibly = useCallback(
    (actionId: string) => {
      const session = activeSessionRef.current;
      const guide = session ? guideMap.get(session.guideId) : undefined;
      const step = guide?.steps[session?.stepIndex ?? -1];
      const interaction = step?.interaction;
      if (
        !session ||
        !guide ||
        !previewBoundary ||
        interaction?.mode !== "practice" ||
        interaction.completion !== "observed-action" ||
        interaction.actionId !== actionId
      )
        return false;
      // This is an explicit accessible rehearsal, not an application event.
      // It records tutorial metadata only and leaves Next under user control.
      return storePracticeAction(guide, session, actionId, false);
    },
    [guideMap, previewBoundary, storePracticeAction],
  );

  const reportEvent = useCallback(
    (event: TutorialEvent) =>
      reportPracticeAction(event.actionId, event.scope),
    [reportPracticeAction],
  );

  const refreshPreviewBoundary = useCallback(() => {
    const newest = [...previewInstances.current.values()].sort(
      (left, right) => right.mountedAt - left.mountedAt,
    )[0];
    setPreviewBoundary(newest ? { demoStateKey: newest.demoStateKey } : null);
  }, []);

  const registerIsolatedPreview = useCallback(
    (instanceId: number, demoStateKey?: string) => {
      previewInstances.current.set(instanceId, {
        demoStateKey,
        mountedAt: Date.now(),
      });
      refreshPreviewBoundary();
    },
    [refreshPreviewBoundary],
  );

  const unregisterIsolatedPreview = useCallback(
    (instanceId: number) => {
      previewInstances.current.delete(instanceId);
      refreshPreviewBoundary();
    },
    [refreshPreviewBoundary],
  );

  const publishTarget = useCallback((id: string) => {
    const rect = currentTarget(targetInstances.current.get(id));
    setTargets((current) => {
      const previous = current[id];
      if (
        previous &&
        rect &&
        Math.abs(previous.x - rect.x) < 1 &&
        Math.abs(previous.y - rect.y) < 1 &&
        Math.abs(previous.width - rect.width) < 1 &&
        Math.abs(previous.height - rect.height) < 1
      )
        return current;
      if (!previous && !rect) return current;
      const next = { ...current };
      if (rect) next[id] = rect;
      else delete next[id];
      return next;
    });
  }, []);

  const registerTarget = useCallback(
    (id: string, instanceId: number, rect: TutorialRect) => {
      let instances = targetInstances.current.get(id);
      if (!instances) {
        instances = new Map();
        targetInstances.current.set(id, instances);
      }
      instances.set(instanceId, { ...rect, measuredAt: Date.now() });
      publishTarget(id);
    },
    [publishTarget],
  );

  const unregisterTarget = useCallback(
    (id: string, instanceId: number) => {
      const instances = targetInstances.current.get(id);
      instances?.delete(instanceId);
      if (!instances?.size) targetInstances.current.delete(id);
      publishTarget(id);
    },
    [publishTarget],
  );

  const setTargetMeasurer = useCallback(
    (id: string, instanceId: number, measure?: () => void) => {
      let instances = targetMeasurers.current.get(id);
      if (!instances && measure) {
        instances = new Map();
        targetMeasurers.current.set(id, instances);
      }
      if (measure) instances?.set(instanceId, measure);
      else instances?.delete(instanceId);
      if (!instances?.size) targetMeasurers.current.delete(id);
    },
    [],
  );

  const requestTargetMeasure = useCallback((id: string) => {
    targetMeasurers.current.get(id)?.forEach((measure) => measure());
  }, []);

  const setTargetRevealer = useCallback(
    (id: string, instanceId: number, reveal?: () => void) => {
      let instances = targetRevealers.current.get(id);
      if (!instances && reveal) {
        instances = new Map();
        targetRevealers.current.set(id, instances);
      }
      if (reveal) instances?.set(instanceId, reveal);
      else instances?.delete(instanceId);
      if (!instances?.size) targetRevealers.current.delete(id);
    },
    [],
  );

  const requestTargetReveal = useCallback((id: string) => {
    targetRevealers.current.get(id)?.forEach((reveal) => reveal());
  }, []);

  const activeGuide = activeSession
    ? guideMap.get(activeSession.guideId)
    : undefined;
  const activeStep = activeGuide?.steps[activeSession?.stepIndex ?? -1];
  const value = useMemo<TutorialContextValue>(
    () => ({
      guides,
      activeGuide,
      activeStep,
      activeSession,
      activeSectionId: activeStep?.sectionId,
      demoStateKey: previewBoundary?.demoStateKey,
      demoAnchorDate: activeSession?.demoAnchorDate,
      isolatedPreviewActive: Boolean(previewBoundary),
      transitionPhase,
      transitionDurationMs,
      progressByGuide,
      hydrated,
      startGuide,
      nextStep,
      previousStep,
      finishGuide,
      skipGuide,
      reportPracticeAction,
      completePracticeAccessibly,
      reportEvent,
      registerIsolatedPreview,
      unregisterIsolatedPreview,
      targets,
      registerTarget,
      unregisterTarget,
      setTargetMeasurer,
      requestTargetMeasure,
      setTargetRevealer,
      requestTargetReveal,
    }),
    [
      activeGuide,
      activeStep,
      activeSession,
      finishGuide,
      guides,
      hydrated,
      nextStep,
      previousStep,
      progressByGuide,
      registerTarget,
      registerIsolatedPreview,
      completePracticeAccessibly,
      reportPracticeAction,
      reportEvent,
      requestTargetMeasure,
      requestTargetReveal,
      setTargetRevealer,
      setTargetMeasurer,
      skipGuide,
      startGuide,
      targets,
      previewBoundary,
      transitionDurationMs,
      transitionPhase,
      unregisterIsolatedPreview,
      unregisterTarget,
    ],
  );
  return (
    <TutorialContext.Provider value={value}>
      {children}
    </TutorialContext.Provider>
  );
}

export function useTutorial() {
  const value = useContext(TutorialContext);
  if (!value)
    throw new Error("useTutorial must be used inside TutorialProvider");
  return value;
}

export function useOptionalTutorial() {
  return useContext(TutorialContext);
}

let previewInstanceSequence = 0;

/**
 * Register this only inside an ephemeral AppProvider whose persistence, cloud,
 * notifications, health sync, and native bridges are disabled. The tutorial
 * engine uses the registration as the sole permission for pass-through
 * practice actions; this component does not itself claim to isolate state.
 */
export function TutorialIsolatedPreviewBoundary({
  children,
  demoStateKey,
}: PropsWithChildren<{ demoStateKey?: string }>) {
  const { registerIsolatedPreview, unregisterIsolatedPreview } = useTutorial();
  const instanceId = useRef(++previewInstanceSequence).current;
  useEffect(() => {
    registerIsolatedPreview(instanceId, demoStateKey);
    return () => unregisterIsolatedPreview(instanceId);
  }, [
    demoStateKey,
    instanceId,
    registerIsolatedPreview,
    unregisterIsolatedPreview,
  ]);
  return <>{children}</>;
}
