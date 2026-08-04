import AsyncStorage from "@react-native-async-storage/async-storage";

export type ScreenTimeAppLimit = {
  packageName: string;
  appName: string;
  targetMinutes: number;
};

const LIMITS_PREFIX = "habhub:screen-time-app-limits:v1:";

function normalizedLimits(value: unknown): ScreenTimeAppLimit[] {
  if (!Array.isArray(value)) return [];
  const byPackage = new Map<string, ScreenTimeAppLimit>();
  value.forEach((candidate) => {
    if (!candidate || typeof candidate !== "object") return;
    const row = candidate as Partial<ScreenTimeAppLimit>;
    const packageName = String(row.packageName ?? "").trim();
    const appName = String(row.appName ?? "").trim();
    const targetMinutes = Math.round(Number(row.targetMinutes));
    if (
      !packageName ||
      !appName ||
      !Number.isFinite(targetMinutes) ||
      targetMinutes < 1 ||
      targetMinutes > 1_440
    )
      return;
    byPackage.set(packageName, { packageName, appName, targetMinutes });
  });
  return [...byPackage.values()].sort((left, right) =>
    left.appName.localeCompare(right.appName),
  );
}

function storageKey(userId: string) {
  return `${LIMITS_PREFIX}${userId}`;
}

/** Package names and limits stay in device-only storage, outside AppState/cloud. */
export async function readScreenTimeAppLimits(userId: string) {
  if (!userId) return [];
  try {
    return normalizedLimits(
      JSON.parse((await AsyncStorage.getItem(storageKey(userId))) ?? "[]"),
    );
  } catch {
    return [];
  }
}

async function writeScreenTimeAppLimits(
  userId: string,
  limits: ScreenTimeAppLimit[],
) {
  const normalized = normalizedLimits(limits);
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(normalized));
  return normalized;
}

export async function saveScreenTimeAppLimit(
  userId: string,
  limit: ScreenTimeAppLimit,
) {
  const current = await readScreenTimeAppLimits(userId);
  return writeScreenTimeAppLimits(userId, [
    ...current.filter((item) => item.packageName !== limit.packageName),
    limit,
  ]);
}

export async function removeScreenTimeAppLimit(
  userId: string,
  packageName: string,
) {
  const current = await readScreenTimeAppLimits(userId);
  return writeScreenTimeAppLimits(
    userId,
    current.filter((item) => item.packageName !== packageName),
  );
}
