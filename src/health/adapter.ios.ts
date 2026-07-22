import Constants from "expo-constants";

import { HealthAdapter } from "@/src/health/types";

const expoGo = Constants.appOwnership === "expo";

async function installedAdapter() {
  return (await import("@/src/health/appleHealth")).appleHealthAdapter;
}

export const nativeHealthAdapter: HealthAdapter = expoGo
  ? {
      provider: null,
      availability: async () => ({
        available: false,
        provider: null,
        title: "Apple Health",
        detail:
          "Health syncing needs the installed MetricRally app; Expo Go can still run the rest of the app.",
      }),
      requestPermissions: async () => {
        throw new Error("Install a MetricRally development or preview build to connect Apple Health.");
      },
      read: async () => [],
      openSettings: async () => {
        throw new Error("Apple Health settings require an installed MetricRally build.");
      },
    }
  : {
      provider: "apple_health",
      availability: async () => (await installedAdapter()).availability(),
      requestPermissions: async (dataTypes, backgroundAccess) =>
        (await installedAdapter()).requestPermissions(dataTypes, backgroundAccess),
      read: async (request) => (await installedAdapter()).read(request),
      openSettings: async () => (await installedAdapter()).openSettings(),
    };
