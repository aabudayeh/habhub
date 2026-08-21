export type TutorialRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ScreenSize = { width: number; height: number };

export function relativeTargetRect(
  target: TutorialRect,
  origin: { x: number; y: number },
): TutorialRect {
  return {
    x: target.x - origin.x,
    y: target.y - origin.y,
    width: target.width,
    height: target.height,
  };
}

export function isRectVisible(rect: TutorialRect, screen: ScreenSize) {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x < screen.width &&
    rect.y < screen.height &&
    rect.x + rect.width > 0 &&
    rect.y + rect.height > 0
  );
}

export function spotlightRect(
  target: TutorialRect,
  screen: ScreenSize,
  padding = 7,
): TutorialRect | undefined {
  if (!isRectVisible(target, screen)) return undefined;
  const edge = 7;
  const x = Math.max(edge, target.x - padding);
  const y = Math.max(edge, target.y - padding);
  const right = Math.min(screen.width - edge, target.x + target.width + padding);
  const bottom = Math.min(
    screen.height - edge,
    target.y + target.height + padding,
  );
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

export function calloutLayout({
  screen,
  spotlight,
  calloutHeight,
  safeTop = 8,
  safeBottom = 8,
}: {
  screen: ScreenSize;
  spotlight?: TutorialRect;
  calloutHeight: number;
  safeTop?: number;
  safeBottom?: number;
}) {
  const gutter = 12;
  const gap = 14;
  const width = Math.min(430, Math.max(0, screen.width - gutter * 2));
  const left = Math.max(gutter, (screen.width - width) / 2);
  const topLimit = safeTop + gutter;
  const bottomLimit = screen.height - safeBottom - gutter;
  const height = Math.min(calloutHeight || 214, bottomLimit - topLimit);
  if (!spotlight) {
    return {
      left,
      top: Math.max(topLimit, (screen.height - height) / 2),
      width,
      placement: "center" as const,
    };
  }
  const roomBelow = bottomLimit - (spotlight.y + spotlight.height + gap);
  const roomAbove = spotlight.y - gap - topLimit;
  if (roomBelow >= height || roomBelow >= roomAbove) {
    return {
      left,
      top: Math.min(
        bottomLimit - height,
        spotlight.y + spotlight.height + gap,
      ),
      width,
      placement: "below" as const,
    };
  }
  return {
    left,
    top: Math.max(topLimit, spotlight.y - gap - height),
    width,
    placement: "above" as const,
  };
}
