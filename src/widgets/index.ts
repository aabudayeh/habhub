import { NativeModules, Platform } from "react-native";

import type { CompletionFillMode, StatusAvatarStyle } from "@/src/types";

export type WidgetGoalSnapshot = {
  id: string;
  title: string;
  value: string;
  progress: number;
  met: boolean;
  unavailable: boolean;
  color: string;
  icon?: string;
  deepLink: string;
};

export type WidgetTrackerSnapshot = {
  id: string;
  eyebrow?: string;
  title: string;
  value: string;
  subtitle: string;
  progress: number;
  color: string;
  /** Matches the Today hero rather than using a separate widget palette. */
  backgroundColor?: string;
  progressColor?: string;
  allComplete?: boolean;
  fillMode?: Exclude<CompletionFillMode, "auto">;
  showProgressOutline?: boolean;
  completionIcon?: string;
  deepLink: string;
  /** Hero-style detail rows use current values only, keeping refreshes cheap. */
  goals?: WidgetGoalSnapshot[];
};

export type WidgetFeaturedSnapshot = WidgetTrackerSnapshot & {
  id: "__featured__";
  /** Compact local date rendered in the existing Featured header line. */
  dateLabel: string;
  goals: WidgetGoalSnapshot[];
  completionIcon: string;
  showProgressOutline: boolean;
};

export type WidgetAvatarSnapshot = {
  id: "__avatar__";
  progress: number;
  color: string;
  backgroundColor: string;
  progressColor: string;
  allComplete: boolean;
  fillMode: Exclude<CompletionFillMode, "auto">;
  deepLink: string;
  /** One resolved bundled/OTA asset. Native decodes only this visible sprite. */
  avatarUri?: string;
  avatarStyle: StatusAvatarStyle;
  heightScale: number;
  /** Status-page tracker order; native partitions this into flank/bottom rings. */
  goals: WidgetGoalSnapshot[];
};

export type WidgetSnapshot = {
  updatedAt: string;
  featured?: WidgetFeaturedSnapshot;
  avatar?: WidgetAvatarSnapshot;
  /** Cheap picker metadata; no historical metric payload is duplicated here. */
  catalog: { id: string; title: string }[];
  trackers: WidgetTrackerSnapshot[];
};

export type WidgetConfiguration = {
  widgetId: number;
  trackerId: string;
  range: "week" | "month" | "year";
};

type HabHubAndroidModule = {
  updateWidgetSnapshot(snapshot: string): Promise<boolean>;
  refreshWidgets(): Promise<boolean>;
  configureWidget(
    widgetId: number,
    trackerId: string,
    range: WidgetConfiguration["range"],
  ): Promise<boolean>;
  getWidgetConfigurations(): Promise<WidgetConfiguration[]>;
};

const androidModule = NativeModules.HabHubAndroid as
  | HabHubAndroidModule
  | undefined;

export function areHomeScreenWidgetsSupported() {
  return Platform.OS === "android" && Boolean(androidModule);
}

export async function updateHomeScreenWidgets(snapshot: WidgetSnapshot) {
  if (!areHomeScreenWidgetsSupported()) return false;
  return androidModule!.updateWidgetSnapshot(JSON.stringify(snapshot));
}

export async function refreshHomeScreenWidgets() {
  if (!areHomeScreenWidgetsSupported()) return false;
  return androidModule!.refreshWidgets();
}

export async function configureHomeScreenWidget(
  widgetId: number,
  trackerId: string,
  range: WidgetConfiguration["range"],
) {
  if (!areHomeScreenWidgetsSupported()) return false;
  return androidModule!.configureWidget(widgetId, trackerId, range);
}

export async function getHomeScreenWidgetConfigurations() {
  if (!areHomeScreenWidgetsSupported()) return [];
  return androidModule!.getWidgetConfigurations();
}
