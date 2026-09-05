import React, { PropsWithChildren, useMemo } from "react";

import { TutorialCloudSyncBoundary } from "@/src/cloud/CloudSyncProvider";
import { createTutorialDemoState } from "@/src/data/tutorialDemo";
import { TutorialHealthSyncBoundary } from "@/src/health/HealthSyncProvider";
import { AppProvider } from "@/src/state/AppProvider";
import { TutorialIsolatedPreviewBoundary } from "@/src/tutorial/TutorialContext";
import { TutorialSandboxProvider } from "@/src/tutorial/TutorialSandboxContext";

/**
 * Renders the real route tree against a throwaway reducer. The live account's
 * App/Cloud/Health providers remain mounted above this boundary but are fully
 * shadowed here; unmounting discards every guided-practice mutation.
 */
export function TutorialAppStateBoundary({
  children,
  runId,
  anchorDate,
}: PropsWithChildren<{ runId: number; anchorDate: string }>) {
  const bundle = useMemo(
    () => createTutorialDemoState(anchorDate),
    [anchorDate],
  );
  const demoStateKey = `tutorial-demo:${bundle.schemaVersion}:${anchorDate}:${runId}`;
  return (
    <TutorialSandboxProvider key={demoStateKey} bundle={bundle}>
      <AppProvider
        key={demoStateKey}
        initialState={bundle.appState}
        persistence="ephemeral"
      >
        <TutorialCloudSyncBoundary>
          <TutorialHealthSyncBoundary>
            <TutorialIsolatedPreviewBoundary demoStateKey={demoStateKey}>
              {children}
            </TutorialIsolatedPreviewBoundary>
          </TutorialHealthSyncBoundary>
        </TutorialCloudSyncBoundary>
      </AppProvider>
    </TutorialSandboxProvider>
  );
}
