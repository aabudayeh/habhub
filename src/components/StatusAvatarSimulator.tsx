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
  statusAvatarSimulationMarkers,
  statusAvatarSimulationPreview,
  statusAvatarSimulationRange,
  statusAvatarSimulationSetEnabled,
  statusAvatarSimulationSetValue,
  type StatusAvatarSimulationMetric,
  type StatusAvatarSimulationMarker,
  type StatusAvatarSimulationRange,
} from "@/src/domain/statusAvatarSimulation";
import { useLocalization } from "@/src/i18n";
import { palette, useAppColors } from "@/src/theme";
import type {
  BiologicalSex,
  StatusAvatarCalculationSource,
  StatusAvatarStyle,
} from "@/src/types";

type SimulationMarkerKind = "current" | "recommended";

type SimulatorNotice =
  | { kind: "about" }
  | {
      kind: "marker";
      markerKind: SimulationMarkerKind;
      metricLabel: string;
      unit: string;
      value: number;
    };

function SimulationSlider({
  accessibilityLabel,
  currentValue,
  disabled,
  maximumValue,
  minimumValue,
  onChange,
  onMarkerPress,
  recommendedValue,
  secondary = false,
  step,
  unit,
  value,
}: {
  accessibilityLabel: string;
  currentValue?: number;
  disabled: boolean;
  maximumValue: number;
  minimumValue: number;
  onChange: (value: number) => void;
  onMarkerPress: (kind: SimulationMarkerKind, value: number) => void;
  recommendedValue?: number;
  secondary?: boolean;
  step: number;
  unit: string;
  value: number;
}) {
  const colors = useAppColors();
  const { locale, t } = useLocalization();
  const trackWidthRef = useRef(1);
  const dragStartXRef = useRef(0);
  const markerTapCandidateRef = useRef<SimulationMarkerKind | undefined>(
    undefined,
  );
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
  const markerProgress = (markerValue: number | undefined) =>
    markerValue === undefined
      ? undefined
      : Math.max(
          0.015,
          Math.min(0.985, (markerValue - minimumValue) / span),
        );
  const currentProgress = markerProgress(currentValue);
  const recommendedProgress = markerProgress(recommendedValue);
  const markersOverlap =
    currentProgress !== undefined &&
    recommendedProgress !== undefined &&
    Math.abs(currentProgress - recommendedProgress) < 0.035;
  progressRef.current = progress;
  const markerInteractionRef = useRef({
    currentProgress,
    currentValue,
    onMarkerPress,
    recommendedProgress,
    recommendedValue,
  });
  markerInteractionRef.current = {
    currentProgress,
    currentValue,
    onMarkerPress,
    recommendedProgress,
    recommendedValue,
  };
  const markerAtPointRef = useRef<
    (x: number, y: number) => SimulationMarkerKind | undefined
  >(() => undefined);
  markerAtPointRef.current = (x, y) => {
    const width = Math.max(1, trackWidthRef.current);
    const markerInteraction = markerInteractionRef.current;
    const candidates = [
      markerInteraction.currentProgress === undefined
        ? undefined
        : {
            distance: Math.abs(
              x - markerInteraction.currentProgress * width,
            ),
            kind: "current" as const,
          },
      markerInteraction.recommendedProgress === undefined
        ? undefined
        : {
            distance: Math.abs(
              x - markerInteraction.recommendedProgress * width,
            ),
            kind: "recommended" as const,
          },
    ].filter(
      (
        candidate,
      ): candidate is { distance: number; kind: SimulationMarkerKind } =>
        candidate !== undefined && candidate.distance <= 14,
    )
      .sort((left, right) => left.distance - right.distance);
    if (candidates.length < 2) return candidates[0]?.kind;
    // C is drawn above the track and R below it. When their x positions are
    // close, the vertical half of the touch target keeps both individually
    // selectable without installing a child responder over the drag surface.
    return y <= 13.5 ? "current" : "recommended";
  };
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
      onStartShouldSetPanResponder: (event) => {
        if (!configurationRef.current.disabled) return true;
        return Boolean(
          markerAtPointRef.current(
            Number(event.nativeEvent.locationX),
            Number(event.nativeEvent.locationY),
          ),
        );
      },
      onStartShouldSetPanResponderCapture: (event) => {
        if (!configurationRef.current.disabled) return true;
        return Boolean(
          markerAtPointRef.current(
            Number(event.nativeEvent.locationX),
            Number(event.nativeEvent.locationY),
          ),
        );
      },
      onMoveShouldSetPanResponder: () => !configurationRef.current.disabled,
      onMoveShouldSetPanResponderCapture: () =>
        !configurationRef.current.disabled,
      onPanResponderGrant: (event) => {
        const locationX = Number(event.nativeEvent.locationX);
        const locationY = Number(event.nativeEvent.locationY);
        dragStartXRef.current = Number.isFinite(locationX)
          ? locationX
          : trackWidthRef.current * progressRef.current;
        markerTapCandidateRef.current = markerAtPointRef.current(
          dragStartXRef.current,
          Number.isFinite(locationY) ? locationY : 13.5,
        );
        if (markerTapCandidateRef.current) return;
        updateFromXRef.current(dragStartXRef.current);
      },
      onPanResponderMove: (_, gestureState) => {
        if (
          markerTapCandidateRef.current &&
          Math.max(Math.abs(gestureState.dx), Math.abs(gestureState.dy)) <= 4
        )
          return;
        markerTapCandidateRef.current = undefined;
        updateFromXRef.current(dragStartXRef.current + gestureState.dx);
      },
      onPanResponderRelease: (_, gestureState) => {
        const candidate = markerTapCandidateRef.current;
        markerTapCandidateRef.current = undefined;
        if (
          !candidate ||
          Math.max(Math.abs(gestureState.dx), Math.abs(gestureState.dy)) > 6
        )
          return;
        const markerInteraction = markerInteractionRef.current;
        const markerValue =
          candidate === "current"
            ? markerInteraction.currentValue
            : markerInteraction.recommendedValue;
        if (markerValue !== undefined)
          markerInteraction.onMarkerPress(candidate, markerValue);
      },
      onPanResponderTerminate: () => {
        markerTapCandidateRef.current = undefined;
      },
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
  const markerFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        maximumFractionDigits: step < 1 ? 1 : 0,
        minimumFractionDigits: step < 1 ? 1 : 0,
      }),
    [locale, step],
  );
  const formatMarkerValue = (markerValue: number) =>
    `${markerFormatter.format(markerValue)}${unit ? ` ${unit}` : ""}`;
  const markerHint = [
    currentValue === undefined
      ? undefined
      : `${t("C marks the current logged value")}: ${formatMarkerValue(currentValue)}`,
    recommendedValue === undefined
      ? undefined
      : `${t("R marks an adult reference, not a medical target")}: ${formatMarkerValue(recommendedValue)}`,
  ]
    .filter(Boolean)
    .join(". ");
  const accessibilityActions = [
    ...(disabled
      ? []
      : [
          { name: "increment" as const },
          { name: "decrement" as const },
        ]),
    ...(currentValue === undefined
      ? []
      : [
          {
            label: t("C marks the current logged value"),
            name: "show-current-marker",
          },
        ]),
    ...(recommendedValue === undefined
      ? []
      : [
          {
            label: t("R marks an adult reference, not a medical target"),
            name: "show-recommended-marker",
          },
        ]),
  ];
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
      accessibilityActions={accessibilityActions}
      accessibilityHint={markerHint || undefined}
      accessibilityLabel={
        markerHint ? `${accessibilityLabel}. ${markerHint}` : accessibilityLabel
      }
      accessibilityRole={disabled ? "button" : "adjustable"}
      accessibilityState={{
        disabled:
          disabled && currentValue === undefined && recommendedValue === undefined,
      }}
      accessibilityValue={
        disabled
          ? undefined
          : {
              max: maximumValue,
              min: minimumValue,
              now: value,
              text: accessibleValue,
            }
      }
      focusable={
        !disabled || currentValue !== undefined || recommendedValue !== undefined
      }
      onAccessibilityAction={(event) => {
        if (
          event.nativeEvent.actionName === "show-current-marker" &&
          currentValue !== undefined
        ) {
          onMarkerPress("current", currentValue);
          return;
        }
        if (
          event.nativeEvent.actionName === "show-recommended-marker" &&
          recommendedValue !== undefined
        ) {
          onMarkerPress("recommended", recommendedValue);
          return;
        }
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
        {currentProgress !== undefined ? (
          <View
            pointerEvents="none"
            style={[
              styles.sliderMarkerAnchor,
              {
                left: `${currentProgress * 100}%`,
                transform: [{ translateX: markersOverlap ? -2 : 0 }],
              },
            ]}
          >
            <View
              style={[
                styles.sliderMarkerTick,
                { backgroundColor: colors.muted },
              ]}
            />
            <Text
              accessible={false}
              preserveColor
              style={[styles.sliderMarkerCodeCurrent, { color: colors.muted }]}
              translate={false}
            >
              C
            </Text>
          </View>
        ) : null}
        {recommendedProgress !== undefined ? (
          <View
            pointerEvents="none"
            style={[
              styles.sliderMarkerAnchor,
              {
                left: `${recommendedProgress * 100}%`,
                transform: [{ translateX: markersOverlap ? 2 : 0 }],
              },
            ]}
          >
            <View
              style={[
                styles.sliderMarkerTickRecommended,
                { backgroundColor: colors.primary },
              ]}
            />
            <Text
              accessible={false}
              preserveColor
              style={[
                styles.sliderMarkerCodeRecommended,
                { color: colors.primary },
              ]}
              translate={false}
            >
              R
            </Text>
          </View>
        ) : null}
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
  marker,
  onChange,
  onMarkerPress,
  onToggle,
  range,
  secondary = false,
  toggleable = true,
  value,
}: {
  enabled: boolean;
  formatter: Intl.NumberFormat;
  last: boolean;
  label: string;
  marker: StatusAvatarSimulationMarker;
  onChange: (value: number) => void;
  onMarkerPress: (kind: SimulationMarkerKind, value: number) => void;
  onToggle: (enabled: boolean) => void;
  range: StatusAvatarSimulationRange;
  secondary?: boolean;
  toggleable?: boolean;
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
          {toggleable ? (
            <MetricToggle
              enabled={enabled}
              label={t(label)}
              onChange={onToggle}
            />
          ) : null}
        </View>
      </View>
      <SimulationSlider
        accessibilityLabel={t(label)}
        currentValue={marker.currentValue}
        disabled={!enabled}
        maximumValue={range.maximumValue}
        minimumValue={range.minimumValue}
        onChange={onChange}
        onMarkerPress={onMarkerPress}
        recommendedValue={marker.recommendedValue}
        secondary={secondary}
        step={range.step}
        unit={range.unit}
        value={value}
      />
    </View>
  );
}

export function StatusAvatarSimulator({
  age,
  bodyFatPercent,
  calculationSource = "bmi",
  heightCm,
  leanBodyMassKg,
  muscleProgress = 0,
  onClose,
  progress,
  sex = "unspecified",
  visible,
  visualStyle = "silhouette",
  weightKg,
}: {
  age?: number;
  bodyFatPercent?: number;
  calculationSource?: StatusAvatarCalculationSource;
  heightCm?: number;
  leanBodyMassKg?: number;
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
  const [notice, setNotice] = useState<SimulatorNotice | null>(null);
  const avatarScale = windowHeight < 620 ? 0.64 : windowHeight < 720 ? 0.72 : 0.8;
  const baseline = useMemo(
    () =>
      statusAvatarSimulationBaseline({
        age,
        bodyFatPercent,
        heightCm,
        leanBodyMassKg,
        muscleProgress,
        sex,
        weightKg,
      }),
    [
      age,
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
  const markers = useMemo(
    () => statusAvatarSimulationMarkers(baseline),
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
    setNotice(null);
  }, [baseline, calculationSource, visible]);

  const changeMetric = useCallback(
    (metric: StatusAvatarSimulationMetric, value: number) => {
      setNotice(null);
      setSimulation((current) =>
        statusAvatarSimulationSetValue(current, metric, value, baseline),
      );
    },
    [baseline],
  );
  const toggleMetric = useCallback(
    (metric: StatusAvatarSimulationMetric, enabled: boolean) =>
      setSimulation((current) =>
        statusAvatarSimulationSetEnabled(current, metric, enabled),
      ),
    [],
  );
  const showMarkerNotice = useCallback(
    (
      metricLabel: string,
      unit: string,
      markerKind: SimulationMarkerKind,
      value: number,
    ) =>
      setNotice({
        kind: "marker",
        markerKind,
        metricLabel,
        unit,
        value,
      }),
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
                  onPress={() =>
                    setNotice((current) =>
                      current?.kind === "about" ? null : { kind: "about" },
                    )
                  }
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
            {notice ? (
              <Pressable
                accessibilityLabel={
                  notice.kind === "marker"
                    ? `${notice.markerKind === "current" ? "C" : "R"}. ${t(notice.metricLabel)}. ${formatter.format(notice.value)}${notice.unit ? ` ${notice.unit}` : ""}`
                    : t("About this estimate")
                }
                accessibilityRole="button"
                onPress={() => setNotice(null)}
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
                  {notice.kind === "marker" ? (
                    <>
                      <Text
                        translate={false}
                        style={[styles.infoText, { color: colors.ink }]}
                      >
                        {notice.markerKind === "current" ? "C" : "R"} · {t(notice.metricLabel)} · {formatter.format(notice.value)}{notice.unit ? ` ${notice.unit}` : ""}
                      </Text>
                      <Text
                        style={[styles.infoDetail, { color: colors.muted }]}
                      >
                        {notice.markerKind === "current"
                          ? "C marks the current logged value"
                          : "R marks an adult reference, not a medical target"}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={[styles.infoText, { color: colors.ink }]}>
                        Estimate only. This is not a scan, scientific measurement, or prediction of your body.
                      </Text>
                      <Text style={[styles.infoDetail, { color: colors.muted }]}>
                        Weight uses your profile height for total size. Body fat and lean mass can be adjusted or disabled independently.
                      </Text>
                      <Text style={[styles.infoDetail, { color: colors.muted }]}>
                        C = logged. R is a general adult reference based on available profile details; missing details use adult defaults. It is not a medical target.
                      </Text>
                    </>
                  )}
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
                muscleProgress={preview.muscleProgress}
                progress={progress}
                showProgressLabel={false}
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
              <SimulationMetricRow
                enabled
                formatter={formatter}
                last={false}
                label="Weight"
                marker={markers.weight}
                onChange={(value) => changeMetric("weight", value)}
                onMarkerPress={(kind, value) =>
                  showMarkerNotice("Weight", ranges.weight.unit, kind, value)
                }
                onToggle={() => undefined}
                range={ranges.weight}
                toggleable={false}
                value={preview.values.weight}
              />
              {STATUS_AVATAR_SIMULATION_METRICS.slice(2).map((item, index) => (
                <SimulationMetricRow
                  key={item.id}
                  enabled={preview.enabled[item.id]}
                  formatter={formatter}
                  last={index === 1}
                  label={item.label}
                  marker={markers[item.id]}
                  onChange={(value) => changeMetric(item.id, value)}
                  onMarkerPress={(kind, value) =>
                    showMarkerNotice(
                      item.label,
                      ranges[item.id].unit,
                      kind,
                      value,
                    )
                  }
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
  sliderMarkerAnchor: {
    position: "absolute",
    zIndex: 2,
    top: 0,
    width: 1,
    height: 6,
    alignItems: "center",
  },
  sliderMarkerTick: {
    position: "absolute",
    top: -3,
    width: 1,
    height: 12,
    borderRadius: 1,
  },
  sliderMarkerTickRecommended: {
    position: "absolute",
    top: -4,
    width: 2,
    height: 14,
    borderRadius: 1,
  },
  sliderMarkerCodeCurrent: {
    position: "absolute",
    top: -10,
    width: 10,
    textAlign: "center",
    fontSize: 6,
    lineHeight: 7,
    fontWeight: "900",
  },
  sliderMarkerCodeRecommended: {
    position: "absolute",
    top: 8,
    width: 10,
    textAlign: "center",
    fontSize: 6,
    lineHeight: 7,
    fontWeight: "900",
  },
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
