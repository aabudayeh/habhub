import React, { createContext, PropsWithChildren, useContext } from "react";

import type { TutorialDemoBundle } from "@/src/data/tutorialDemo";

type TutorialSandboxValue = {
  /** True only while real routes are rendered against an ephemeral demo state. */
  active: true;
  bundle: TutorialDemoBundle;
};

const TutorialSandboxContext = createContext<TutorialSandboxValue | null>(null);

export function TutorialSandboxProvider({
  children,
  bundle,
}: PropsWithChildren<{ bundle: TutorialDemoBundle }>) {
  return (
    <TutorialSandboxContext.Provider value={{ active: true, bundle }}>
      {children}
    </TutorialSandboxContext.Provider>
  );
}

/** Safe outside a tutorial: the default context is explicitly inactive. */
export function useTutorialSandbox() {
  const value = useContext(TutorialSandboxContext);
  return {
    active: value?.active === true,
    bundle: value?.bundle,
  };
}

export function useTutorialSandboxActive() {
  return useContext(TutorialSandboxContext)?.active === true;
}
