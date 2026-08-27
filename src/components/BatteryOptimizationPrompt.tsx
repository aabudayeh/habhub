import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef } from "react";
import { InteractionManager, Platform } from "react-native";

import {
  healthSyncSchedule,
  normalizeBackgroundSyncIntervalHours,
} from "@/src/health/schedule";
import { LocalizedAlert as Alert } from "@/src/i18n";
import {
  getBatteryOptimizationStatus,
  openBatteryOptimizationSettings,
} from "@/src/notifications/batteryOptimization";
import { useApp } from "@/src/state/AppProvider";

const promptKeyPrefix = "habhub:battery-optimization-prompt:v1";

/**
 * Android remains in control of battery optimization. HabHub only explains the
 * trade-off after onboarding and opens the OS-managed list after an explicit
 * tap; declining leaves launch/resume sync intact.
 */
export function BatteryOptimizationPrompt() {
  const { hydrated, state } = useApp();
  const checkingRef = useRef(false);
  const handledRef = useRef(false);
  const intervalHours = normalizeBackgroundSyncIntervalHours(
    state.settings.healthSync.backgroundIntervalHours,
  );
  const requestsBackground = healthSyncSchedule(
    state.settings.syncMode,
    intervalHours,
  ).requestsBackground;

  useEffect(() => {
    if (
      Platform.OS !== "android" ||
      !hydrated ||
      !state.settings.onboardingComplete ||
      !state.settings.healthSync.enabled ||
      !requestsBackground ||
      checkingRef.current ||
      handledRef.current
    ) {
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    checkingRef.current = true;
    const promptKey = `${promptKeyPrefix}:${state.currentUserId}`;
    const interaction = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => {
        void (async () => {
          try {
            const alreadyHandled = await AsyncStorage.getItem(promptKey);
            if (!active || alreadyHandled) return;
            const status = await getBatteryOptimizationStatus();
            if (!active || status === "unsupported") return;
            handledRef.current = true;
            await AsyncStorage.setItem(promptKey, status);
            if (status === "disabled") return;
            Alert.alert(
              "Allow reliable background health sync?",
              `Android may delay HabHub while battery optimization is on. You can review the system setting so HabHub can request a short health and group sync about every ${intervalHours} ${intervalHours === 1 ? "hour" : "hours"}. Android still chooses the exact run time; HabHub does not stay running between syncs. If you choose Not now, your data still syncs when you open the app.`,
              [
                { text: "Not now", style: "cancel" },
                {
                  text: "Review settings",
                  onPress: () => {
                    void openBatteryOptimizationSettings();
                  },
                },
              ],
            );
          } finally {
            checkingRef.current = false;
          }
        })();
      }, 1_800);
      if (!active && timer) clearTimeout(timer);
    });

    return () => {
      active = false;
      checkingRef.current = false;
      if (timer) clearTimeout(timer);
      interaction.cancel();
    };
  }, [
    hydrated,
    intervalHours,
    requestsBackground,
    state.currentUserId,
    state.settings.healthSync.enabled,
    state.settings.onboardingComplete,
  ]);

  return null;
}
