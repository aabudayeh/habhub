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
