import { Ionicons } from "@expo/vector-icons";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { BodyProgressAvatar } from "@/src/components/BodyProgressAvatar";
import { GOAL_COMPLETE_COLOR } from "@/src/domain/colors";
import {
  STATUS_AVATAR_SIMULATION_METRICS,
  statusAvatarSimulationBaseline,
  statusAvatarSimulationPreview,
  statusAvatarSimulationRange,
  type StatusAvatarSimulationMetric,
} from "@/src/domain/statusAvatarSimulation";
import { useLocalization } from "@/src/i18n";
import { palette, useAppColors } from "@/src/theme";
import type { BiologicalSex, StatusAvatarStyle } from "@/src/types";

function SimulationSlider({
  accessibilityLabel,
  maximumValue,
  minimumValue,
  onChange,
  step,
  unit,
  value,
}: {
  accessibilityLabel: string;
  maximumValue: number;
  minimumValue: number;
  onChange: (value: number) => void;
  step: number;
  unit: string;
  value: number;
}) {
  const colors = useAppColors();
  const [trackWidth, setTrackWidth] = useState(1);
  const span = Math.max(step, maximumValue - minimumValue);
  const progress = Math.max(
    0,
    Math.min(1, (value - minimumValue) / span),
  );
  const updateFromX = useCallback(
    (x: number) => {
      const fraction = Math.max(0, Math.min(1, x / trackWidth));
      const raw = minimumValue + fraction * (maximumValue - minimumValue);
      const stepped = Math.round(raw / step) * step;
      onChange(Math.max(minimumValue, Math.min(maximumValue, stepped)));
    },
    [maximumValue, minimumValue, onChange, step, trackWidth],
  );
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) =>
          updateFromX(event.nativeEvent.locationX),
        onPanResponderMove: (event) =>
          updateFromX(event.nativeEvent.locationX),
        onPanResponderTerminationRequest: () => false,
      }),
    [updateFromX],
  );
  const accessibilityStep = Math.max(
    step,
    Math.round((span / 20) / step) * step,
  );
  const accessibleValue = `${value.toFixed(step < 1 ? 1 : 0)}${unit ? ` ${unit}` : ""}`;
  const adjust = useCallback(
    (direction: -1 | 1) =>
      onChange(
        Math.max(
          minimumValue,
          Math.min(maximumValue, value + direction * accessibilityStep),
        ),
      ),
    [
      accessibilityStep,
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
            if (!direction) return;
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
      accessibilityValue={{
        max: maximumValue,
        min: minimumValue,
        now: value,
        text: accessibleValue,
      }}
      focusable
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
      onLayout={(event) =>
        setTrackWidth(Math.max(1, event.nativeEvent.layout.width))
      }
      style={styles.sliderTouchTarget}
      {...webKeyboardProps}
      {...responder.panHandlers}
    >
      <View style={[styles.sliderTrack, { backgroundColor: colors.border }]}>
        <View
          style={[
            styles.sliderFill,
            { backgroundColor: GOAL_COMPLETE_COLOR, width: `${progress * 100}%` },
          ]}
        />
        <View
          style={[
            styles.sliderThumb,
            {
              backgroundColor: colors.card,
              borderColor: GOAL_COMPLETE_COLOR,
              left: `${progress * 100}%`,
            },
          ]}
        />
      </View>
    </View>
  );
}

export function StatusAvatarSimulator({
  bodyFatPercent,
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
  const [metric, setMetric] =
    useState<StatusAvatarSimulationMetric>("weight");
  const [value, setValue] = useState(baseline.weightKg);
  const [selectorMenuOpen, setSelectorMenuOpen] = useState(false);
  const range = useMemo(
    () => statusAvatarSimulationRange(metric, baseline),
    [baseline, metric],
  );
  const preview = useMemo(
    () => statusAvatarSimulationPreview(metric, value, baseline),
    [baseline, metric, value],
  );
  const selectedDefinition =
    STATUS_AVATAR_SIMULATION_METRICS.find((item) => item.id === metric) ??
    STATUS_AVATAR_SIMULATION_METRICS[0];
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
    const nextRange = statusAvatarSimulationRange("weight", baseline);
    setMetric("weight");
    setValue(nextRange.initialValue);
    setSelectorMenuOpen(false);
  }, [baseline, visible]);

  const chooseMetric = useCallback(
    (nextMetric: StatusAvatarSimulationMetric) => {
      const nextRange = statusAvatarSimulationRange(nextMetric, baseline);
      setMetric(nextMetric);
      setValue(nextRange.initialValue);
      setSelectorMenuOpen(false);
    },
    [baseline],
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
              <Text style={[styles.title, { color: colors.ink }]}>
                Avatar simulator
              </Text>
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

          <ScrollView
            bounces={false}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.scroll}
          >
            <View style={styles.avatarPreview}>
              <BodyProgressAvatar
                bodyFatPercent={preview.bodyFatPercent}
                calculationSource={preview.calculationSource}
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

            <View style={styles.selectorSection}>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>
                Choose what to change
              </Text>
              <Pressable
                accessibilityHint={
                  selectorMenuOpen ? t("Close menu") : t("Open selection")
                }
                accessibilityRole="button"
                accessibilityState={{ expanded: selectorMenuOpen }}
                onPress={() => setSelectorMenuOpen((open) => !open)}
                style={({ pressed }) => [
                  styles.selectorButton,
                  { backgroundColor: colors.canvas, borderColor: colors.border },
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  translate={false}
                  style={[styles.selectorText, { color: colors.ink }]}
                >
                  {t(selectedDefinition.label)}
                </Text>
                <Ionicons
                  name={selectorMenuOpen ? "chevron-up" : "chevron-down"}
                  size={17}
                  color={colors.muted}
                />
              </Pressable>
              {selectorMenuOpen ? (
                <View
                  accessibilityRole="radiogroup"
                  style={[
                    styles.selectorMenu,
                    { backgroundColor: colors.canvas, borderColor: colors.border },
                  ]}
                >
                  {STATUS_AVATAR_SIMULATION_METRICS.map((item) => {
                    const selected = item.id === metric;
                    return (
                      <Pressable
                        key={item.id}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        onPress={() => chooseMetric(item.id)}
                        style={({ pressed }) => [
                          styles.selectorOption,
                          selected && { backgroundColor: colors.primarySoft },
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text
                          translate={false}
                          style={[
                            styles.selectorOptionText,
                            { color: colors.ink },
                          ]}
                        >
                          {t(item.label)}
                        </Text>
                        <Ionicons
                          name={
                            selected
                              ? "radio-button-on"
                              : "radio-button-off"
                          }
                          size={18}
                          color={
                            selected ? GOAL_COMPLETE_COLOR : colors.muted
                          }
                        />
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>

            <View style={styles.valueBlock}>
              <Text
                translate={false}
                style={[styles.value, { color: colors.ink }]}
              >
                {formatter.format(preview.value)}
                {range.unit ? ` ${range.unit}` : ""}
              </Text>
              <SimulationSlider
                accessibilityLabel={t(selectedDefinition.label)}
                maximumValue={range.maximumValue}
                minimumValue={range.minimumValue}
                onChange={setValue}
                step={range.step}
                unit={range.unit}
                value={preview.value}
              />
              <View style={styles.rangeLabels}>
                <Text
                  translate={false}
                  style={[styles.rangeLabel, { color: colors.muted }]}
                >
                  {formatter.format(range.minimumValue)}
                </Text>
                <Text
                  translate={false}
                  style={[styles.rangeLabel, { color: colors.muted }]}
                >
                  {formatter.format(range.maximumValue)}
                </Text>
              </View>
            </View>

          </ScrollView>

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
    paddingHorizontal: 12,
    paddingVertical: 18,
  },
  sheet: {
    width: "100%",
    maxWidth: 380,
    maxHeight: "96%",
    borderWidth: 1,
    borderRadius: 24,
    overflow: "hidden",
  },
  header: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 15,
    paddingTop: 13,
    paddingBottom: 9,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: "900" },
  subtitle: { marginTop: 2, fontSize: 9, lineHeight: 13, fontWeight: "700" },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    alignItems: "stretch",
    paddingHorizontal: 15,
    paddingBottom: 12,
  },
  scroll: { flexShrink: 1 },
  avatarPreview: {
    height: 270,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  selectorSection: { zIndex: 2 },
  fieldLabel: {
    marginBottom: 6,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  selectorButton: {
    minHeight: 43,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 12,
  },
  selectorText: { fontSize: 12, lineHeight: 16, fontWeight: "900" },
  selectorMenu: {
    marginTop: 6,
    borderWidth: 1,
    borderRadius: 14,
    overflow: "hidden",
  },
  selectorOption: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  selectorOptionText: { fontSize: 11, lineHeight: 15, fontWeight: "800" },
  valueBlock: { alignItems: "stretch", paddingTop: 12 },
  value: {
    alignSelf: "center",
    fontSize: 24,
    lineHeight: 29,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  sliderTouchTarget: {
    height: 48,
    justifyContent: "center",
    marginTop: 2,
  },
  sliderTrack: { height: 8, borderRadius: 4 },
  sliderFill: { height: 8, borderRadius: 4 },
  sliderThumb: {
    position: "absolute",
    top: -8,
    width: 24,
    height: 24,
    marginLeft: -12,
    borderRadius: 12,
    borderWidth: 4,
  },
  rangeLabels: {
    marginTop: -5,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rangeLabel: { fontSize: 8, lineHeight: 11, fontWeight: "800" },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  doneButton: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  doneText: {
    color: palette.ink,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
  },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
});
