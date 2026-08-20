export type NetworkReachability = "online" | "offline" | "unknown";

/**
 * NetInfo starts with nullable fields on native cold launch. Treating that
 * unknown snapshot as online starts long network timeouts in airplane mode.
 */
export function networkReachability(
  isConnected: boolean | null | undefined,
  isInternetReachable: boolean | null | undefined,
): NetworkReachability {
  if (isConnected === false || isInternetReachable === false) return "offline";
  if (isConnected === true && isInternetReachable === true) return "online";
  return "unknown";
}
