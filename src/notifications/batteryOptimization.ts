import { NativeModules, Platform } from "react-native";

type HabHubAndroidModule = {
  isIgnoringBatteryOptimizations(): Promise<boolean>;
  openBatteryOptimizationSettings(): Promise<boolean>;
};

const androidModule = NativeModules.HabHubAndroid as
  | HabHubAndroidModule
  | undefined;

const batteryOptimizationStatus = {
  disabled: "disabled",
  enabled: "enabled",
  unsupported: "unsupported",
} as const;

export type BatteryOptimizationStatus =
  (typeof batteryOptimizationStatus)[keyof typeof batteryOptimizationStatus];

export function isBatteryOptimizationControlSupported() {
  return Platform.OS === "android" && Boolean(androidModule);
}

/**
 * `disabled` means Android reports that HabHub is exempt from battery
 * optimization. The OS remains the source of truth; the app never toggles it.
 */
export async function getBatteryOptimizationStatus(): Promise<BatteryOptimizationStatus> {
  if (!isBatteryOptimizationControlSupported()) {
    return batteryOptimizationStatus.unsupported;
  }
  const ignored = await androidModule!.isIgnoringBatteryOptimizations();
  return ignored
    ? batteryOptimizationStatus.disabled
    : batteryOptimizationStatus.enabled;
}

/** Opens Android's user-controlled optimization list after an explicit tap. */
export async function openBatteryOptimizationSettings() {
  if (!isBatteryOptimizationControlSupported()) return false;
  return androidModule!.openBatteryOptimizationSettings();
}
