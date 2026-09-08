import React, { useId, useLayoutEffect } from "react";
import { Modal, ModalProps, StyleSheet, View } from "react-native";

import { TutorialSpotlight } from "@/src/components/TutorialSpotlight";
import { useOptionalTutorial } from "@/src/tutorial/TutorialContext";
import { registerTutorialModalHost } from "@/src/tutorial/modalHost";

/** Ordinary modals remain unchanged. Only an active isolated tutorial mounts
 * its controls in the same native window, above the demonstrated editor. */
export function TutorialModal({ children, ...props }: ModalProps) {
  const tutorial = useOptionalTutorial();
  const id = useId();
  const enabled = Boolean(
    props.visible !== false && tutorial?.activeSession && tutorial.isolatedPreviewActive,
  );
  useLayoutEffect(() => {
    if (enabled) return registerTutorialModalHost(id);
  }, [enabled, id]);

  return (
    <Modal {...props}>
      {enabled ? (
        <View style={styles.content}>
          {children}
          <TutorialSpotlight modalHostId={id} />
        </View>
      ) : children}
    </Modal>
  );
}

const styles = StyleSheet.create({ content: { flex: 1 } });
