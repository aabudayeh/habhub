import Constants from "expo-constants";

import { HealthAdapter } from "@/src/health/types";

const expoGo = Constants.appOwnership === "expo";

async function installedAdapter() {
  return (await import("@/src/health/healthConnect")).healthConnectAdapter;
}

export const nativeHealthAdapter: HealthAdapter = expoGo
  ? {
      provider: null,
      availability: async () => ({
        available: false,
        provider: null,
        title: "Health Connect",
        detail:
          "Health syncing needs the installed HabHub app; Expo Go can still run the rest of the app.",
      }),
      requestPermissions: async () => {
        throw new Error("Install a HabHub development or preview build to connect Health Connect.");
      },
      read: async () => [],
      openSettings: async () => {
        throw new Error("Health Connect settings require an installed HabHub build.");
      },
    }
  : {
      provider: "health_connect",
      availability: async () => (await installedAdapter()).availability(),
      grantedConnectionState: async (dataTypes) =>
        (await installedAdapter()).grantedConnectionState?.(dataTypes) ?? {
          connected: false,
          backgroundAccess: false,
        },
      requestPermissions: async (dataTypes, backgroundAccess) =>
        (await installedAdapter()).requestPermissions(dataTypes, backgroundAccess),
      read: async (request) => (await installedAdapter()).read(request),
      openSettings: async () => (await installedAdapter()).openSettings(),
    };
