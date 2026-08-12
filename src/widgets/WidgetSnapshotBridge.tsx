import { useEffect, useRef } from "react";
import { AppState as NativeAppState, Image } from "react-native";

import { dateKey } from "@/src/domain/date";
import { useLocalization } from "@/src/i18n";
import { useApp } from "@/src/state/AppProvider";
import {
  ALL_GOALS_COMPLETE_COLOR,
  GOAL_COMPLETE_COLOR,
} from "@/src/domain/colors";
import {
  statusBodyAppearance,
  statusBodyCompositionForSource,
} from "@/src/domain/statusAvatar";
import { statusAvatarAtlasBlend } from "@/src/domain/statusAvatarAtlas";
import {
  statusAvatarBodyProgression,
  statusRangeRollup,
} from "@/src/domain/status";
import { STATUS_AVATAR_SPRITES } from "@/src/generated/statusAvatarSprites";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { AppState } from "@/src/types";
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
  locale: string,
  t: (source: string) => string,
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
  const summary = statusRangeRollup(state, state.currentUserId, [today]);
  const progress = Math.max(0, Math.min(1, summary.progress));
  const allComplete =
    summary.opportunities > 0 && summary.completed === summary.opportunities;
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
  const number = (value: number) =>
    Number(value.toFixed(1)).toLocaleString(locale);
  const bodyCompositionLabel =
    typeof progression.currentBodyFatPercent === "number"
      ? `${t("Body fat")} ${number(progression.currentBodyFatPercent)}%`
      : typeof progression.currentLeanBodyMassKg === "number"
        ? `${t("Lean body mass")} ${number(progression.currentLeanBodyMassKg)} kg`
        : undefined;

  return {
    id: "__avatar__",
    eyebrow: t("Status"),
    title: t("Status"),
    value: `${Math.round(progress * 100)}%`,
    subtitle: t("Tracked goals"),
    progress,
    color: allComplete ? ALL_GOALS_COMPLETE_COLOR : GOAL_COMPLETE_COLOR,
    backgroundColor: allComplete ? completedBackgroundColor : backgroundColor,
    progressColor: allComplete
      ? ALL_GOALS_COMPLETE_COLOR
      : GOAL_COMPLETE_COLOR,
    allComplete,
    fillMode: "bottom_up",
    deepLink: "paceboard://status",
    avatarUri: resolved?.uri,
    avatarStyle: state.settings.statusAvatarStyle ?? "silhouette",
    heightScale: appearance.heightScale,
    weightLabel: `${t("Weight")} ${number(progression.currentWeightKg)} kg`,
    bodyCompositionLabel,
  };
}

/** Keeps Android widgets current without blocking navigation or app startup. */
export function WidgetSnapshotBridge() {
  const { state, hydrated } = useApp();
  const { locale, t } = useLocalization();
  const accent = useGroupAccent();
  const colors = useAppColors();
  const lastPayloadRef = useRef("");
  const stateRef = useRef(state);
  const hydratedRef = useRef(hydrated);
  const localeRef = useRef(locale);
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
  localeRef.current = locale;
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
      // Seed one Status snapshot per process so adding the first widget while
      // HabHub is closed never produces an empty card. After that, no launcher
      // widget means ordinary app updates skip all avatar/history work.
      if (configurations.length === 0 && seededRef.current) return;
      const currentState = stateRef.current;
      const currentLocale = localeRef.current;
      const translate = translationRef.current;
      const currentAccent = accentRef.current;
      const avatar = avatarSnapshot(
        currentState,
        dateKey(),
        currentLocale,
        translate,
        currentAccent,
        darkRef.current ? "#806018" : "#B98212",
      );
      const snapshot: WidgetSnapshot = {
        updatedAt: new Date().toISOString(),
        avatar,
        // Legacy fields remain empty for backwards-compatible native parsing;
        // every existing configuration is migrated to the Status avatar.
        catalog: [],
        trackers: [],
      };
      const payload = JSON.stringify({ avatar });
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
    locale,
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
