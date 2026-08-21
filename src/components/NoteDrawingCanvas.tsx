import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  View,
} from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import {
  addJournalDrawingStroke,
  appendJournalDrawingPoint,
  createJournalDrawingStroke,
  normalizeJournalDrawing,
} from "@/src/domain/journalDrawing";
import { useTranslation } from "@/src/i18n";
import type {
  JournalDrawing,
  JournalDrawingPoint,
  JournalDrawingStroke,
} from "@/src/types";

type CanvasSize = { width: number; height: number };

function pointFromEvent(
  event: GestureResponderEvent,
  size: CanvasSize,
): JournalDrawingPoint {
  const { locationX, locationY } = event.nativeEvent;
  return [
    Math.max(0, Math.min(1, locationX / Math.max(1, size.width))),
    Math.max(0, Math.min(1, locationY / Math.max(1, size.height))),
  ];
}

function pixelPoint(point: JournalDrawingPoint, size: CanvasSize) {
  return [point[0] * size.width, point[1] * size.height] as const;
}

function strokePath(stroke: JournalDrawingStroke, size: CanvasSize) {
  const points = stroke.points.map((point) => pixelPoint(point, size));
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`;
  }
  let path = `M ${points[0][0]} ${points[0][1]}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    path += ` Q ${point[0]} ${point[1]} ${(point[0] + next[0]) / 2} ${(point[1] + next[1]) / 2}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last[0]} ${last[1]}`;
}

function Stroke({
  stroke,
  size,
}: {
  stroke: JournalDrawingStroke;
  size: CanvasSize;
}) {
  if (stroke.points.length === 1) {
    const [cx, cy] = pixelPoint(stroke.points[0], size);
    return (
      <Circle
        cx={cx}
        cy={cy}
        r={stroke.width / 2}
        fill={stroke.color}
      />
    );
  }
  return (
    <Path
      d={strokePath(stroke, size)}
      fill="none"
      stroke={stroke.color}
      strokeWidth={stroke.width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/**
 * A vector ink layer that sits above the responsive note canvas. Text and
 * images remain untouched; normalized points keep the layer portable.
 */
export function NoteDrawingCanvas({
  drawing,
  enabled,
  color,
  width,
  onChange,
}: {
  drawing?: JournalDrawing;
  enabled: boolean;
  color: string;
  width: number;
  onChange: (drawing?: JournalDrawing) => void;
}) {
  const t = useTranslation();
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [preview, setPreview] = useState<JournalDrawingStroke | undefined>(
    undefined,
  );
  const sizeRef = useRef(size);
  const enabledRef = useRef(enabled);
  const colorRef = useRef(color);
  const widthRef = useRef(width);
  const drawingRef = useRef(normalizeJournalDrawing(drawing));
  const onChangeRef = useRef(onChange);
  const activeStroke = useRef<JournalDrawingStroke | undefined>(undefined);
  const previewFrame = useRef<number | undefined>(undefined);

  sizeRef.current = size;
  enabledRef.current = enabled;
  colorRef.current = color;
  widthRef.current = width;
  drawingRef.current = normalizeJournalDrawing(drawing);
  onChangeRef.current = onChange;

  const schedulePreview = useCallback(() => {
    if (previewFrame.current !== undefined) return;
    previewFrame.current = requestAnimationFrame(() => {
      previewFrame.current = undefined;
      setPreview(activeStroke.current);
    });
  }, []);

  const finishStroke = useCallback(() => {
    if (previewFrame.current !== undefined) {
      cancelAnimationFrame(previewFrame.current);
      previewFrame.current = undefined;
    }
    const stroke = activeStroke.current;
    activeStroke.current = undefined;
    setPreview(undefined);
    if (!stroke?.points.length) return;
    const next = addJournalDrawingStroke(drawingRef.current, stroke);
    drawingRef.current = next;
    onChangeRef.current(next);
  }, []);

  useEffect(
    () => () => {
      if (previewFrame.current !== undefined) {
        cancelAnimationFrame(previewFrame.current);
      }
    },
    [],
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => enabledRef.current,
        onStartShouldSetPanResponderCapture: () => enabledRef.current,
        onMoveShouldSetPanResponder: () => enabledRef.current,
        onMoveShouldSetPanResponderCapture: () => enabledRef.current,
        onPanResponderGrant: (event) => {
          if (!enabledRef.current) return;
          const point = pointFromEvent(event, sizeRef.current);
          activeStroke.current = createJournalDrawingStroke(
            `ink-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            colorRef.current,
            widthRef.current,
            point,
          );
          setPreview(activeStroke.current);
        },
        onPanResponderMove: (event) => {
          const current = activeStroke.current;
          if (!current) return;
          const next = appendJournalDrawingPoint(
            current,
            pointFromEvent(event, sizeRef.current),
          );
          if (next === current) return;
          activeStroke.current = next;
          schedulePreview();
        },
        onPanResponderRelease: finishStroke,
        onPanResponderTerminate: finishStroke,
        onPanResponderTerminationRequest: () => false,
      }),
    [finishStroke, schedulePreview],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const next = {
      width: event.nativeEvent.layout.width,
      height: event.nativeEvent.layout.height,
    };
    sizeRef.current = next;
    setSize(next);
  };
  const strokes = normalizeJournalDrawing(drawing)?.strokes ?? [];

  return (
    <View
      {...responder.panHandlers}
      accessible={enabled}
      accessibilityLabel={enabled ? t("Draw on note") : undefined}
      accessibilityRole={enabled ? "image" : undefined}
      importantForAccessibility={enabled ? "yes" : "no-hide-descendants"}
      onLayout={onLayout}
      pointerEvents={enabled ? "auto" : "none"}
      style={styles.layer}
      testID="journal-drawing-canvas"
    >
      {size.width > 0 && size.height > 0 ? (
        <Svg
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          width={size.width}
          height={size.height}
        >
          {strokes.map((stroke) => (
            <Stroke key={stroke.id} stroke={stroke} size={size} />
          ))}
          {preview ? <Stroke stroke={preview} size={size} /> : null}
        </Svg>
      ) : null}
    </View>
  );
}

/** Lightweight, non-interactive ink preview for Journal cards. */
export const NoteDrawingPreview = React.memo(function NoteDrawingPreview({
  drawing,
}: {
  drawing?: JournalDrawing;
}) {
  const t = useTranslation();
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const strokes = useMemo(
    () => normalizeJournalDrawing(drawing)?.strokes ?? [],
    [drawing],
  );
  if (!strokes.length) return null;
  return (
    <View
      accessibilityLabel={t("Drawing")}
      accessibilityRole="image"
      onLayout={(event) =>
        setSize({
          width: event.nativeEvent.layout.width,
          height: event.nativeEvent.layout.height,
        })
      }
      pointerEvents="none"
      style={styles.layer}
      testID="journal-drawing-preview"
    >
      {size.width > 0 && size.height > 0 ? (
        <Svg
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          width={size.width}
          height={size.height}
        >
          {strokes.map((stroke) => (
            <Stroke key={stroke.id} stroke={stroke} size={size} />
          ))}
        </Svg>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
});
