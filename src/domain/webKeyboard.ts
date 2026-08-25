export type WebKeyboardVisibilityInput = {
  activeEditor: boolean;
  baselineHeight: number;
  currentHeight: number;
  documentVisible: boolean;
  editorInteractionActive?: boolean;
  requireFreshEditorInteraction?: boolean;
  minimumKeyboardHeight?: number;
};

/**
 * Decide whether a Web viewport is actually obstructed by a software keyboard.
 *
 * Installed iOS Web apps can restore a suspended page with its previous input
 * still reported as `document.activeElement`, even though the keyboard is no
 * longer present. Callers can require a fresh editor interaction after each
 * page lifecycle transition so that stale focus always fails visible.
 */
export function resolveWebSoftwareKeyboardVisibility({
  activeEditor,
  baselineHeight,
  currentHeight,
  documentVisible,
  editorInteractionActive = true,
  requireFreshEditorInteraction = false,
  minimumKeyboardHeight = 96,
}: WebKeyboardVisibilityInput): boolean {
  if (!documentVisible || !activeEditor) return false;
  if (requireFreshEditorInteraction && !editorInteractionActive) return false;

  const baseline = Number.isFinite(baselineHeight)
    ? Math.max(0, baselineHeight)
    : 0;
  const current = Number.isFinite(currentHeight)
    ? Math.max(0, currentHeight)
    : 0;
  const threshold = Math.max(
    minimumKeyboardHeight,
    Math.round(baseline * 0.14),
  );
  return baseline - current >= threshold;
}
