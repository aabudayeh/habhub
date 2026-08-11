import { useNavigation } from "@react-navigation/native";
import { useEffect } from "react";

import { setCloudSyncPaused } from "@/src/cloud/syncGate";

/**
 * Hold an edit/reorder network gate only while its mounted tab is visible.
 * Inactive tabs preserve local draft state, but must not strand the global
 * cloud outbox or keep later edits on another page pending.
 */
export function useFocusedCloudSyncPause(reason: string, paused: boolean) {
  const navigation = useNavigation();

  useEffect(() => {
    const applyFocusedState = () =>
      setCloudSyncPaused(reason, paused && navigation.isFocused());
    const releaseOnBlur = () => setCloudSyncPaused(reason, false);

    applyFocusedState();
    // These navigation listeners remain live when an inactive web/native
    // screen subtree is frozen, so a hidden editor can never strand the
    // account-wide outbox behind its local edit gate.
    const unsubscribeFocus = navigation.addListener(
      "focus",
      applyFocusedState,
    );
    const unsubscribeBlur = navigation.addListener("blur", releaseOnBlur);
    return () => {
      unsubscribeFocus();
      unsubscribeBlur();
      releaseOnBlur();
    };
  }, [navigation, paused, reason]);
}
