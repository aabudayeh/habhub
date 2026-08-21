export type GoogleHealthSetupPlatform = "android" | "ios" | "desktop";

export const GOOGLE_HEALTH_ANDROID_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.fitbit.FitbitMobile";

export const GOOGLE_HEALTH_IOS_STORE_URL =
  "https://apps.apple.com/app/id462638897";

export const GOOGLE_HEALTH_ANDROID_HELP_URL =
  "https://support.google.com/googlehealth/answer/14506680";

export const GOOGLE_HEALTH_IOS_HELP_URL =
  "https://support.google.com/googlehealth/answer/17037331";

/**
 * Browser-only platform hint for setup copy. This never claims that the
 * Google Health app is installed: web browsers do not expose that state.
 */
export function googleHealthSetupPlatform(
  userAgent: string,
  navigatorPlatform = "",
  maxTouchPoints = 0,
): GoogleHealthSetupPlatform {
  const ua = userAgent.toLowerCase();
  const platform = navigatorPlatform.toLowerCase();
  const iPadDesktopMode =
    platform === "macintel" && Number.isFinite(maxTouchPoints) && maxTouchPoints > 1;

  if (/iphone|ipad|ipod/.test(ua) || iPadDesktopMode) return "ios";
  if (/android/.test(ua)) return "android";
  return "desktop";
}

export function googleHealthSetupAcknowledgementKey(accountId: string) {
  return `habhub-google-health-phone-ready-v1:${accountId}`;
}

export function googleHealthDisclosureAcknowledgementKey(accountId: string) {
  return `habhub-google-health-disclosure-v1:${accountId}`;
}

export function googleHealthNormalUseDisclosureKey(accountId: string) {
  return `habhub-google-health-normal-use-disclosure-v1:${accountId}`;
}
