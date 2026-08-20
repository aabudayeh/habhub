import { NativeModules, Platform } from "react-native";

type HabHubAndroidModule = {
  canScheduleExactAlarms?(): Promise<boolean>;
  openExactAlarmSettings?(): Promise<boolean>;
};

const androidModule = NativeModules.HabHubAndroid as
  | HabHubAndroidModule
  | undefined;

const exactAlarmStatus = {
  exact: "exact",
  inexact: "inexact",
  unsupported: "unsupported",
} as const;

export type ExactAlarmStatus =
  (typeof exactAlarmStatus)[keyof typeof exactAlarmStatus];

export function isExactAlarmControlSupported() {
  return (
    Platform.OS === "android" &&
    typeof androidModule?.canScheduleExactAlarms === "function" &&
    typeof androidModule?.openExactAlarmSettings === "function"
  );
}

/** Android still delivers an inexact fallback when exact access is off. */
export async function getExactAlarmStatus(): Promise<ExactAlarmStatus> {
  if (!isExactAlarmControlSupported()) return exactAlarmStatus.unsupported;
  return (await androidModule!.canScheduleExactAlarms!())
    ? exactAlarmStatus.exact
    : exactAlarmStatus.inexact;
}

/** Opens Android's user-controlled exact-alarm access screen after a tap. */
export async function openExactAlarmSettings() {
  if (!isExactAlarmControlSupported()) return false;
  return androidModule!.openExactAlarmSettings!();
}
