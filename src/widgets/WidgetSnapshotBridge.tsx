import { useEffect, useRef } from "react";
import { AppState as NativeAppState, Image } from "react-native";

import { dateKey } from "@/src/domain/date";
import { stateWithoutGoogleHealthLocalData } from "@/src/domain/googleHealthLocalPrivacy";
import { useLocalization } from "@/src/i18n";
import { useApp } from "@/src/state/AppProvider";
import {
  statusBodyAppearance,
  statusBodyCompositionForSource,
} from "@/src/domain/statusAvatar";
import { statusAvatarAtlasBlend } from "@/src/domain/statusAvatarAtlas";
import { statusAvatarBodyProgression } from "@/src/domain/status";
import { STATUS_AVATAR_SPRITES } from "@/src/generated/statusAvatarSprites";
import { useAppColors, useGroupAccent } from "@/src/theme";
import type { AppLanguage, AppState } from "@/src/types";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";
import {
  featuredWidgetSnapshot,
  statusWidgetSnapshot,
} from "@/src/widgets/snapshot";
import {
  areHomeScreenWidgetsSupported,
  getHomeScreenWidgetConfigurations,
  updateHomeScreenWidgets,
  WidgetSnapshot,
  WidgetAvatarSnapshot,
} from "@/src/widgets";

function avatarSnapshot(
  state: AppState,
  today: string,
  language: AppLanguage,
  backgroundColor: string,
  completedBackgroundColor: string,
): WidgetAvatarSnapshot {
  const profile =
    state.energyProfiles?.[state.currentUserId] ?? state.settings.energyProfile;
  // Widgets never render the earned mind tier. Use the body-only projection
  // so an ordinary widget refresh cannot scan years of mind-goal history.
  const progression = statusAvatarBodyProgression(
    state,
    state.currentUserId,
    today,
  );
  const calculationSource =
    state.settings.statusAvatarCalculationSource ?? "bmi";
  const appearance = statusBodyAppearance(
    profile.heightCm,
    progression.currentWeightKg,
    progression.muscleProgress,
    statusBodyCompositionForSource(calculationSource, {
      bodyFatPercent: progression.currentBodyFatPercent,
      leanBodyMassKg: progression.currentLeanBodyMassKg,
      sex: profile.sex,
    }),
  );
  const blend = statusAvatarAtlasBlend(
    profile.sex,
    appearance.adiposity,
    appearance.muscleProgress,
  );
  const selected = blend.samples[0];
  const sprite = STATUS_AVATAR_SPRITES[blend.variant][selected.row][
    selected.column
  ];
  const resolved = Image.resolveAssetSource(sprite);
  return statusWidgetSnapshot(
    state,
    today,
    language,
    { backgroundColor, completedBackgroundColor },
    {
      avatarUri: resolved?.uri,
      avatarStyle: state.settings.statusAvatarStyle ?? "silhouette",
      heightScale: appearance.heightScale,
    },
  );
}

/** Keeps Android widgets current without blocking navigation or app startup. */
export function WidgetSnapshotBridge() {
  const { state, hydrated } = useApp();
  const tutorialSandbox = useTutorialSandboxActive();
  const { language, t } = useLocalization();
  const accent = useGroupAccent();
  const colors = useAppColors();
  const lastPayloadRef = useRef("");
  const stateRef = useRef(state);
  const hydratedRef = useRef(hydrated);
  const languageRef = useRef(language);
  const translationRef = useRef(t);
  const accentRef = useRef(accent);
  const darkRef = useRef(colors.isDark);
  const seededRef = useRef(false);
  const mountedRef = useRef(false);
  const dirtyRef = useRef(false);
  const publishingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishRef = useRef<() => Promise<void>>(async () => undefined);
  const queueRef = useRef<(delay?: number) => void>(() => undefined);
  stateRef.current = state;
  hydratedRef.current = hydrated;
  languageRef.current = language;
  translationRef.current = t;
  accentRef.current = accent;
  darkRef.current = colors.isDark;

  queueRef.current = (delay = 320) => {
    dirtyRef.current = true;
    if (!mountedRef.current || publishingRef.current || timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void publishRef.current();
    }, delay);
  };

  publishRef.current = async () => {
    if (
      !mountedRef.current ||
      tutorialSandbox ||
      !hydratedRef.current ||
      !areHomeScreenWidgetsSupported()
    )
      return;
    if (publishingRef.current) {
      dirtyRef.current = true;
      return;
    }
    publishingRef.current = true;
    dirtyRef.current = false;
    try {
      const configurations = await getHomeScreenWidgetConfigurations().catch(
        () => [],
      );
      // Seed the bounded Featured and Status snapshots once per process so
      // adding the first widget while HabHub is closed never produces an empty
      // card. After that, no launcher widget means ordinary app updates skip
      // all avatar/history work.
      if (configurations.length === 0 && seededRef.current) return;
      // Android stores widget JSON in plaintext SharedPreferences. Build only
      // from the cache-safe projection; Google values continue to render in
      // the open app but never influence a durable launcher snapshot.
      const currentState = stateWithoutGoogleHealthLocalData(stateRef.current);
      const currentLanguage = languageRef.current;
      const translate = translationRef.current;
      const currentAccent = accentRef.current;
      const completedBackgroundColor = darkRef.current ? "#806018" : "#B98212";
      const today = dateKey();
      const avatar = avatarSnapshot(
        currentState,
        today,
        currentLanguage,
        currentAccent,
        completedBackgroundColor,
      );
      const featured = featuredWidgetSnapshot(
        currentState,
        today,
        currentLanguage,
        translate,
        {
          backgroundColor: currentAccent,
          completedBackgroundColor,
        },
      );
      const snapshot: WidgetSnapshot = {
        updatedAt: new Date().toISOString(),
        featured,
        avatar,
        // Legacy tracker fields remain empty; Featured and Status carry only
        // their bounded current-day projections.
        catalog: [],
        trackers: [],
      };
      const payload = JSON.stringify({ featured, avatar });
      if (payload === lastPayloadRef.current) {
        seededRef.current = true;
        return;
      }
      const updated = await updateHomeScreenWidgets(snapshot).catch(() => false);
      if (updated) {
        lastPayloadRef.current = payload;
        seededRef.current = true;
      }
    } finally {
      publishingRef.current = false;
      if (dirtyRef.current) queueRef.current(100);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    let dayBoundaryTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleDayBoundary = () => {
      const now = new Date();
      const nextDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        2,
      );
      dayBoundaryTimer = setTimeout(() => {
        queueRef.current(0);
        scheduleDayBoundary();
      }, Math.max(1_000, nextDay.getTime() - now.getTime()));
    };
    const subscription = NativeAppState.addEventListener("change", (next) => {
      // Flush the latest in-memory values before suspension and refresh again
      // on resume after cloud/health hydration.
      if (next === "active") queueRef.current(0);
      else if (next === "inactive" || next === "background")
        void publishRef.current();
    });
    scheduleDayBoundary();
    queueRef.current(1_200);
    return () => {
      mountedRef.current = false;
      subscription.remove();
      if (timerRef.current) clearTimeout(timerRef.current);
      if (dayBoundaryTimer) clearTimeout(dayBoundaryTimer);
      timerRef.current = null;
    };
  }, []);

  useEffect(() => {
    // A fixed trailing timer is never canceled by newer state. This prevents a
    // busy sync stream from starving widget updates indefinitely.
    queueRef.current(seededRef.current ? 320 : 1_200);
  }, [
    accent,
    colors.isDark,
    hydrated,
    language,
    state.currentUserId,
    state.energyProfiles,
    state.entries,
    state.gymSessions,
    state.metrics,
    state.settings,
    state.trackedGoalPeriods,
    t,
  ]);

  return null;
}
