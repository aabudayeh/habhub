import { useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";

import type { RecapFeedItem } from "@/src/domain/recaps";
import { scheduleResponsiveWork } from "@/src/lib/responsiveWork";

type CachedFeed = {
  scopeKey: string;
  items: RecapFeedItem[];
  authority: RecapFeedAuthoritySignature;
};

export type RecapFeedAuthority = readonly unknown[];
type RecapFeedAuthoritySignature = string;

const MAX_CACHED_FEEDS = 12;
const nativeFeedCache = new Map<string, CachedFeed>();
const feedAuthorityObjectIds = new WeakMap<object, number>();
let nextFeedAuthorityObjectId = 1;

function feedAuthoritySignature(authority: RecapFeedAuthority) {
  return JSON.stringify(
    authority.map((value): readonly [string, string | number] => {
      if (
        value !== null &&
        (typeof value === "object" || typeof value === "function")
      ) {
        const objectValue = value as object;
        let objectId = feedAuthorityObjectIds.get(objectValue);
        if (objectId === undefined) {
          objectId = nextFeedAuthorityObjectId;
          nextFeedAuthorityObjectId += 1;
          feedAuthorityObjectIds.set(objectValue, objectId);
        }
        return ["object", objectId];
      }
      return [value === null ? "null" : typeof value, String(value)];
    }),
  );
}

function sameFeedAuthority(
  left: RecapFeedAuthoritySignature,
  right: RecapFeedAuthoritySignature,
) {
  return left === right;
}

function authorizedCachedFeed(
  scopeKey: string,
  authority: RecapFeedAuthoritySignature,
) {
  const cached = nativeFeedCache.get(scopeKey);
  return cached && sameFeedAuthority(cached.authority, authority)
    ? cached
    : undefined;
}

function rememberFeed(
  scopeKey: string,
  items: RecapFeedItem[],
  authority: RecapFeedAuthoritySignature,
) {
  const snapshot = { scopeKey, items, authority };
  nativeFeedCache.delete(scopeKey);
  nativeFeedCache.set(scopeKey, snapshot);
  while (nativeFeedCache.size > MAX_CACHED_FEEDS) {
    const oldest = nativeFeedCache.keys().next().value;
    if (typeof oldest !== "string") break;
    nativeFeedCache.delete(oldest);
  }
  return snapshot;
}

/**
 * Keeps native navigation and reaction frames ahead of the relatively broad
 * badge/feed projection. A previously rendered feed is painted immediately
 * only while the current entry/status/photo authorization sources are the
 * exact immutable sources that authorized it. A privacy or membership update
 * therefore fails closed until the deferred projection is rebuilt. Web
 * retains synchronous derivation because its JS/runtime budget is
 * substantially larger and avoids a loading flash in the PWA.
 */
export function useResponsiveRecapFeed(
  scopeKey: string,
  derive: () => RecapFeedItem[],
  authority: RecapFeedAuthority,
) {
  const webItems = useMemo(
    () => (Platform.OS === "web" ? derive() : undefined),
    [derive],
  );
  const authoritySignature = feedAuthoritySignature(authority);
  const [nativeSnapshot, setNativeSnapshot] = useState<CachedFeed | undefined>(
    () => {
      if (Platform.OS === "web") return undefined;
      return authorizedCachedFeed(scopeKey, authoritySignature);
    },
  );
  const deriveRef = useRef(derive);
  const authorityRef = useRef(authoritySignature);
  const activeScopeRef = useRef(scopeKey);
  const nativeFeedTaskRef = useRef<
    { scopeKey: string; cancel: () => void } | undefined
  >(undefined);
  deriveRef.current = derive;
  authorityRef.current = authoritySignature;
  activeScopeRef.current = scopeKey;

  useEffect(() => {
    if (Platform.OS === "web") return;
    const cached = authorizedCachedFeed(scopeKey, authoritySignature);
    if (!cached && nativeFeedCache.has(scopeKey))
      nativeFeedCache.delete(scopeKey);
    if (cached)
      setNativeSnapshot((current) =>
        current === cached
          ? current
          : cached,
      );
    // A live Health/cloud stream may replace state several times while this
    // screen is opening. Keep one scheduled projection and let it consume the
    // latest derivation instead of cancelling/restarting until it starves.
    if (nativeFeedTaskRef.current?.scopeKey !== scopeKey) {
      nativeFeedTaskRef.current?.cancel();
      nativeFeedTaskRef.current = undefined;
    }
    if (nativeFeedTaskRef.current) return;
    const scheduledScope = scopeKey;
    const scheduledTask: { scopeKey: string; cancel: () => void } = {
      scopeKey: scheduledScope,
      cancel: () => undefined,
    };
    nativeFeedTaskRef.current = scheduledTask;
    const task = scheduleResponsiveWork(
      () => {
        if (activeScopeRef.current !== scheduledScope) return;
        const currentAuthority = authorityRef.current;
        const items = deriveRef.current();
        if (
          activeScopeRef.current !== scheduledScope ||
          !sameFeedAuthority(currentAuthority, authorityRef.current)
        )
          return;
        const snapshot = rememberFeed(
          scheduledScope,
          items,
          currentAuthority,
        );
        setNativeSnapshot(snapshot);
        if (nativeFeedTaskRef.current === scheduledTask)
          nativeFeedTaskRef.current = undefined;
      },
      {
        minimumDelayMs: cached ? 120 : 40,
        maximumDelayMs: 1_800,
        minimumUserQuietMs: 550,
      },
    );
    scheduledTask.cancel = task.cancel;
  }, [authoritySignature, derive, scopeKey]);

  useEffect(
    () => () => {
      nativeFeedTaskRef.current?.cancel();
      nativeFeedTaskRef.current = undefined;
    },
    [],
  );

  if (Platform.OS === "web")
    return { items: webItems ?? [], ready: true } as const;
  const cached = authorizedCachedFeed(scopeKey, authoritySignature);
  const snapshot =
    nativeSnapshot?.scopeKey === scopeKey &&
    sameFeedAuthority(nativeSnapshot.authority, authoritySignature)
      ? nativeSnapshot
      : cached;
  return {
    items: snapshot?.items ?? [],
    ready: Boolean(snapshot),
  } as const;
}
