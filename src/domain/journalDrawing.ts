import type {
  JournalDrawing,
  JournalDrawingPoint,
  JournalDrawingStroke,
} from "../types";

export const JOURNAL_DRAWING_VERSION = 1 as const;
export const MAX_JOURNAL_DRAWING_STROKES = 120;
export const MAX_JOURNAL_DRAWING_POINTS_PER_STROKE = 900;
export const MAX_JOURNAL_DRAWING_POINTS = 6_000;
export const JOURNAL_DRAWING_MIN_POINT_DISTANCE = 0.0025;

const DEFAULT_COLOR = "#20252E";
const DEFAULT_WIDTH = 4;

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function clampUnit(value: number) {
  // Four decimals are sub-pixel at phone/tablet sizes and keep synced JSON
  // substantially smaller than raw touch-event floating-point values.
  return Math.round(Math.max(0, Math.min(1, value)) * 10_000) / 10_000;
}

function normalizedPoint(value: unknown): JournalDrawingPoint | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const x = finiteNumber(value[0]);
  const y = finiteNumber(value[1]);
  if (x === undefined || y === undefined) return undefined;
  return [clampUnit(x), clampUnit(y)];
}

function normalizedColor(value: unknown) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toUpperCase()
    : DEFAULT_COLOR;
}

function normalizedWidth(value: unknown) {
  const width = finiteNumber(value) ?? DEFAULT_WIDTH;
  return Math.max(1, Math.min(16, Math.round(width * 10) / 10));
}

function normalizedId(value: unknown, index: number) {
  if (typeof value !== "string") return `stroke-${index}`;
  const clean = value.trim().slice(0, 72);
  return clean || `stroke-${index}`;
}

function distanceSquared(
  left: JournalDrawingPoint,
  right: JournalDrawingPoint,
) {
  const dx = left[0] - right[0];
  const dy = left[1] - right[1];
  return dx * dx + dy * dy;
}

/**
 * Accepts persisted/cloud JSON without trusting its shape or payload size.
 * Old notes have no drawing and remain valid.
 */
export function normalizeJournalDrawing(
  value: unknown,
): JournalDrawing | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as { version?: unknown; strokes?: unknown };
  if (source.version !== JOURNAL_DRAWING_VERSION) return undefined;
  if (!Array.isArray(source.strokes)) return undefined;

  const strokes: JournalDrawingStroke[] = [];
  let totalPoints = 0;
  for (const [index, rawStroke] of source.strokes.entries()) {
    if (strokes.length >= MAX_JOURNAL_DRAWING_STROKES) break;
    if (!rawStroke || typeof rawStroke !== "object") continue;
    const candidate = rawStroke as {
      id?: unknown;
      color?: unknown;
      width?: unknown;
      points?: unknown;
    };
    if (!Array.isArray(candidate.points)) continue;
    const points: JournalDrawingPoint[] = [];
    for (const rawPoint of candidate.points) {
      if (
        points.length >= MAX_JOURNAL_DRAWING_POINTS_PER_STROKE ||
        totalPoints >= MAX_JOURNAL_DRAWING_POINTS
      ) {
        break;
      }
      const point = normalizedPoint(rawPoint);
      if (!point) continue;
      const previous = points[points.length - 1];
      if (
        previous &&
        distanceSquared(previous, point) <
          JOURNAL_DRAWING_MIN_POINT_DISTANCE ** 2
      ) {
        continue;
      }
      points.push(point);
      totalPoints += 1;
    }
    if (!points.length) continue;
    strokes.push({
      id: normalizedId(candidate.id, index),
      color: normalizedColor(candidate.color),
      width: normalizedWidth(candidate.width),
      points,
    });
  }
  return strokes.length
    ? { version: JOURNAL_DRAWING_VERSION, strokes }
    : undefined;
}

export function createJournalDrawingStroke(
  id: string,
  color: string,
  width: number,
  point: JournalDrawingPoint,
): JournalDrawingStroke {
  return {
    id: normalizedId(id, 0),
    color: normalizedColor(color),
    width: normalizedWidth(width),
    points: [normalizedPoint(point) ?? [0, 0]],
  };
}

/** Returns the same stroke when a move is too small to be visually useful. */
export function appendJournalDrawingPoint(
  stroke: JournalDrawingStroke,
  pointValue: JournalDrawingPoint,
) {
  if (stroke.points.length >= MAX_JOURNAL_DRAWING_POINTS_PER_STROKE) {
    return stroke;
  }
  const point = normalizedPoint(pointValue);
  if (!point) return stroke;
  const previous = stroke.points[stroke.points.length - 1];
  if (
    previous &&
    distanceSquared(previous, point) <
      JOURNAL_DRAWING_MIN_POINT_DISTANCE ** 2
  ) {
    return stroke;
  }
  return { ...stroke, points: [...stroke.points, point] };
}

export function addJournalDrawingStroke(
  drawing: JournalDrawing | undefined,
  stroke: JournalDrawingStroke,
): JournalDrawing {
  const current = normalizeJournalDrawing(drawing)?.strokes ?? [];
  const normalized = normalizeJournalDrawing({
    version: JOURNAL_DRAWING_VERSION,
    strokes: [...current, stroke],
  });
  return normalized ?? { version: JOURNAL_DRAWING_VERSION, strokes: [] };
}

export function undoJournalDrawing(
  drawing: JournalDrawing | undefined,
): JournalDrawing | undefined {
  const strokes = normalizeJournalDrawing(drawing)?.strokes ?? [];
  return normalizeJournalDrawing({
    version: JOURNAL_DRAWING_VERSION,
    strokes: strokes.slice(0, -1),
  });
}

export function journalDrawingFingerprint(value: unknown) {
  return JSON.stringify(normalizeJournalDrawing(value) ?? null);
}

export function journalDrawingHasInk(value: unknown) {
  return Boolean(normalizeJournalDrawing(value)?.strokes.length);
}
