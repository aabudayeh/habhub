import { LayoutAnimation } from "react-native";

/** Keeps neighboring cards visibly gliding into place during live dragging. */
export function animateReorder() {
  LayoutAnimation.configureNext({
    duration: 820,
    update: {
      type: LayoutAnimation.Types.easeInEaseOut,
    },
    create: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
    delete: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
  });
}
