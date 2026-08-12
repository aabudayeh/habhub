import { Ionicons } from "@expo/vector-icons";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { BodyProgressAvatar } from "@/src/components/BodyProgressAvatar";
import { GOAL_COMPLETE_COLOR } from "@/src/domain/colors";
import {
  STATUS_AVATAR_SIMULATION_METRICS,
  statusAvatarSimulationBaseline,
  statusAvatarSimulationInitialState,
  statusAvatarSimulationPreview,
  statusAvatarSimulationRange,
  statusAvatarSimulationSetEnabled,
  statusAvatarSimulationSetValue,
  type StatusAvatarSimulationMetric,
  type StatusAvatarSimulationRange,
} from "@/src/domain/statusAvatarSimulation";
import { useLocalization } from "@/src/i18n";
import { palette, useAppColors } from "@/src/theme";
import type {
  BiologicalSex,
  StatusAvatarCalculationSource,
  StatusAvatarStyle,
} from "@/src/types";

function SimulationSlider({
  accessibilityLabel,
  disabled,
  maximumValue,
  minimumValue,
  onChange,
  secondary = false,
  step,
  unit,
  value,
}: {
  accessibilityLabel: string;
  disabled: boolean;
  maximumValue: number;
  minimumValue: number;
  onChange: (value: number) => void;
  secondary?: boolean;
  step: number;
  unit: string;
  value: number;
}) {
  const colors = useAppColors();
  const trackWidthRef = useRef(1);
  const dragStartXRef = useRef(0);
  const progressRef = useRef(0);
  const lastEmittedValueRef = useRef(value);
  const configurationRef = useRef({
    disabled,
    maximumValue,
    minimumValue,
    onChange,
    step,
  });
  configurationRef.current = {
    disabled,
    maximumValue,
    minimumValue,
    onChange,
    step,
  };
  lastEmittedValueRef.current = value;
  const span = Math.max(step, maximumValue - minimumValue);
  const progress = Math.max(0, Math.min(1, (value - minimumValue) / span));
  progressRef.current = progress;
  const updateFromXRef = useRef<(x: number) => void>(() => undefined);
  updateFromXRef.current = (x: number) => {
    const configuration = configurationRef.current;
    if (configuration.disabled) return;
    const width = Math.max(1, trackWidthRef.current);
    const fraction = Math.max(0, Math.min(1, x / width));
    const raw =
      configuration.minimumValue +
      fraction * (configuration.maximumValue - configuration.minimumValue);
    const stepped =
      Math.round(raw / configuration.step) * configuration.step;
    const nextValue = Math.max(
      configuration.minimumValue,
      Math.min(configuration.maximumValue, stepped),
    );
    if (nextValue === lastEmittedValueRef.current) return;
    lastEmittedValueRef.current = nextValue;
    configuration.onChange(nextValue);
  };
  // Keep one responder for the lifetime of the slider. Recreating it while a
  // state update is rendering interrupts pointer capture on Android and web.
  const responderRef = useRef<ReturnType<typeof PanResponder.create> | null>(
    null,
  );
  if (!responderRef.current) {
    responderRef.current = PanResponder.create({
      onStartShouldSetPanResponder: () =>
        !configurationRef.current.disabled,
      onStartShouldSetPanResponderCapture: () =>
        !configurationRef.current.disabled,
      onMoveShouldSetPanResponder: () => !configurationRef.current.disabled,
      onMoveShouldSetPanResponderCapture: () =>
        !configurationRef.current.disabled,
      onPanResponderGrant: (event) => {
        const locationX = Number(event.nativeEvent.locationX);
        dragStartXRef.current = Number.isFinite(locationX)
          ? locationX
          : trackWidthRef.current * progressRef.current;
        updateFromXRef.current(dragStartXRef.current);
      },
      onPanResponderMove: (_, gestureState) =>
        updateFromXRef.current(dragStartXRef.current + gestureState.dx),
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    });
  }
  const responder = responderRef.current;
  const accessibilityStep = Math.max(
    step,
    Math.round((span / 20) / step) * step,
  );
  const accessibleValue = `${value.toFixed(step < 1 ? 1 : 0)}${unit ? ` ${unit}` : ""}`;
  const adjust = useCallback(
    (direction: -1 | 1) => {
      if (disabled) return;
      onChange(
        Math.max(
          minimumValue,
          Math.min(maximumValue, value + direction * accessibilityStep),
        ),
      );
    },
    [
      accessibilityStep,
      disabled,
      maximumValue,
      minimumValue,
      onChange,
      value,
    ],
  );
  const webKeyboardProps =
    Platform.OS === "web"
      ? {
          onKeyDown: (event: {
            key?: string;
            nativeEvent?: { key?: string };
            preventDefault?: () => void;
          }) => {
            const key = event.nativeEvent?.key ?? event.key;
            const direction =
              key === "ArrowRight" || key === "ArrowUp"
                ? 1
                : key === "ArrowLeft" || key === "ArrowDown"
                  ? -1
                  : 0;
            if (!direction || disabled) return;
            event.preventDefault?.();
            adjust(direction);
          },
        }
      : {};

  return (
    <View
      accessible
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="adjustable"
      accessibilityState={{ disabled }}
      accessibilityValue={{
        max: maximumValue,
        min: minimumValue,
        now: value,
        text: accessibleValue,
      }}
      focusable={!disabled}
      onAccessibilityAction={(event) => {
        const direction =
          event.nativeEvent.actionName === "increment"
            ? 1
            : event.nativeEvent.actionName === "decrement"
              ? -1
              : 0;
        if (!direction) return;
        adjust(direction);
      }}
      onLayout={(event) => {
        trackWidthRef.current = Math.max(1, event.nativeEvent.layout.width);
      }}
      style={[
        styles.sliderTouchTarget,
        secondary && styles.sliderTouchTargetSecondary,
        disabled && styles.controlDisabled,
      ]}
      {...webKeyboardProps}
      {...responder.panHandlers}
    >
      <View
        pointerEvents="none"
        style={[
          styles.sliderTrack,
          secondary && styles.sliderTrackSecondary,
          { backgroundColor: colors.border },
        ]}
      >
        <View
          style={[
            styles.sliderFill,
            secondary && styles.sliderFillSecondary,
            {
              backgroundColor: disabled ? colors.muted : GOAL_COMPLETE_COLOR,
              width: `${progress * 100}%`,
            },
          ]}
        />
        <View
          style={[
            styles.sliderThumb,
            secondary && styles.sliderThumbSecondary,
            {
              backgroundColor: colors.card,
              borderColor: disabled ? colors.muted : GOAL_COMPLETE_COLOR,
              left: `${progress * 100}%`,
            },
          ]}
        />
      </View>
    </View>
  );
}

function MetricToggle({
  enabled,
  label,
  onChange,
}: {
  enabled: boolean;
  label: string;
  onChange: (enabled: boolean) => void;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: enabled }}
      hitSlop={6}
      onPress={() => onChange(!enabled)}
      style={({ pressed }) => [
        styles.toggle,
        {
          backgroundColor: enabled ? GOAL_COMPLETE_COLOR : colors.border,
        },
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.toggleThumb,
          {
            backgroundColor: colors.card,
            transform: [{ translateX: enabled ? 14 : 0 }],
          },
        ]}
      />
    </Pressable>
  );
}

function SimulationMetricRow({
  enabled,
  formatter,
  last,
  label,
  onChange,
  onToggle,
  range,
  secondary = false,
  value,
}: {
  enabled: boolean;
  formatter: Intl.NumberFormat;
  last: boolean;
  label: string;
  onChange: (value: number) => void;
  onToggle: (enabled: boolean) => void;
  range: StatusAvatarSimulationRange;
  secondary?: boolean;
  value: number;
}) {
  const colors = useAppColors();
  const { t } = useLocalization();
  const displayValue = `${formatter.format(value)}${range.unit ? ` ${range.unit}` : ""}`;
  return (
    <View
      style={[
        styles.metricRow,
        secondary && styles.metricRowSecondary,
        !last && { borderBottomColor: colors.border },
        last && styles.metricRowLast,
      ]}
    >
      <View
        style={[styles.metricHeader, secondary && styles.metricHeaderSecondary]}
      >
        <Text
          translate={false}
          numberOfLines={1}
          style={[
            styles.metricLabel,
            secondary && styles.metricLabelSecondary,
            { color: secondary ? colors.muted : colors.ink },
          ]}
        >
          {t(label)}
        </Text>
        <View style={styles.metricHeaderValue}>
          <Text
            translate={false}
            numberOfLines={1}
            style={[
              styles.metricValue,
              secondary && styles.metricValueSecondary,
              { color: enabled ? colors.ink : colors.muted },
            ]}
          >
            {displayValue}
          </Text>
          <MetricToggle enabled={enabled} label={t(label)} onChange={onToggle} />
        </View>
      </View>
      <SimulationSlider
        accessibilityLabel={t(label)}
        disabled={!enabled}
        maximumValue={range.maximumValue}
        minimumValue={range.minimumValue}
        onChange={onChange}
        secondary={secondary}
        step={range.step}
        unit={range.unit}
        value={value}
      />
    </View>
  );
}

export function StatusAvatarSimulator({
  bodyFatPercent,
  calculationSource = "bmi",
  heightCm,
  leanBodyMassKg,
  mindTier = 0,
  muscleProgress = 0,
  onClose,
  progress,
  sex = "unspecified",
  visible,
  visualStyle = "silhouette",
  weightKg,
}: {
  bodyFatPercent?: number;
  calculationSource?: StatusAvatarCalculationSource;
  heightCm?: number;
  leanBodyMassKg?: number;
  mindTier?: 0 | 1 | 2 | 3;
  muscleProgress?: number;
  onClose: () => void;
  progress: number;
  sex?: BiologicalSex;
  visible: boolean;
  visualStyle?: StatusAvatarStyle;
  weightKg?: number;
}) {
  const colors = useAppColors();
  const { locale, t } = useLocalization();
  const { height: windowHeight } = useWindowDimensions();
  const [infoOpen, setInfoOpen] = useState(false);
  const avatarScale = windowHeight < 620 ? 0.5 : windowHeight < 720 ? 0.61 : 0.68;
  const baseline = useMemo(
    () =>
      statusAvatarSimulationBaseline({
        bodyFatPercent,
        heightCm,
        leanBodyMassKg,
        muscleProgress,
        sex,
        weightKg,
      }),
    [
      bodyFatPercent,
      heightCm,
      leanBodyMassKg,
      muscleProgress,
      sex,
      weightKg,
    ],
  );
  const [simulation, setSimulation] = useState(() =>
    statusAvatarSimulationInitialState(baseline, calculationSource),
  );
  const ranges = useMemo(
    () =>
      Object.fromEntries(
        STATUS_AVATAR_SIMULATION_METRICS.map(({ id }) => [
          id,
          statusAvatarSimulationRange(id, baseline),
        ]),
      ) as Record<StatusAvatarSimulationMetric, StatusAvatarSimulationRange>,
    [baseline],
  );
  const preview = useMemo(
    () => statusAvatarSimulationPreview(simulation, baseline),
    [baseline, simulation],
  );
  const formatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        maximumFractionDigits: 1,
        minimumFractionDigits: 1,
      }),
    [locale],
  );

  useEffect(() => {
    if (!visible) return;
    setSimulation(
      statusAvatarSimulationInitialState(baseline, calculationSource),
    );
    setInfoOpen(false);
  }, [baseline, calculationSource, visible]);

  const changeMetric = useCallback(
    (metric: StatusAvatarSimulationMetric, value: number) =>
      setSimulation((current) =>
        statusAvatarSimulationSetValue(current, metric, value, baseline),
      ),
    [baseline],
  );
  const toggleMetric = useCallback(
    (metric: StatusAvatarSimulationMetric, enabled: boolean) =>
      setSimulation((current) =>
        statusAvatarSimulationSetEnabled(current, metric, enabled),
      ),
    [],
  );

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel={t("Close")}
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <View style={styles.titleRow}>
                <Text style={[styles.title, { color: colors.ink }]}>
                  Avatar simulator
                </Text>
                <Pressable
                  accessibilityLabel={t("About this estimate")}
                  accessibilityRole="button"
                  hitSlop={7}
                  onPress={() => setInfoOpen((open) => !open)}
                  style={({ pressed }) => [
                    styles.infoButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    name="information-circle-outline"
                    size={18}
                    color={colors.muted}
                  />
                </Pressable>
              </View>
              <Text style={[styles.subtitle, { color: colors.muted }]}>
                Preview a change without saving it.
              </Text>
            </View>
            <Pressable
              accessibilityLabel={t("Close")}
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                { backgroundColor: colors.canvas },
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="close" size={20} color={colors.muted} />
            </Pressable>
          </View>

          <View style={styles.content}>
            {infoOpen ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setInfoOpen(false)}
                style={[
                  styles.infoNotice,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.primary,
                  },
                ]}
              >
                <Ionicons
                  name="information-circle"
                  size={16}
                  color={colors.primary}
                />
                <View style={styles.infoCopy}>
                  <Text style={[styles.infoText, { color: colors.ink }]}>
                    Estimate only. This is not a scan, scientific measurement, or prediction of your body.
                  </Text>
                  <Text style={[styles.infoDetail, { color: colors.muted }]}>
                    Weight and BMI are linked through this height; use either one for total size.
                  </Text>
                </View>
              </Pressable>
            ) : null}

            <View
              style={[
                styles.avatarPreview,
                { height: Math.round(302 * avatarScale) },
              ]}
            >
              <BodyProgressAvatar
                allowPartialComposition
                bodyFatPercent={preview.bodyFatPercent}
                calculationSource={preview.calculationSource}
                displayScale={avatarScale}
                heightCm={preview.heightCm}
                leanBodyMassKg={preview.leanBodyMassKg}
                mindTier={mindTier}
                muscleProgress={preview.muscleProgress}
                progress={progress}
                sex={preview.sex}
                visualStyle={visualStyle}
                weightKg={preview.weightKg}
              />
            </View>

            <Text
              numberOfLines={1}
              style={[styles.disclaimer, { color: colors.muted }]}
            >
              Estimate only. This is not a scan, scientific measurement, or prediction of your body.
            </Text>

            <View
              style={[
                styles.metricList,
                { backgroundColor: colors.canvas, borderColor: colors.border },
              ]}
            >
              <View
                accessibilityLabel={`${t("Weight")} ${t("BMI")}`}
                style={[
                  styles.linkedSizeGroup,
                  { borderBottomColor: colors.border },
                ]}
              >
                <SimulationMetricRow
                  enabled={preview.enabled.weight}
                  formatter={formatter}
                  last={false}
                  label="Weight"
                  onChange={(value) => changeMetric("weight", value)}
                  onToggle={(enabled) => toggleMetric("weight", enabled)}
                  range={ranges.weight}
                  value={preview.values.weight}
                />
                <SimulationMetricRow
                  enabled={preview.enabled.bmi}
                  formatter={formatter}
                  last
                  label="BMI"
                  onChange={(value) => changeMetric("bmi", value)}
                  onToggle={(enabled) => toggleMetric("bmi", enabled)}
                  range={ranges.bmi}
                  secondary
                  value={preview.values.bmi}
                />
              </View>
              {STATUS_AVATAR_SIMULATION_METRICS.slice(2).map((item, index) => (
                <SimulationMetricRow
                  key={item.id}
                  enabled={preview.enabled[item.id]}
                  formatter={formatter}
                  last={index === 1}
                  label={item.label}
                  onChange={(value) => changeMetric(item.id, value)}
                  onToggle={(enabled) => toggleMetric(item.id, enabled)}
                  range={ranges[item.id]}
                  value={preview.values[item.id]}
                />
              ))}
            </View>
          </View>

          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.doneButton,
                { backgroundColor: GOAL_COMPLETE_COLOR },
                pressed && styles.pressed,
              ]}
            >
              <Text preserveColor style={styles.doneText}>
                Done
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(4, 10, 28, 0.76)",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  sheet: {
    width: "100%",
    maxWidth: 400,
    maxHeight: "99%",
    borderWidth: 1,
    borderRadius: 24,
    overflow: "hidden",
  },
  header: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 7,
    paddingBottom: 5,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: "900" },
  infoButton: { width: 26, height: 26, alignItems: "center", justifyContent: "center" },
  subtitle: { marginTop: -1, fontSize: 9, lineHeight: 13, fontWeight: "700" },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    position: "relative",
    alignItems: "stretch",
    paddingHorizontal: 11,
    paddingBottom: 6,
  },
  infoNotice: {
    position: "absolute",
    zIndex: 5,
    top: 4,
    left: 18,
    right: 18,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  infoCopy: { flex: 1, gap: 3 },
  infoText: { flex: 1, fontSize: 9, lineHeight: 13, fontWeight: "700" },
  infoDetail: { fontSize: 8, lineHeight: 12, fontWeight: "700" },
  avatarPreview: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  disclaimer: {
    marginTop: 1,
    textAlign: "center",
    fontSize: 7,
    lineHeight: 10,
    fontWeight: "700",
  },
  metricList: {
    marginTop: 5,
    borderWidth: 1,
    borderRadius: 14,
    overflow: "hidden",
  },
  linkedSizeGroup: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metricRow: {
    minHeight: 49,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    paddingTop: 2,
    paddingBottom: 1,
  },
  metricRowSecondary: {
    minHeight: 42,
    paddingLeft: 20,
    paddingTop: 0,
  },
  metricRowLast: { borderBottomWidth: 0 },
  metricHeader: {
    minHeight: 21,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  metricHeaderSecondary: { minHeight: 17 },
  metricLabel: { flex: 1, minWidth: 0, fontSize: 10, lineHeight: 14, fontWeight: "900" },
  metricLabelSecondary: { fontSize: 8, lineHeight: 11, fontWeight: "800" },
  metricHeaderValue: { flexDirection: "row", alignItems: "center", gap: 7 },
  metricValue: {
    minWidth: 56,
    textAlign: "right",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  metricValueSecondary: { fontSize: 9, lineHeight: 12 },
  toggle: {
    width: 34,
    height: 20,
    borderRadius: 10,
    padding: 2,
    justifyContent: "center",
  },
  toggleThumb: { width: 16, height: 16, borderRadius: 8 },
  sliderTouchTarget: { height: 27, justifyContent: "center" },
  sliderTouchTargetSecondary: { height: 24 },
  sliderTrack: { height: 6, borderRadius: 3 },
  sliderTrackSecondary: { height: 4, borderRadius: 2 },
  sliderFill: { height: 6, borderRadius: 3 },
  sliderFillSecondary: { height: 4, borderRadius: 2 },
  sliderThumb: {
    position: "absolute",
    top: -6,
    width: 18,
    height: 18,
    marginLeft: -9,
    borderRadius: 9,
    borderWidth: 2,
  },
  sliderThumbSecondary: {
    top: -5,
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
  },
  controlDisabled: { opacity: 0.48 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  doneButton: {
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  doneText: { color: palette.ink, fontSize: 11, lineHeight: 15, fontWeight: "900" },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
});
