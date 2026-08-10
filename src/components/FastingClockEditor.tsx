import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import {
  advanceTwelveHourDial,
  formatClockTime,
  type TwelveHourDialCursor,
} from "@/src/domain/date";
import { palette, useAppColors } from "@/src/theme";

const DAY_MINUTES = 24 * 60;
const DIAL_SIZE = 220;
const CENTER = DIAL_SIZE / 2;
const SEGMENTS = 48;
const SEGMENT_RADIUS = 88;
const HANDLE_RADIUS = 88;
const HALF_DAY_MINUTES = 12 * 60;

function parseClock(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 20 * 60;
  return ((hour * 60 + minute) % DAY_MINUTES + DAY_MINUTES) % DAY_MINUTES;
}

function clockValue(minutes: number) {
  const normalized = ((Math.round(minutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function elapsedFrom(start: number, end: number) {
  return (end - start + DAY_MINUTES) % DAY_MINUTES;
}

function point(minutes: number, radius: number, cycleMinutes = DAY_MINUTES) {
  const normalized =
    ((minutes % cycleMinutes) + cycleMinutes) % cycleMinutes;
  const angle = (normalized / cycleMinutes) * Math.PI * 2 - Math.PI / 2;
  return {
    left: CENTER + Math.cos(angle) * radius,
    top: CENTER + Math.sin(angle) * radius,
  };
}

function durationText(minutes: number, locale?: string) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const number = (value: number, unit: "hour" | "minute") =>
    new Intl.NumberFormat(locale, {
      style: "unit",
      unit,
      unitDisplay: "narrow",
      maximumFractionDigits: 0,
    }).format(value);
  return [
    hours ? number(hours, "hour") : "",
    remainder ? number(remainder, "minute") : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function FastingClockEditor({
  startTime,
  fastingMinutes,
  metricColor,
  timeFormat,
  locale,
  onChange,
}: {
  startTime: string;
  fastingMinutes: number;
  metricColor: string;
  timeFormat: "12h" | "24h";
  locale?: string;
  onChange: (startTime: string, fastingMinutes: number) => void;
}) {
  const colors = useAppColors();
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(parseClock(startTime));
  const [draftDuration, setDraftDuration] = useState(
    Math.max(60, Math.min(23 * 60, Math.round(fastingMinutes / 15) * 15)),
  );
  const dialRef = useRef<View>(null);
  const centerRef = useRef({ x: 0, y: 0 });
  const draftRef = useRef({ start: draftStart, duration: draftDuration });
  const startCursorRef = useRef<TwelveHourDialCursor>({
    dialMinutes: draftStart % HALF_DAY_MINUTES,
    absoluteMinutes: draftStart,
  });
  const endCursorRef = useRef<TwelveHourDialCursor>({
    dialMinutes: (draftStart + draftDuration) % HALF_DAY_MINUTES,
    absoluteMinutes: (draftStart + draftDuration) % DAY_MINUTES,
  });
  const onChangeRef = useRef(onChange);
  draftRef.current = { start: draftStart, duration: draftDuration };
  onChangeRef.current = onChange;

  useEffect(() => {
    setDraftStart(parseClock(startTime));
    setDraftDuration(
      Math.max(60, Math.min(23 * 60, Math.round(fastingMinutes / 15) * 15)),
    );
  }, [fastingMinutes, startTime]);

  const measureCenter = useCallback(() =>
    dialRef.current?.measureInWindow((x, y, width, height) => {
      centerRef.current = { x: x + width / 2, y: y + height / 2 };
    }), []);

  const minutesAt = useCallback((pageX: number, pageY: number) => {
    const angle = Math.atan2(
      pageY - centerRef.current.y,
      pageX - centerRef.current.x,
    );
    const clockwise = ((angle + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2));
    const cycle = timeFormat === "12h" ? HALF_DAY_MINUTES : DAY_MINUTES;
    return (
      Math.round((clockwise / (Math.PI * 2)) * (cycle / 15)) * 15
    ) % cycle;
  }, [timeFormat]);

  const startDrag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          measureCenter();
          startCursorRef.current = {
            dialMinutes: draftRef.current.start % HALF_DAY_MINUTES,
            absoluteMinutes: draftRef.current.start,
          };
        },
        onPanResponderMove: (event) => {
          const dialMinutes = minutesAt(
            event.nativeEvent.pageX,
            event.nativeEvent.pageY,
          );
          if (timeFormat === "12h") {
            startCursorRef.current = advanceTwelveHourDial(
              dialMinutes,
              startCursorRef.current,
            );
          }
          const next =
            timeFormat === "12h"
              ? startCursorRef.current.absoluteMinutes
              : dialMinutes;
          draftRef.current = { ...draftRef.current, start: next };
          setDraftStart(next);
        },
        onPanResponderRelease: () => {
          const next = draftRef.current;
          onChangeRef.current(clockValue(next.start), next.duration);
        },
      }),
    // The responder reads current drafts through refs, avoiding a new native
    // gesture object for every 15-minute movement.
    [measureCenter, minutesAt, timeFormat],
  );
  const endDrag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          measureCenter();
          const absoluteMinutes =
            (draftRef.current.start + draftRef.current.duration) % DAY_MINUTES;
          endCursorRef.current = {
            dialMinutes: absoluteMinutes % HALF_DAY_MINUTES,
            absoluteMinutes,
          };
        },
        onPanResponderMove: (event) => {
          const dialMinutes = minutesAt(
            event.nativeEvent.pageX,
            event.nativeEvent.pageY,
          );
          if (timeFormat === "12h") {
            endCursorRef.current = advanceTwelveHourDial(
              dialMinutes,
              endCursorRef.current,
            );
          }
          const end =
            timeFormat === "12h"
              ? endCursorRef.current.absoluteMinutes
              : dialMinutes;
          const next = Math.max(
            60,
            Math.min(23 * 60, elapsedFrom(draftRef.current.start, end)),
          );
          draftRef.current = { ...draftRef.current, duration: next };
          setDraftDuration(next);
        },
        onPanResponderRelease: () => {
          const next = draftRef.current;
          onChangeRef.current(clockValue(next.start), next.duration);
        },
      }),
    [measureCenter, minutesAt, timeFormat],
  );

  const end = (draftStart + draftDuration) % DAY_MINUTES;
  const dialCycle = timeFormat === "12h" ? HALF_DAY_MINUTES : DAY_MINUTES;
  const startPoint = point(
    draftStart,
    timeFormat === "12h" ? 76 : HANDLE_RADIUS,
    dialCycle,
  );
  const endPoint = point(
    end,
    timeFormat === "12h" ? 94 : HANDLE_RADIUS,
    dialCycle,
  );
  const formattedStart = formatClockTime(clockValue(draftStart), timeFormat, locale);
  const formattedEnd = formatClockTime(clockValue(end), timeFormat, locale);

  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.heading}
      >
        <View style={[styles.icon, { backgroundColor: `${metricColor}1F` }]}>
          <Ionicons name="time-outline" size={18} color={metricColor} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.ink }]}>Intermittent fasting</Text>
          <Text translate={false} style={[styles.meta, { color: colors.muted }]}>
            {formattedStart} – {formattedEnd} · {durationText(draftDuration, locale)}
          </Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={17} color={colors.faint} />
      </Pressable>
      {open ? (
        <View style={styles.body}>
          <View ref={dialRef} style={styles.dial}>
            {Array.from({ length: SEGMENTS }, (_, index) => {
              const minutes = (index / SEGMENTS) * dialCycle;
              const location = point(minutes, SEGMENT_RADIUS, dialCycle);
              const inFast =
                timeFormat === "12h"
                  ? elapsedFrom(draftStart, minutes) < draftDuration ||
                    elapsedFrom(draftStart, minutes + HALF_DAY_MINUTES) <
                      draftDuration
                  : elapsedFrom(draftStart, minutes) < draftDuration;
              return (
                <View
                  key={index}
                  pointerEvents="none"
                  style={[
                    styles.tick,
                    {
                      left: location.left - 2,
                      top: location.top - 6,
                      backgroundColor: inFast ? metricColor : `${palette.lime}88`,
                      transform: [{ rotate: `${(index / SEGMENTS) * 360}deg` }],
                    },
                  ]}
                />
              );
            })}
            {(timeFormat === "12h"
              ? Array.from({ length: 12 }, (_, index) => index + 1)
              : [0, 6, 12, 18]
            ).map((hour) => {
              const minutes =
                timeFormat === "12h" ? (hour % 12) * 60 : hour * 60;
              const location = point(minutes, 67, dialCycle);
              return (
                <Text
                  key={hour}
                  translate={false}
                  pointerEvents="none"
                  style={[
                    styles.hour,
                    { left: location.left - 13, top: location.top - 7, color: colors.faint },
                  ]}
                >
                  {timeFormat === "12h"
                    ? new Intl.NumberFormat(locale).format(hour)
                    : String(hour).padStart(2, "0")}
                </Text>
              );
            })}
            <View pointerEvents="none" style={styles.centerLabel}>
              <Text translate={false} style={[styles.duration, { color: colors.ink }]}>
                {durationText(draftDuration, locale)}
              </Text>
              <Text style={[styles.centerMeta, { color: colors.muted }]}>Fasting</Text>
              <Text translate={false} style={[styles.window, { color: colors.faint }]}>
                {durationText(DAY_MINUTES - draftDuration, locale)} · <Text>Eating window</Text>
              </Text>
            </View>
            <View
              {...startDrag.panHandlers}
              accessibilityLabel="Start fast"
              accessibilityRole="adjustable"
              accessibilityValue={{ text: formattedStart }}
              style={[
                styles.handle,
                {
                  left: startPoint.left - 16,
                  top: startPoint.top - 16,
                  borderColor: colors.card,
                  backgroundColor: metricColor,
                },
              ]}
            >
              <Ionicons name="play" size={13} color={palette.white} />
            </View>
            <View
              {...endDrag.panHandlers}
              accessibilityLabel="End fast"
              accessibilityRole="adjustable"
              accessibilityValue={{ text: formattedEnd }}
              style={[
                styles.handle,
                {
                  left: endPoint.left - 16,
                  top: endPoint.top - 16,
                  borderColor: colors.card,
                  backgroundColor: palette.lime,
                },
              ]}
            >
              <Ionicons name="stop" size={12} color="#10220A" />
            </View>
          </View>
          <View style={styles.times}>
            <Text translate={false} style={[styles.time, { color: metricColor }]}>
              {formattedStart}
            </Text>
            <Ionicons name="arrow-forward" size={15} color={colors.faint} />
            <Text translate={false} style={[styles.time, { color: palette.lime }]}>
              {formattedEnd}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, overflow: "hidden", marginBottom: 10 },
  heading: { minHeight: 58, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 9 },
  icon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 12, fontWeight: "900" },
  meta: { marginTop: 2, fontSize: 10, fontWeight: "700" },
  body: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(127,127,127,0.25)", paddingVertical: 10, alignItems: "center" },
  dial: { width: DIAL_SIZE, height: DIAL_SIZE, position: "relative" },
  tick: { position: "absolute", width: 4, height: 12, borderRadius: 3 },
  hour: { position: "absolute", width: 26, textAlign: "center", fontSize: 8, fontWeight: "800" },
  centerLabel: { position: "absolute", left: 52, right: 52, top: 76, alignItems: "center" },
  duration: { fontSize: 20, lineHeight: 24, fontWeight: "900" },
  centerMeta: { fontSize: 10, fontWeight: "900" },
  window: { marginTop: 4, fontSize: 8, fontWeight: "700" },
  handle: { position: "absolute", width: 32, height: 32, borderRadius: 16, borderWidth: 3, alignItems: "center", justifyContent: "center", elevation: 4 },
  times: { marginTop: -4, flexDirection: "row", alignItems: "center", gap: 10 },
  time: { minWidth: 68, textAlign: "center", fontSize: 12, fontWeight: "900" },
});
