import { NativeModules, Platform } from "react-native";

export type WidgetHistoryStatus = "met" | "missed" | "not_logged";

export type WidgetHistoryPoint = {
  progress: number;
  status: WidgetHistoryStatus;
};

export type WidgetTrackerSnapshot = {
  id: string;
  title: string;
  value: string;
  subtitle: string;
  progress: number;
  color: string;
  deepLink: string;
  history: {
    week: WidgetHistoryPoint[];
    month: WidgetHistoryPoint[];
    year: WidgetHistoryPoint[];
  };
};

export type WidgetSnapshot = {
  updatedAt: string;
  featured: WidgetTrackerSnapshot;
  /** Cheap picker metadata; history is sent only for active widget trackers. */
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
