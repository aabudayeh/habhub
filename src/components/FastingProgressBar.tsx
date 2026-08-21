import React from "react";
import {
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { dateKey, dateWithOffsetFrom, friendlyDate } from "@/src/domain/date";
import { useLocalization } from "@/src/i18n";
import { palette, useAppColors } from "@/src/theme";

const DAY_MINUTES = 24 * 60;
const MINUTE_MS = 60_000;

export type FastingTimestamp = Date | number | string;

export type FastingProgressBarProps = {
  /** Beginning of this fasting session. Numbers are Unix timestamps in milliseconds. */
  startedAt: FastingTimestamp;
  /** End of a completed session. Omit while the fast is active. */
  endedAt?: FastingTimestamp;
  /** Active bars refresh themselves at each elapsed-minute boundary. */
  active: boolean;
  /** Planned fasting portion of the 24-hour cycle. */
  targetMinutes: number;
  /** Tracker identity color used for normal progress. */
  metricColor: string;
  /** Override the derived result when meal-window policy is known upstream. */
  endedOutsideEatingWindow?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  locale?: string;
  timeFormat?: "12h" | "24h";
};

function timestamp(value: FastingTimestamp | undefined) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") return new Date(value).getTime();
  return Number.NaN;
}

function boundedMinutes(value: number, fallback = 0) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
}

function formatMinutes(value: number, locale?: string) {
  const minutes = boundedMinutes(value);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const number = (amount: number, unit: "hour" | "minute") =>
    new Intl.NumberFormat(locale, {
      style: "unit",
      unit,
      unitDisplay: "narrow",
      maximumFractionDigits: 0,
    }).format(amount);
  if (!hours) return number(remainder, "minute");
  if (!remainder) return number(hours, "hour");
  return `${number(hours, "hour")} ${number(remainder, "minute")}`;
}

/** Keeps a running fast current without asking its parent screen to re-render. */
function useLiveNow(active: boolean, startedAtMs: number) {
  const [now, setNow] = React.useState(Date.now);

  React.useEffect(() => {
    if (!active || !Number.isFinite(startedAtMs)) return;

    setNow(Date.now());
    let minuteInterval: ReturnType<typeof setInterval> | undefined;
    const elapsed = Math.max(0, Date.now() - startedAtMs);
    const untilNextMinute = MINUTE_MS - (elapsed % MINUTE_MS);
    const firstTick = setTimeout(() => {
      setNow(Date.now());
      minuteInterval = setInterval(() => setNow(Date.now()), MINUTE_MS);
    }, untilNextMinute + 25);

    return () => {
      clearTimeout(firstTick);
      if (minuteInterval) clearInterval(minuteInterval);
    };
  }, [active, startedAtMs]);

  return now;
}

/**
 * A compact 24-hour fasting timeline: the first zone is the planned fast and
 * the outlined second zone is the allowed eating window. Completed sessions
 * outside that window switch to red while live progress keeps the metric color.
 */
export function FastingProgressBar({
  startedAt,
  endedAt,
  active,
  targetMinutes,
  metricColor,
  endedOutsideEatingWindow,
  compact = false,
  style,
  accessibilityLabel = "Fasting progress",
  locale,
  timeFormat = "24h",
}: FastingProgressBarProps) {
  const colors = useAppColors();
  const { t } = useLocalization();
  const startedAtMs = timestamp(startedAt);
  const endedAtMs = timestamp(endedAt);
  const liveNow = useLiveNow(active, startedAtMs);
  const target = Math.min(
    DAY_MINUTES - 1,
    Math.max(1, boundedMinutes(targetMinutes, 16 * 60)),
  );
  const eatingWindow = DAY_MINUTES - target;
  const sessionEnd = active
    ? liveNow
    : Number.isFinite(endedAtMs)
      ? endedAtMs
      : startedAtMs;
  const elapsed =
    Number.isFinite(startedAtMs) && Number.isFinite(sessionEnd)
      ? Math.max(0, Math.floor((sessionEnd - startedAtMs) / MINUTE_MS))
      : 0;
  const derivedOutsideWindow =
    !active && (elapsed < target || elapsed >= DAY_MINUTES);
  const outsideWindow =
    !active &&
    (endedOutsideEatingWindow === undefined
      ? derivedOutsideWindow
      : endedOutsideEatingWindow);
  const fillColor = outsideWindow ? palette.red : metricColor;
  const fillPercent = Math.min(100, (elapsed / DAY_MINUTES) * 100);
  const targetPercent = (target / DAY_MINUTES) * 100;
  const status = outsideWindow
    ? "Ended outside eating window"
    : !active
      ? "Ended in eating window"
      : elapsed < target
        ? "Fasting"
        : elapsed <= DAY_MINUTES
          ? "Eating window open"
          : "Fast continuing";
  const startedDate = new Date(startedAtMs);
  const today = dateKey();
  const startDay =
    Number.isFinite(startedAtMs)
      ? dateKey(startedDate) === today
        ? t("Today")
        : dateKey(startedDate) === dateWithOffsetFrom(today, -1)
          ? t("Yesterday")
          : friendlyDate(dateKey(startedDate), locale)
      : "";
  const startClock = Number.isFinite(startedAtMs)
    ? new Intl.DateTimeFormat(locale, {
        hour: "numeric",
        minute: "2-digit",
        hour12: timeFormat === "12h",
      }).format(startedDate)
    : "";
  const statusWithStart = startClock
    ? `${t(status)} · ${startDay} ${startClock}`
    : t(status);
  const progressText = `${formatMinutes(elapsed, locale)} ${t(
    "elapsed",
  )}. ${t("Fast target")} ${formatMinutes(target, locale)}. ${t(
    "Eating window",
  )} ${formatMinutes(eatingWindow, locale)}. ${t(status)}.`;

  return (
    <View style={[styles.wrap, compact && styles.compactWrap, style]}>
      {!compact ? (
        <View style={styles.summaryRow}>
          <Text
            translate={false}
            numberOfLines={1}
            style={[styles.summary, { color: colors.ink }]}
          >
            {formatMinutes(elapsed, locale)} / {formatMinutes(target, locale)}
          </Text>
          <Text
            translate={false}
            numberOfLines={1}
            style={[
              styles.status,
              { color: outsideWindow ? palette.red : colors.muted },
            ]}
          >
            {statusWithStart}
          </Text>
        </View>
      ) : null}

      <View
        accessible
        accessibilityLabel={
          accessibilityLabel === "Fasting progress"
            ? t("Fasting progress")
            : accessibilityLabel
        }
        accessibilityRole="progressbar"
        accessibilityValue={{
          min: 0,
          max: target,
          now: Math.min(elapsed, target),
          text: progressText,
        }}
        style={[
          styles.track,
          { backgroundColor: colors.border },
          compact && styles.compactTrack,
        ]}
      >
        <View
          style={[
            styles.fill,
            { width: `${fillPercent}%`, backgroundColor: fillColor },
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.eatingWindow,
            {
              left: `${targetPercent}%`,
              width: `${100 - targetPercent}%`,
              borderColor: palette.lime,
              backgroundColor: `${palette.lime}24`,
            },
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.targetMarker,
            { left: `${targetPercent}%`, backgroundColor: palette.lime },
          ]}
        />
      </View>

      {!compact ? (
        <View style={styles.legendRow}>
          <Text
            numberOfLines={1}
            style={[styles.legend, { color: colors.muted }]}
          >
            {t("Fast target")} {formatMinutes(target, locale)}
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.legend, { color: colors.muted }]}
          >
            {t("Eating window")} {formatMinutes(eatingWindow, locale)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: 5 },
  compactWrap: { gap: 3 },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  summary: { flexShrink: 0, fontSize: 11, fontWeight: "900" },
  status: {
    flex: 1,
    fontSize: 9,
    fontWeight: "800",
    textAlign: "right",
  },
  track: {
    height: 10,
    borderRadius: 999,
    overflow: "hidden",
  },
  compactTrack: { height: 7 },
  fill: { height: "100%", borderRadius: 999 },
  eatingWindow: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
  },
  targetMarker: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  legend: { flexShrink: 1, fontSize: 8, fontWeight: "700" },
});
