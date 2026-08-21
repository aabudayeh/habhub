import { parseGoogleHealthCompletionFragment } from "../domain/googleHealthCallback";
import type { GoogleHealthCompletionFragment } from "../domain/googleHealthCallback";

type CompletionBrowser = {
  history: Pick<History, "replaceState" | "state">;
  location: Pick<Location, "hash" | "pathname" | "search">;
};

const emptyCompletion = (): GoogleHealthCompletionFragment => ({
  present: false,
  token: null,
});

// OAuth completion credentials are deliberately process-memory only. The root
// layout captures them before AuthProvider or any route guard can render, then
// the Settings card consumes them once an authenticated session is available.
let pendingCompletion = emptyCompletion();

function activeBrowser(): CompletionBrowser | null {
  if (
    typeof window === "undefined" ||
    !window.location ||
    !window.history ||
    typeof window.history.replaceState !== "function"
  )
    return null;
  return window;
}

export function captureGoogleHealthCompletionFromBrowserUrl(
  browser: CompletionBrowser | null = activeBrowser(),
): GoogleHealthCompletionFragment {
  if (!browser) return pendingCompletion;
  const completion = parseGoogleHealthCompletionFragment(browser.location.hash);
  if (!completion.present) return pendingCompletion;

  // Remove the bearer completion token before auth restoration, loading UI, or
  // signed-out redirects. It must never enter browser history after capture.
  browser.history.replaceState(
    browser.history.state,
    "",
    `${browser.location.pathname}${browser.location.search}`,
  );
  pendingCompletion = completion;
  return pendingCompletion;
}

export function clearCapturedGoogleHealthCompletion() {
  pendingCompletion = emptyCompletion();
}
