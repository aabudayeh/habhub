import { InteractionManager } from "react-native";

import {
  ResponsiveWorkOptions,
  scheduleResponsiveWork as scheduleWithDriver,
} from "@/src/domain/responsiveWork";

const nativeDriver = {
  afterInteractions: (work: () => void) =>
    InteractionManager.runAfterInteractions(work),
  setTimer: (work: () => void, delayMs: number) => setTimeout(work, delayMs),
  clearTimer: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
};

export function scheduleResponsiveWork(
  work: () => void,
  options?: ResponsiveWorkOptions,
) {
  return scheduleWithDriver(nativeDriver, work, options);
}

export function waitForResponsiveTurn(options?: ResponsiveWorkOptions) {
  let settled = false;
  let resolvePromise!: () => void;
  const promise = new Promise<void>((next) => {
    resolvePromise = next;
  });
  const resolve = () => {
    if (settled) return;
    settled = true;
    resolvePromise();
  };
  const task = scheduleResponsiveWork(resolve, options);
  return {
    promise,
    cancel: () => {
      task.cancel();
      resolve();
    },
  };
}
