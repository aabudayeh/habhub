export type TutorialRoute = `/${string}` | "/";

export type TutorialAnchor = {
  /** Registered TutorialTarget id. Omit for a centered explanation step. */
  target?: string;
  /** Wait briefly for lazy or route-mounted controls before using a fallback card. */
  required?: boolean;
  waitMs?: number;
  padding?: number;
  radius?: number;
};

export type TutorialNavigation = {
  /** Internal route that must be visible before this step is presented. */
  before?: string;
  /** Internal route to open after this step is completed. */
  after?: string;
};

export type TutorialInteraction = {
  mode: "observe" | "practice";
  /** Stable local event id. The engine never executes application actions. */
  actionId?: `tutorial.${string}`;
  instruction?: string;
  /**
   * `tap-anchor` records a tutorial-only rehearsal when the cutout is tapped.
   * `observed-action` can only be reported by an explicit isolated preview.
   */
  completion?: "manual" | "tap-anchor" | "observed-action";
  /**
   * Advance only after the isolated app action reports success. Use this for
   * practice actions that navigate away from the current step's route, so
   * route enforcement and the successful navigation change state together.
   */
  autoAdvance?: boolean;
};

export type TutorialEvent = {
  actionId: string;
  scope: "tutorial-local" | "isolated-preview";
};

export type TutorialStep = {
  id: string;
  sectionId: string;
  path: string;
  target?: string;
  title: string;
  copy: string;
  primaryLabel?: string;
  anchor?: TutorialAnchor;
  navigation?: TutorialNavigation;
  interaction?: TutorialInteraction;
};

export type TutorialSection = {
  id: string;
  title: string;
  detail?: string;
};

export type TutorialGuide = {
  id: string;
  version: number;
  title: string;
  detail: string;
  icon: string;
  path: string;
  sections?: readonly TutorialSection[];
  steps: readonly TutorialStep[];
};

export type TutorialProgress = {
  guideId: string;
  guideVersion: number;
  demoAnchorDate: string;
  stepId: string;
  stepIndex: number;
  completedStepIds: string[];
  completed: boolean;
  startedAt: string;
  updatedAt: string;
};

export type ActiveTutorialSession = {
  guideId: string;
  guideVersion: number;
  stepId: string;
  stepIndex: number;
  runId: number;
  demoAnchorDate: string;
  completedStepIds: string[];
  practiceActionIds: string[];
  startedAt: string;
  updatedAt: string;
};

export type TutorialStartOptions = {
  resume?: boolean;
  stepId?: string;
};
