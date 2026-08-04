import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "metric-rally-onboarding-complete-v1:";

function key(accountId: string) {
  return `${PREFIX}${accountId}`;
}

export async function onboardingCompletedLocally(accountId: string) {
  return (await AsyncStorage.getItem(key(accountId))) === "true";
}

export function markOnboardingCompleted(accountId: string) {
  return AsyncStorage.setItem(key(accountId), "true");
}
