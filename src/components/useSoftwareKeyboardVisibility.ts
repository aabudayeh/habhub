import { useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, Platform } from "react-native";

const MIN_KEYBOARD_HEIGHT = 96;
const ANDROID_RESTORE_DELTA = 80;

function webViewportHeight() {
  if (typeof window === "undefined") return 0;
  const viewport = window.visualViewport;
  return viewport
    ? Math.round(viewport.height * viewport.scale)
    : window.innerHeight;
}

function isTextEditor(element: Element | null) {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) {
    return ![
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ].includes(element.type);
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

/**
 * Cross-platform software-keyboard visibility.
 *
 * React Native emits keyboard events on iOS and Android. React Native Web does
 * not, so mobile browsers are detected from the focused editor and the visual
 * viewport reduction. The viewport check also distinguishes a real software
 * keyboard from an ordinary focused input on desktop.
 */
export function useSoftwareKeyboardVisibility() {
  const [visible, setVisible] = useState(() =>
    Platform.OS === "web" ? false : Keyboard.isVisible(),
  );
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    if (Platform.OS === "web") {
      if (typeof window === "undefined" || typeof document === "undefined")
        return;

      let baselineHeight = webViewportHeight();
      let frame: number | null = null;
      const timers = new Set<ReturnType<typeof setTimeout>>();

      const evaluate = () => {
        frame = null;
        const height = webViewportHeight();
        const editing = isTextEditor(document.activeElement);
        if (!editing) {
          // An unfocused viewport is the new unobstructed baseline. Using the
          // historical maximum misclassified a smaller desktop window or a
          // portrait-to-landscape rotation as a software keyboard forever.
          // If focus leaves while the keyboard is still closing, its following
          // viewport resize simply refreshes this value again.
          baselineHeight = height;
          setVisible(false);
          return;
        }

        const threshold = Math.max(
          MIN_KEYBOARD_HEIGHT,
          Math.round(baselineHeight * 0.14),
        );
        setVisible(baselineHeight - height >= threshold);
      };
      const schedule = (delay = 0) => {
        if (delay) {
          const timer = setTimeout(() => {
            timers.delete(timer);
            evaluate();
          }, delay);
          timers.add(timer);
          return;
        }
        if (frame !== null) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(evaluate);
      };
      const handleFocus = () => {
        // Capture the unobstructed height before the browser finishes opening
        // its keyboard, then sample both early and after its animation settles.
        baselineHeight = Math.max(baselineHeight, webViewportHeight());
        schedule();
        schedule(120);
        schedule(360);
      };
      const handleBlur = () => schedule(60);

      const viewport = window.visualViewport;
      viewport?.addEventListener("resize", evaluate);
      viewport?.addEventListener("scroll", evaluate);
      window.addEventListener("resize", evaluate);
      document.addEventListener("focusin", handleFocus);
      document.addEventListener("focusout", handleBlur);

      return () => {
        if (frame !== null) cancelAnimationFrame(frame);
        timers.forEach(clearTimeout);
        viewport?.removeEventListener("resize", evaluate);
        viewport?.removeEventListener("scroll", evaluate);
        window.removeEventListener("resize", evaluate);
        document.removeEventListener("focusin", handleFocus);
        document.removeEventListener("focusout", handleBlur);
      };
    }

    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const shown = Keyboard.addListener(showEvent, () => setVisible(true));
    const hidden = Keyboard.addListener(hideEvent, () => setVisible(false));

    if (Platform.OS !== "android") {
      return () => {
        shown.remove();
        hidden.remove();
      };
    }

    // A few Android keyboards/OEM builds resize the window but occasionally
    // omit keyboardDidHide. Detect the restored window so the composer cannot
    // remain stranded at a stale KeyboardAvoidingView height.
    let previousHeight = Dimensions.get("window").height;
    const dimensions = Dimensions.addEventListener("change", ({ window }) => {
      if (
        visibleRef.current &&
        window.height - previousHeight >= ANDROID_RESTORE_DELTA
      ) {
        setVisible(false);
      }
      previousHeight = window.height;
    });

    return () => {
      shown.remove();
      hidden.remove();
      dimensions.remove();
    };
  }, []);

  return visible;
}
