import { useEffect, useRef } from "react";
import { Platform } from "react-native";

type DirtyCheck = boolean | (() => boolean);

/** Warn before a browser refresh or tab close would discard an active draft. */
export function useWebBeforeUnload(shouldBlock: DirtyCheck) {
  const shouldBlockRef = useRef(shouldBlock);
  shouldBlockRef.current = shouldBlock;

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const current = shouldBlockRef.current;
      const blocked =
        typeof current === "function" ? current() : current;
      if (!blocked) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
}

/**
 * Makes the first browser Back action dismiss a transient in-page mode.
 *
 * Always create a same-URL history entry, including in browsers that expose
 * the Navigation API. An installed PWA can otherwise have no earlier in-app
 * history entry at all, so the OS closes the app without giving a cancellable
 * traversal to a Navigation API listener. The sentinel gives browser Back a
 * real, same-document destination and keeps Expo Router on the current route.
 */
export function useWebBackDismiss(active: boolean, onDismiss: () => void) {
  const activeRef = useRef(active);
  const onDismissRef = useRef(onDismiss);
  activeRef.current = active;
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (
      Platform.OS !== "web" ||
      typeof window === "undefined" ||
      !active
    )
      return;

    const guardStateKey = "__habhubDismissBackGuard";
    const entryUrl = window.location.href;
    const currentState = window.history.state as
      | Record<string, unknown>
      | null;
    const existingGuardId = currentState?.[guardStateKey];
    const guardId =
      typeof existingGuardId === "string"
        ? existingGuardId
        : `habhub-dismiss-${Date.now().toString(36)}-` +
          Math.random().toString(36).slice(2);
    // Returning from a child route can restore this tab's existing sentinel.
    // Reuse it so dismissing edit mode does not leave a second same-URL entry
    // that would make the user's following Back action appear to do nothing.
    if (typeof existingGuardId !== "string")
      window.history.pushState(
        { ...(currentState ?? {}), [guardStateKey]: guardId },
        "",
        entryUrl,
      );

    let consumed = false;
    const popstate = () => {
      if (consumed || !activeRef.current) return;
      // Back has already landed on the same-URL entry beneath the sentinel.
      // Consume it by closing the mode without asking Expo Router to navigate.
      consumed = true;
      activeRef.current = false;
      queueMicrotask(() => onDismissRef.current());
    };
    window.addEventListener("popstate", popstate);
    return () => {
      window.removeEventListener("popstate", popstate);
      if (consumed) return;
      // Done/Cancel can dismiss the mode without consuming browser Back. Drop
      // the still-current sentinel so the user's next Back is not a no-op.
      queueMicrotask(() => {
        const latestState = window.history.state as
          | Record<string, unknown>
          | null;
        if (
          window.location.href === entryUrl &&
          latestState?.[guardStateKey] === guardId
        )
          window.history.back();
      });
    };
  }, [active]);
}

/**
 * Keeps same-document browser Back navigation inside a dirty editor until the
 * editor has asked whether to save or discard. Expo Router restores recorded
 * browser history with resetRoot on web, which can bypass beforeRemove.
 */
export function useWebBackNavigationGuard(
  shouldBlock: DirtyCheck,
  onBackAttempt: (continueBack: () => void) => void,
) {
  const shouldBlockRef = useRef(shouldBlock);
  const onBackAttemptRef = useRef(onBackAttempt);
  const guardEntryActiveRef = useRef(false);
  const bypassNavigationRef = useRef(false);
  const guardIdRef = useRef(
    `habhub-editor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  );
  shouldBlockRef.current = shouldBlock;
  onBackAttemptRef.current = onBackAttempt;

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    type NavigationApiEvent = Event & {
      destination?: { sameDocument?: boolean };
      navigationType?: string;
    };
    const navigationApi = (
      window as typeof window & { navigation?: EventTarget }
    ).navigation;
    if (navigationApi) {
      const navigate = (rawEvent: Event) => {
        const event = rawEvent as NavigationApiEvent;
        if (bypassNavigationRef.current) {
          bypassNavigationRef.current = false;
          return;
        }
        if (
          event.navigationType !== "traverse" ||
          event.destination?.sameDocument === false
        )
          return;
        const current = shouldBlockRef.current;
        const blocked =
          typeof current === "function" ? current() : current;
        if (!blocked || !event.cancelable) return;
        event.preventDefault();
        queueMicrotask(() =>
          onBackAttemptRef.current(() => {
            bypassNavigationRef.current = true;
            window.history.back();
          }),
        );
      };
      navigationApi.addEventListener("navigate", navigate);
      return () => navigationApi.removeEventListener("navigate", navigate);
    }

    // Safari currently lacks the Navigation API. Keep a same-URL sentinel in
    // front of the editor so its first Back stays inside this route.
    const guardStateKey = "__habhubEditorBackGuard";
    const currentState = window.history.state as
      | Record<string, unknown>
      | null;
    const existingGuardId = currentState?.[guardStateKey];
    if (typeof existingGuardId === "string") {
      guardIdRef.current = existingGuardId;
    } else {
      window.history.pushState(
        { ...(currentState ?? {}), [guardStateKey]: guardIdRef.current },
        "",
        window.location.href,
      );
    }
    guardEntryActiveRef.current = true;

    let restoringCurrentEntry = false;
    const popstate = (event: PopStateEvent) => {
      if (!guardEntryActiveRef.current) return;
      if (restoringCurrentEntry) {
        restoringCurrentEntry = false;
        queueMicrotask(() =>
          onBackAttemptRef.current(() => {
            guardEntryActiveRef.current = false;
            window.history.go(-2);
          }),
        );
        return;
      }

      const current = shouldBlockRef.current;
      const blocked =
        typeof current === "function" ? current() : current;
      if (!blocked) {
        guardEntryActiveRef.current = false;
        window.history.back();
        return;
      }

      // The first Back only enters the same-URL entry beneath our sentinel, so
      // Expo Router keeps this editor mounted. Restore the sentinel before the
      // app opens its save/discard dialog.
      restoringCurrentEntry = true;
      window.history.forward();
    };

    window.addEventListener("popstate", popstate);
    return () => {
      guardEntryActiveRef.current = false;
      window.removeEventListener("popstate", popstate);
    };
  }, []);

}
