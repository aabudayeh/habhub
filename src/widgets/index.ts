import { NativeModules, Platform } from "react-native";

import type { CompletionFillMode, StatusAvatarStyle } from "@/src/types";

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
  deepLink: string;
  /** Hero-style detail rows use current values only, keeping refreshes cheap. */
  goals?: { title: string; value: string; progress: number; met?: boolean }[];
};

export type WidgetAvatarSnapshot = WidgetTrackerSnapshot & {
  id: "__avatar__";
  /** One resolved bundled/OTA asset. Native decodes only this visible sprite. */
  avatarUri?: string;
  avatarStyle: StatusAvatarStyle;
  heightScale: number;
  weightLabel: string;
  bodyCompositionLabel?: string;
};

export type WidgetSnapshot = {
  updatedAt: string;
  featured: WidgetTrackerSnapshot;
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
