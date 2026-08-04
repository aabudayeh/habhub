import type { AlertButton, AlertOptions } from "react-native";

export type WebAlertRequest = {
  id: number;
  title: string;
  message?: string;
  buttons?: AlertButton[];
  options?: AlertOptions;
};

type WebAlertListener = (request: WebAlertRequest) => void;

let nextAlertId = 1;
const listeners = new Set<WebAlertListener>();
const pending: WebAlertRequest[] = [];

/**
 * Browser-safe equivalent of React Native's Alert API. Requests are queued so
 * rapid navigation guards (for example Save / Continue / Discard) cannot
 * replace one another before the user responds.
 */
export function showWebAlert(
  title: string,
  message?: string,
  buttons?: AlertButton[],
  options?: AlertOptions,
) {
  const request = {
    id: nextAlertId++,
    title,
    message,
    buttons,
    options,
  } satisfies WebAlertRequest;

  if (!listeners.size) pending.push(request);
  else listeners.forEach((listener) => listener(request));
}

export function subscribeToWebAlerts(listener: WebAlertListener) {
  listeners.add(listener);
  if (pending.length) {
    const queued = pending.splice(0, pending.length);
    queued.forEach(listener);
  }
  return () => {
    listeners.delete(listener);
  };
}
