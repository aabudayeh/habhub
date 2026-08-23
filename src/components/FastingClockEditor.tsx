import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { TutorialTarget } from "@/src/components/TutorialSpotlight";
import {
  advanceTwelveHourDial,
  formatClockTime,
  moveClockRangeHandle,
  type ClockRange,
  type TwelveHourDialCursor,
} from "@/src/domain/date";
import { useLocalization } from "@/src/i18n";
import { palette, useAppColors } from "@/src/theme";
import { useOptionalTutorial } from "@/src/tutorial/TutorialContext";

const DAY_MINUTES = 24 * 60;
const HALF_DAY_MINUTES = 12 * 60;
const MIN_FAST_MINUTES = 60;
const MAX_FAST_MINUTES = 23 * 60;
const DIAL_SIZE = 184;
const CENTER = DIAL_SIZE / 2;
const SEGMENTS = 48;
const AM_RING_RADIUS = 63;
const PM_RING_RADIUS = 77;

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

function point(minutes: number, radius: number) {
  const normalized =
    ((minutes % HALF_DAY_MINUTES) + HALF_DAY_MINUTES) % HALF_DAY_MINUTES;
  const angle = (normalized / HALF_DAY_MINUTES) * Math.PI * 2 - Math.PI / 2;
  return {
    left: CENTER + Math.cos(angle) * radius,
    top: CENTER + Math.sin(angle) * radius,
  };
}

function dialRadius(minutes: number) {
  const normalized = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return normalized < HALF_DAY_MINUTES ? AM_RING_RADIUS : PM_RING_RADIUS;
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
  const { t } = useLocalization();
  const tutorial = useOptionalTutorial();
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(parseClock(startTime));
  const [draftDuration, setDraftDuration] = useState(
    Math.max(
      MIN_FAST_MINUTES,
      Math.min(MAX_FAST_MINUTES, Math.round(fastingMinutes / 15) * 15),
    ),
  );
  const dialRef = useRef<View>(null);
  const centerRef = useRef({ x: 0, y: 0 });
  const draftRef = useRef({ start: draftStart, duration: draftDuration });
  const fixedEndRef = useRef((draftStart + draftDuration) % DAY_MINUTES);
  const fixedStartRef = useRef(draftStart);
  const startCursorRef = useRef<TwelveHourDialCursor>({
    dialMinutes: draftStart % HALF_DAY_MINUTES,
    absoluteMinutes: draftStart,
  });
  const endCursorRef = useRef<TwelveHourDialCursor>({
    dialMinutes: (draftStart + draftDuration) % HALF_DAY_MINUTES,
    absoluteMinutes: (draftStart + draftDuration) % DAY_MINUTES,
  });
  const onChangeRef = useRef(onChange);
  const draggingRef = useRef(false);
  draftRef.current = { start: draftStart, duration: draftDuration };
  onChangeRef.current = onChange;

  useEffect(() => {
    const nextStart = parseClock(startTime);
    const nextDuration = Math.max(
      MIN_FAST_MINUTES,
      Math.min(MAX_FAST_MINUTES, Math.round(fastingMinutes / 15) * 15),
    );
    setDraftStart(nextStart);
    setDraftDuration(nextDuration);
  }, [fastingMinutes, startTime]);

  useEffect(() => {
    if (tutorial?.activeStep?.target === "fasting-clock") setOpen(true);
  }, [tutorial?.activeStep?.target]);

  const measureCenter = useCallback(() =>
    dialRef.current?.measureInWindow((x, y, width, height) => {
      centerRef.current = { x: x + width / 2, y: y + height / 2 };
    }), []);

  // The face is deliberately always a familiar 12-hour clock. AM/PM is
  // retained by advanceTwelveHourDial, while displayed text still follows the
  // user's global 12/24-hour preference.
  const minutesAt = useCallback((pageX: number, pageY: number) => {
    const angle = Math.atan2(
      pageY - centerRef.current.y,
      pageX - centerRef.current.x,
    );
    const clockwise = ((angle + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2));
    return (
      Math.round((clockwise / (Math.PI * 2)) * (HALF_DAY_MINUTES / 15)) * 15
    ) % HALF_DAY_MINUTES;
  }, []);

  const applyRange = useCallback((range: ClockRange) => {
    if (
      range.startMinutes === draftRef.current.start &&
      range.durationMinutes === draftRef.current.duration
    ) {
      return;
    }
    draftRef.current = {
      start: range.startMinutes,
      duration: range.durationMinutes,
    };
    setDraftStart(range.startMinutes);
    setDraftDuration(range.durationMinutes);
  }, []);

  const commitDraft = useCallback(() => {
    const next = draftRef.current;
    onChangeRef.current(clockValue(next.start), next.duration);
  }, []);

  const finishDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    commitDraft();
  }, [commitDraft]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    // A dragged handle rerenders at a new DOM position. Browsers can then lose
    // the responder's release event, so commit from the window as a fallback.
    window.addEventListener("pointerup", finishDrag, true);
    window.addEventListener("pointercancel", finishDrag, true);
    window.addEventListener("blur", finishDrag);
    return () => {
      window.removeEventListener("pointerup", finishDrag, true);
      window.removeEventListener("pointercancel", finishDrag, true);
      window.removeEventListener("blur", finishDrag);
    };
  }, [finishDrag]);

  const startDrag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          draggingRef.current = true;
          measureCenter();
          const current = draftRef.current;
          fixedEndRef.current = (current.start + current.duration) % DAY_MINUTES;
          startCursorRef.current = {
            dialMinutes: current.start % HALF_DAY_MINUTES,
            absoluteMinutes: current.start,
          };
        },
        onPanResponderMove: (event) => {
          const dialMinutes = minutesAt(
            event.nativeEvent.pageX,
            event.nativeEvent.pageY,
          );
          startCursorRef.current = advanceTwelveHourDial(
            dialMinutes,
            startCursorRef.current,
          );
          const current = draftRef.current;
          const range = moveClockRangeHandle(
            "start",
            startCursorRef.current.absoluteMinutes,
            {
              startMinutes: current.start,
              endMinutes: fixedEndRef.current,
            },
            {
              minDurationMinutes: MIN_FAST_MINUTES,
              maxDurationMinutes: MAX_FAST_MINUTES,
            },
          );
          // Keep the untouched endpoint stationary until the handles actually
          // collide with a duration limit. From there it follows only as much
          // as needed to keep the range valid.
          fixedEndRef.current = range.endMinutes;
          applyRange(range);
        },
        onPanResponderRelease: finishDrag,
        onPanResponderTerminate: finishDrag,
        onPanResponderTerminationRequest: () => false,
      }),
    [applyRange, finishDrag, measureCenter, minutesAt],
  );

  const endDrag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          draggingRef.current = true;
          measureCenter();
          const current = draftRef.current;
          const endMinutes = (current.start + current.duration) % DAY_MINUTES;
          fixedStartRef.current = current.start;
          endCursorRef.current = {
            dialMinutes: endMinutes % HALF_DAY_MINUTES,
            absoluteMinutes: endMinutes,
          };
        },
        onPanResponderMove: (event) => {
          const dialMinutes = minutesAt(
            event.nativeEvent.pageX,
            event.nativeEvent.pageY,
          );
          endCursorRef.current = advanceTwelveHourDial(
            dialMinutes,
            endCursorRef.current,
          );
          const current = draftRef.current;
          const range = moveClockRangeHandle(
            "end",
            endCursorRef.current.absoluteMinutes,
            {
              startMinutes: fixedStartRef.current,
              endMinutes: (current.start + current.duration) % DAY_MINUTES,
            },
            {
              minDurationMinutes: MIN_FAST_MINUTES,
              maxDurationMinutes: MAX_FAST_MINUTES,
            },
          );
          fixedStartRef.current = range.startMinutes;
          applyRange(range);
        },
        onPanResponderRelease: finishDrag,
        onPanResponderTerminate: finishDrag,
        onPanResponderTerminationRequest: () => false,
      }),
    [applyRange, finishDrag, measureCenter, minutesAt],
  );

  const adjustHandle = useCallback(
    (handle: "start" | "end", delta: number) => {
      const current = draftRef.current;
      const endMinutes = (current.start + current.duration) % DAY_MINUTES;
      const candidate =
        (handle === "start" ? current.start : endMinutes) + delta;
      const range = moveClockRangeHandle(
        handle,
        candidate,
        { startMinutes: current.start, endMinutes },
        {
          minDurationMinutes: MIN_FAST_MINUTES,
          maxDurationMinutes: MAX_FAST_MINUTES,
        },
      );
      applyRange(range);
      onChangeRef.current(
        clockValue(range.startMinutes),
        range.durationMinutes,
      );
    },
    [applyRange],
  );

  const end = (draftStart + draftDuration) % DAY_MINUTES;
  const startPoint = point(draftStart, dialRadius(draftStart));
  const endPoint = point(end, dialRadius(end));
  const formattedStart = formatClockTime(clockValue(draftStart), timeFormat, locale);
  const formattedEnd = formatClockTime(clockValue(end), timeFormat, locale);
  const fastingText = durationText(draftDuration, locale);
  const eatingText = durationText(DAY_MINUTES - draftDuration, locale);

  return (
    <TutorialTarget id="fasting-clock">
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
            {formattedStart}{" \u2013 "}{formattedEnd}{" \u00b7 "}{fastingText}
          </Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={17} color={colors.faint} />
      </Pressable>
      {open ? (
        <View style={styles.body}>
          <View style={styles.clockLayout}>
            <View ref={dialRef} onLayout={measureCenter} style={styles.dial}>
              {[0, HALF_DAY_MINUTES].flatMap((halfDay) =>
                Array.from({ length: SEGMENTS }, (_, index) => {
                  const minutes = (index / SEGMENTS) * HALF_DAY_MINUTES;
                  const absoluteMinutes = halfDay + minutes;
                  const location = point(
                    absoluteMinutes,
                    dialRadius(absoluteMinutes),
                  );
                  const inFast =
                    elapsedFrom(draftStart, absoluteMinutes) < draftDuration;
                  return (
                    <View
                      key={`${halfDay}-${index}`}
                      pointerEvents="none"
                      style={[
                        styles.tick,
                        {
                          left: location.left - 1.5,
                          top: location.top - 4.5,
                          backgroundColor: inFast
                            ? metricColor
                            : `${palette.lime}88`,
                          transform: [
                            { rotate: `${(index / SEGMENTS) * 360}deg` },
                          ],
                        },
                      ]}
                    />
                  );
                }),
              )}
              {Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => {
                const location = point((hour % 12) * 60, 54);
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
                    {new Intl.NumberFormat(locale).format(hour)}
                  </Text>
                );
              })}
              <View
                pointerEvents="none"
                style={[styles.dialCenter, { backgroundColor: `${metricColor}16` }]}
              >
                <Ionicons name="moon" size={17} color={metricColor} />
              </View>
              <View
                {...startDrag.panHandlers}
                accessible
                accessibilityLabel={t("Start fast")}
                accessibilityRole="adjustable"
                accessibilityValue={{ text: formattedStart }}
                accessibilityActions={[
                  { name: "increment" },
                  { name: "decrement" },
                ]}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === "increment") {
                    adjustHandle("start", 15);
                  } else if (event.nativeEvent.actionName === "decrement") {
                    adjustHandle("start", -15);
                  }
                }}
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
                accessible
                accessibilityLabel={t("End fast")}
                accessibilityRole="adjustable"
                accessibilityValue={{ text: formattedEnd }}
                accessibilityActions={[
                  { name: "increment" },
                  { name: "decrement" },
                ]}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === "increment") {
                    adjustHandle("end", 15);
                  } else if (event.nativeEvent.actionName === "decrement") {
                    adjustHandle("end", -15);
                  }
                }}
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

            <View style={styles.metricRail}>
              <View style={styles.halfDayLegend}>
                <View style={styles.halfDayLegendItem}>
                  <View
                    style={[
                      styles.halfDayDot,
                      styles.halfDayDotInner,
                      { borderColor: colors.faint },
                    ]}
                  />
                  <Text translate={false} style={[styles.halfDayText, { color: colors.faint }]}>AM</Text>
                </View>
                <View style={styles.halfDayLegendItem}>
                  <View
                    style={[
                      styles.halfDayDot,
                      styles.halfDayDotOuter,
                      { borderColor: colors.faint },
                    ]}
                  />
                  <Text translate={false} style={[styles.halfDayText, { color: colors.faint }]}>PM</Text>
                </View>
              </View>
              <View style={styles.metricBlock}>
                <View style={styles.endpointRow}>
                  <Ionicons name="play" size={9} color={metricColor} />
                  <Text style={[styles.endpointLabel, { color: colors.faint }]}>Start</Text>
                </View>
                <Text
                  translate={false}
                  numberOfLines={1}
                  style={[styles.endpointTime, { color: metricColor }]}
                >
                  {formattedStart}
                </Text>
                <Text translate={false} numberOfLines={1} style={[styles.metricValue, { color: colors.ink }]}>
                  {fastingText}
                </Text>
                <Text numberOfLines={1} style={[styles.metricLabel, { color: colors.muted }]}>Fasting</Text>
              </View>
              <View style={[styles.metricDivider, { backgroundColor: colors.border }]} />
              <View style={styles.metricBlock}>
                <View style={styles.endpointRow}>
                  <Ionicons name="stop" size={8} color={palette.lime} />
                  <Text style={[styles.endpointLabel, { color: colors.faint }]}>Stop</Text>
                </View>
                <Text
                  translate={false}
                  numberOfLines={1}
                  style={[styles.endpointTime, { color: palette.lime }]}
                >
                  {formattedEnd}
                </Text>
                <Text translate={false} numberOfLines={1} style={[styles.metricValue, { color: colors.ink }]}>
                  {eatingText}
                </Text>
                <Text numberOfLines={1} style={[styles.metricLabel, { color: colors.muted }]}>Eating window</Text>
              </View>
            </View>
          </View>
        </View>
      ) : null}
      </View>
    </TutorialTarget>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, overflow: "hidden", marginBottom: 10 },
  heading: { minHeight: 58, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 9 },
  icon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 12, fontWeight: "900" },
  meta: { marginTop: 2, fontSize: 10, fontWeight: "700" },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(127,127,127,0.25)",
    paddingVertical: 8,
    paddingHorizontal: 2,
    alignItems: "center",
  },
  clockLayout: {
    minHeight: DIAL_SIZE,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  dial: { width: DIAL_SIZE, height: DIAL_SIZE, position: "relative" },
  tick: { position: "absolute", width: 3, height: 9, borderRadius: 3 },
  hour: { position: "absolute", width: 26, textAlign: "center", fontSize: 8, fontWeight: "800" },
  dialCenter: {
    position: "absolute",
    left: CENTER - 19,
    top: CENTER - 19,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  handle: {
    position: "absolute",
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },
  metricRail: {
    width: 86,
    minHeight: 164,
    justifyContent: "center",
  },
  halfDayLegend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 2,
    marginBottom: 2,
  },
  halfDayLegendItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  halfDayDot: { borderWidth: 1.5, borderRadius: 8 },
  halfDayDotInner: { width: 7, height: 7 },
  halfDayDotOuter: { width: 10, height: 10 },
  halfDayText: { fontSize: 7, lineHeight: 9, fontWeight: "900" },
  metricBlock: { paddingHorizontal: 2, paddingVertical: 5 },
  endpointRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  endpointLabel: { fontSize: 8, lineHeight: 10, fontWeight: "900", textTransform: "uppercase" },
  endpointTime: { marginTop: 1, fontSize: 10, lineHeight: 13, fontWeight: "900" },
  metricValue: { marginTop: 4, fontSize: 16, lineHeight: 19, fontWeight: "900" },
  metricLabel: { marginTop: 1, fontSize: 8, lineHeight: 10, fontWeight: "800" },
  metricDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 2, marginVertical: 4 },
});
