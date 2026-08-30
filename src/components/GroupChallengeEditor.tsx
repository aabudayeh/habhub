import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import React, { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "@/src/components/AppText";
import {
  CHALLENGE_VISUAL_ICONS,
  ChallengeVisual,
} from "@/src/components/ChallengeVisual";
import { SelectionMenu } from "@/src/components/SelectionMenu";
import { Avatar } from "@/src/components/ui";
import { SaveGroupChallengeInput } from "@/src/cloud/groupChallenges";
import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import {
  type ChallengeDurationPreset,
  challengePresetEndDate,
  groupChallengeEndDate,
  isChallengeMetric,
  isPublicChallengeMetric,
  validChallengeDate,
  validateGroupChallenge,
} from "@/src/domain/groupChallenges";
import { useTranslation } from "@/src/i18n";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import {
  type ChallengeVisualIcon,
  GoalSchedule,
  Group,
  GroupChallenge,
  MetricDefinition,
} from "@/src/types";

type ChallengeRepeatMode =
  | "once"
  | "daily"
  | "selected_days"
  | "every_other_day"
  | "interval_days"
  | "days_of_month";

const CHALLENGE_REPEAT_OPTIONS: {
  id: ChallengeRepeatMode;
  label: string;
  sublabel: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    id: "once",
    label: "Once",
    sublabel: "Only on the selected date",
    icon: "calendar-outline",
  },
  {
    id: "daily",
    label: "Every day",
    sublabel: "Repeats daily",
    icon: "today-outline",
  },
  {
    id: "selected_days",
    label: "Selected weekdays",
    sublabel: "Choose one or several weekdays",
    icon: "calendar-number-outline",
  },
  {
    id: "every_other_day",
    label: "Every other day",
    sublabel: "Repeats from the selected date",
    icon: "swap-horizontal-outline",
  },
  {
    id: "interval_days",
    label: "Custom interval",
    sublabel: "Repeat every chosen number of days",
    icon: "repeat-outline",
  },
  {
    id: "days_of_month",
    label: "Dates each month",
    sublabel: "For example, the 1st and 15th",
    icon: "calendar-clear-outline",
  },
];

const CHALLENGE_DURATION_OPTIONS: {
  id: ChallengeDurationPreset;
  label: string;
  sublabel: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    id: "day",
    label: "One day",
    sublabel: "Score only the selected day",
    icon: "today-outline",
  },
  {
    id: "week",
    label: "One week",
    sublabel: "Seven days including the start date",
    icon: "calendar-outline",
  },
  {
    id: "month",
    label: "One month",
    sublabel: "One calendar month including the start date",
    icon: "calendar-number-outline",
  },
  {
    id: "year",
    label: "One year",
    sublabel: "One calendar year including the start date",
    icon: "calendar-clear-outline",
  },
  {
    id: "custom",
    label: "Custom dates",
    sublabel: "Choose an exact start and end date",
    icon: "options-outline",
  },
];

function challengeDurationPreset(challenge: GroupChallenge | undefined) {
  if (!challenge) return "day" as ChallengeDurationPreset;
  const endDate = groupChallengeEndDate(challenge);
  for (const preset of ["day", "week", "month", "year"] as const)
    if (challengePresetEndDate(challenge.localDate, preset) === endDate)
      return preset;
  return "custom" as ChallengeDurationPreset;
}

function challengeRepeatMode(
  recurrence: GoalSchedule | undefined,
): ChallengeRepeatMode {
  if (recurrence?.mode === "daily") return "daily";
  if (recurrence?.mode === "selected_days") return "selected_days";
  if (recurrence?.mode === "every_other_day") return "every_other_day";
  if (recurrence?.mode === "interval_days") return "interval_days";
  if (recurrence?.mode === "days_of_month") return "days_of_month";
  return "once";
}

function recurringScheduleKey(recurrence: GoalSchedule | undefined) {
  if (!recurrence || recurrence.mode === "once") return "";
  return JSON.stringify({
    mode: recurrence.mode,
    anchorDate: recurrence.anchorDate,
    daysOfWeek: [...(recurrence.daysOfWeek ?? [])].sort((a, b) => a - b),
    intervalDays: recurrence.intervalDays,
    daysOfMonth: [...(recurrence.daysOfMonth ?? [])].sort((a, b) => a - b),
  });
}

export function GroupChallengeEditor({
  visible,
  group,
  metrics,
  currentUserId,
  initialDate,
  initialParticipantIds,
  challenge,
  onClose,
  onSave,
}: {
  visible: boolean;
  group: Group;
  metrics: MetricDefinition[];
  currentUserId: string;
  initialDate?: string;
  initialParticipantIds?: string[];
  challenge?: GroupChallenge;
  onClose: () => void;
  onSave: (input: SaveGroupChallengeInput) => Promise<void>;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const t = useTranslation();
  const [audience, setAudience] = useState<"group" | "public">("group");
  const eligibleMetrics = useMemo(
    () =>
      metrics.filter(
        audience === "public"
          ? isPublicChallengeMetric
          : isChallengeMetric,
      ),
    [audience, metrics],
  );
  const metricOptions = useMemo(
    () =>
      eligibleMetrics.map((metric) => ({
        id: metric.id,
        label: metric.name,
        sublabel: metric.unit || "Shared tracker",
        group: "Trackers",
        icon: metric.icon as keyof typeof Ionicons.glyphMap,
        color: metric.color,
      })),
    [eligibleMetrics],
  );
  const [metricId, setMetricId] = useState(eligibleMetrics[0]?.id ?? "");
  const [target, setTarget] = useState("");
  const [targetEnabled, setTargetEnabled] = useState(true);
  const [title, setTitle] = useState("");
  const [visualOpen, setVisualOpen] = useState(false);
  const [visualIcon, setVisualIcon] = useState<ChallengeVisualIcon>();
  const [visualImagePreviewUri, setVisualImagePreviewUri] = useState<string>();
  const [visualImageStoragePath, setVisualImageStoragePath] = useState<
    string | null
  >();
  const [visualImageUploadUri, setVisualImageUploadUri] = useState<string>();
  const [limitEnabled, setLimitEnabled] = useState(false);
  const [participantLimit, setParticipantLimit] = useState("");
  const [localDate, setLocalDate] = useState(initialDate ?? dateKey());
  const [endDate, setEndDate] = useState(initialDate ?? dateKey());
  const [durationPreset, setDurationPreset] =
    useState<ChallengeDurationPreset>("day");
  const [repeatMode, setRepeatMode] =
    useState<ChallengeRepeatMode>("once");
  const [repeatUntil, setRepeatUntil] = useState(
    dateWithOffsetFrom(initialDate ?? dateKey(), 28),
  );
  const [repeatDays, setRepeatDays] = useState<number[]>([]);
  const [repeatInterval, setRepeatInterval] = useState("3");
  const [repeatMonthDays, setRepeatMonthDays] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const recurringHistoryBoundary = dateWithOffsetFrom(dateKey(), -1);
  const historicalRecurringRulesLocked = Boolean(
    challenge?.recurrence &&
      (challenge.recurrence.anchorDate ?? challenge.localDate) <
        recurringHistoryBoundary,
  );

  useEffect(() => {
    if (!visible) return;
    const metric =
      eligibleMetrics.find((item) => item.id === challenge?.metricId) ??
      eligibleMetrics[0];
    setMetricId(metric?.id ?? "");
    setTarget(
      challenge?.target !== undefined
        ? String(challenge.target)
        : metric?.goal.target
          ? String(metric.goal.target)
          : "",
    );
    setTargetEnabled(!challenge || challenge.target !== undefined);
    setTitle(challenge?.title ?? "");
    setVisualOpen(false);
    setVisualIcon(challenge?.visualIcon);
    setVisualImagePreviewUri(challenge?.visualImageUri);
    setVisualImageStoragePath(challenge?.visualImageStoragePath);
    setVisualImageUploadUri(undefined);
    setAudience(challenge?.audience ?? "group");
    setLimitEnabled(challenge?.participantLimit !== undefined);
    setParticipantLimit(
      challenge?.participantLimit !== undefined
        ? String(challenge.participantLimit)
        : "",
    );
    const nextLocalDate =
      challenge?.recurrence?.anchorDate ??
      challenge?.localDate ??
      initialDate ??
      dateKey();
    setLocalDate(nextLocalDate);
    setEndDate(challenge ? groupChallengeEndDate(challenge) : nextLocalDate);
    setDurationPreset(challengeDurationPreset(challenge));
    setRepeatMode(challengeRepeatMode(challenge?.recurrence));
    setRepeatUntil(
      challenge?.recurrence?.endDate ??
        dateWithOffsetFrom(challenge?.localDate ?? initialDate ?? dateKey(), 28),
    );
    const challengeDate = challenge?.localDate ?? initialDate ?? dateKey();
    const anchor = new Date(`${challengeDate}T12:00:00`);
    setRepeatDays(challenge?.recurrence?.daysOfWeek ?? [anchor.getDay()]);
    setRepeatInterval(String(challenge?.recurrence?.intervalDays ?? 3));
    setRepeatMonthDays(
      (challenge?.recurrence?.daysOfMonth ?? [anchor.getDate()]).join(", "),
    );
    setParticipants(
      challenge?.participantIds ??
        initialParticipantIds ??
        group.members.map((member) => member.id),
    );
    setError(undefined);
    setSaving(false);
  }, [
    challenge,
    eligibleMetrics,
    group.members,
    initialDate,
    initialParticipantIds,
    visible,
  ]);

  const selectedMetric = eligibleMetrics.find((metric) => metric.id === metricId);
  const challengeCreatorId = challenge?.creatorId ?? currentUserId;
  const allSelected = group.members.every((member) =>
    participants.includes(member.id),
  );

  function toggleParticipant(id: string) {
    if (id === currentUserId || id === challengeCreatorId) return;
    setParticipants((current) =>
      current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id],
    );
  }

  function shiftDay(days: number) {
    setLocalDate((current) => {
      const next = validChallengeDate(current)
        ? dateWithOffsetFrom(current, days)
        : dateKey();
      setEndDate((currentEnd) =>
        durationPreset === "custom" && validChallengeDate(currentEnd)
          ? dateWithOffsetFrom(currentEnd, days)
          : durationPreset === "custom"
            ? next
            : challengePresetEndDate(next, durationPreset),
      );
      return next;
    });
  }

  async function chooseVisualImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.78,
      allowsEditing: true,
      aspect: [1, 1],
    });
    const uri = result.canceled ? undefined : result.assets[0]?.uri;
    if (!uri) return;
    setVisualImagePreviewUri(uri);
    setVisualImageUploadUri(uri);
    setVisualImageStoragePath(null);
  }

  async function submit() {
    const numericTarget = targetEnabled
      ? Number(target.replace(",", "."))
      : undefined;
    const monthDays = [
      ...new Set(
        repeatMonthDays
          .split(",")
          .map((item) => Number(item.trim()))
          .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31),
      ),
    ];
    const resolvedEndDate =
      durationPreset === "custom"
        ? endDate
        : challengePresetEndDate(localDate, durationPreset);
    const recurrence: GoalSchedule | undefined =
      durationPreset !== "day" || repeatMode === "once"
        ? undefined
        : {
            mode: repeatMode,
            anchorDate: localDate,
            endDate: repeatUntil,
            daysOfWeek:
              repeatMode === "selected_days" ? repeatDays : undefined,
            intervalDays:
              repeatMode === "interval_days"
                ? Number(repeatInterval)
                : undefined,
            daysOfMonth:
              repeatMode === "days_of_month" ? monthDays : undefined,
          };
    if (
      historicalRecurringRulesLocked &&
      recurrence?.endDate &&
      recurrence.endDate < recurringHistoryBoundary
    ) {
      setError(
        "Past repeat results are locked. Choose yesterday or a future repeat end.",
      );
      return;
    }
    const participantIds = audience === "public"
      ? [...new Set([currentUserId, challengeCreatorId])]
      : [...new Set([...participants, currentUserId, challengeCreatorId])];
    const numericParticipantLimit =
      audience === "public" && limitEnabled
        ? Number(participantLimit)
        : undefined;
    const repeatingScheduleChanged = Boolean(
      recurrence &&
        recurringScheduleKey(recurrence) !==
          recurringScheduleKey(challenge?.recurrence),
    );
    const validation = validateGroupChallenge({
      title,
      target: numericTarget,
      localDate,
      endDate: resolvedEndDate,
      metric: selectedMetric,
      participantIds,
      creatorId: challengeCreatorId,
      audience,
      participantLimit: numericParticipantLimit,
      recurrence,
      // Active multi-day periods may retain a past start. Repeating series
      // cannot be moved into history because that would create retroactive
      // winner notifications for occurrences nobody actually joined live.
      today: !challenge || repeatingScheduleChanged ? dateKey() : undefined,
    });
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await onSave({
        id: challenge?.sourceChallengeId ?? challenge?.id,
        groupId: group.id,
        metricId,
        title,
        visualIcon,
        visualImageStoragePath: visualImageStoragePath ?? null,
        visualImageUploadUri,
        previousVisualImageStoragePath: challenge?.visualImageStoragePath,
        audience,
        participantLimit: numericParticipantLimit,
        target: numericTarget,
        localDate,
        endDate: resolvedEndDate,
        participantIds,
        recurrence,
      });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.backdrop}
      >
        <Pressable accessibilityLabel="Close challenge editor" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.header}>
            <View style={[styles.heroIcon, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name="trophy" size={20} color={accent} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={[styles.heading, { color: colors.ink }]}>
                {challenge ? "Edit challenge" : "Challenge your friends"}
              </Text>
              <Text style={[styles.subheading, { color: colors.muted }]}>
                Choose a target or an open race across one day or a date range.
              </Text>
            </View>
            <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.close}>
              <Ionicons name="close" size={20} color={colors.muted} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            {historicalRecurringRulesLocked ? (
              <Text style={[styles.repeatSeriesHint, { color: colors.muted }]}>Past results are locked. You can edit the title or change only the future repeat end.</Text>
            ) : null}
            <Text style={[styles.label, { color: colors.ink }]}>Tracker</Text>
            <SelectionMenu
              title="Choose tracker"
              items={metricOptions}
              selectedIds={metricId ? [metricId] : []}
              multiple={false}
              minimumSelected={1}
              emptyLabel="Select a shared tracker"
              icon="analytics-outline"
              disabled={historicalRecurringRulesLocked}
              onChange={(ids) => {
                const next = eligibleMetrics.find(
                  (metric) => metric.id === ids[0],
                );
                if (!next) return;
                setMetricId(next.id);
                if (!challenge)
                  setTarget(String(next.goal.target ?? ""));
              }}
            />

            <View style={[styles.ruleChoices, styles.targetRuleChoices]}>
              {([
                { enabled: true, label: "Target", detail: "Reach a set value" },
                { enabled: false, label: "Most wins", detail: "No target; highest total wins" },
              ] as const).map((option) => {
                const selected = targetEnabled === option.enabled;
                return (
                  <Pressable
                    key={option.label}
                    accessibilityRole="radio"
                    accessibilityState={{
                      selected,
                      disabled: historicalRecurringRulesLocked,
                    }}
                    disabled={historicalRecurringRulesLocked}
                    onPress={() => setTargetEnabled(option.enabled)}
                    style={[
                      styles.ruleChoice,
                      {
                        borderColor: selected ? accent : colors.border,
                        backgroundColor: selected ? colors.primarySoft : colors.canvas,
                      },
                    ]}
                  >
                    <Ionicons
                      name={selected ? "radio-button-on" : "radio-button-off"}
                      size={16}
                      color={selected ? accent : colors.faint}
                    />
                    <View style={styles.ruleCopy}>
                      <Text style={[styles.ruleTitle, { color: colors.ink }]}>{option.label}</Text>
                      <Text style={[styles.ruleDetail, { color: colors.muted }]}>{option.detail}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {targetEnabled ? (
              <View style={styles.targetOnlyField}>
                <Text style={[styles.label, { color: colors.ink }]}>Challenge target</Text>
                <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.canvas }]}>
                  <TextInput
                    value={target}
                    onChangeText={setTarget}
                    editable={!historicalRecurringRulesLocked}
                    keyboardType="decimal-pad"
                    placeholder="Challenge target"
                    style={[styles.input, { color: colors.ink }]}
                  />
                  <Text style={[styles.unit, { color: colors.muted }]}>{selectedMetric?.unit}</Text>
                </View>
              </View>
            ) : null}

            <View style={styles.durationMenu}>
              <SelectionMenu
                title="Duration"
                searchable={false}
                multiple={false}
                items={CHALLENGE_DURATION_OPTIONS}
                selectedIds={[durationPreset]}
                disabled={historicalRecurringRulesLocked}
                onChange={(ids) => {
                  const preset = ids[0] as ChallengeDurationPreset | undefined;
                  if (!preset) return;
                  setDurationPreset(preset);
                  if (preset !== "custom")
                    setEndDate(challengePresetEndDate(localDate, preset));
                  if (preset !== "day") setRepeatMode("once");
                }}
              />
            </View>

            <View style={styles.fieldRow}>
              <View style={styles.dateField}>
                <Text style={[styles.label, { color: colors.ink }]}>{durationPreset === "day" ? "Challenge day" : "Starts"}</Text>
                <View style={[styles.dateControls, { borderColor: colors.border, backgroundColor: colors.canvas }]}>
                  <Pressable
                    accessibilityState={{ disabled: historicalRecurringRulesLocked }}
                    disabled={historicalRecurringRulesLocked}
                    onPress={() => shiftDay(-1)}
                    style={styles.dateArrow}
                  >
                    <Ionicons name="chevron-back" size={16} color={colors.muted} />
                  </Pressable>
                  <TextInput
                    value={localDate}
                    editable={!historicalRecurringRulesLocked}
                    onChangeText={(value) => {
                      setLocalDate(value);
                      if (
                        durationPreset !== "custom" &&
                        validChallengeDate(value)
                      )
                        setEndDate(
                          challengePresetEndDate(value, durationPreset),
                        );
                    }}
                    maxLength={10}
                    placeholder="YYYY-MM-DD"
                    style={[styles.dateInput, { color: colors.ink }]}
                  />
                  <Pressable
                    accessibilityState={{ disabled: historicalRecurringRulesLocked }}
                    disabled={historicalRecurringRulesLocked}
                    onPress={() => shiftDay(1)}
                    style={styles.dateArrow}
                  >
                    <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                  </Pressable>
                </View>
              </View>
              {durationPreset !== "day" ? (
                <View style={styles.dateField}>
                  <Text style={[styles.label, { color: colors.ink }]}>Ends · inclusive</Text>
                  <View style={[styles.dateControls, { borderColor: colors.border, backgroundColor: colors.canvas }]}>
                    <TextInput
                      value={endDate}
                      onChangeText={setEndDate}
                      editable={durationPreset === "custom"}
                      maxLength={10}
                      placeholder="YYYY-MM-DD"
                      style={[styles.dateInput, { color: colors.ink }]}
                    />
                  </View>
                </View>
              ) : null}
            </View>

            {durationPreset === "day" ? <View style={styles.repeatMenu}>
              <SelectionMenu
                title="Frequency"
                searchable={false}
                multiple={false}
                items={CHALLENGE_REPEAT_OPTIONS}
                selectedIds={[repeatMode]}
                disabled={historicalRecurringRulesLocked}
                onChange={(ids) => {
                  const mode = ids[0] as ChallengeRepeatMode | undefined;
                  if (!mode) return;
                  setRepeatMode(mode);
                  if (mode !== "once" && repeatUntil < localDate)
                    setRepeatUntil(dateWithOffsetFrom(localDate, 28));
                }}
              />
              {repeatMode !== "once" ? (
                <Text style={[styles.repeatSeriesHint, { color: colors.muted }]}>Responses apply to the whole series.</Text>
              ) : null}
            </View> : null}
            {durationPreset === "day" && repeatMode === "selected_days" ? (
              <View style={styles.repeatDetail}>
                <Text style={[styles.repeatDetailLabel, { color: colors.muted }]}>{t("Repeat on")}</Text>
                <View style={styles.weekdayRow}>
                  {["S", "M", "T", "W", "T", "F", "S"].map((label, day) => {
                    const selected = repeatDays.includes(day);
                    return (
                      <Pressable
                        key={`${label}-${day}`}
                        accessibilityRole="checkbox"
                        accessibilityState={{
                          checked: selected,
                          disabled: historicalRecurringRulesLocked,
                        }}
                        disabled={historicalRecurringRulesLocked}
                        onPress={() =>
                          setRepeatDays((current) =>
                            selected
                              ? current.filter((item) => item !== day)
                              : [...current, day].sort(),
                          )
                        }
                        style={[
                          styles.weekday,
                          {
                            borderColor: selected ? accent : colors.border,
                            backgroundColor: selected
                              ? colors.primarySoft
                              : colors.canvas,
                          },
                        ]}
                      >
                        <Text style={[styles.weekdayText, { color: selected ? accent : colors.muted }]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
            {durationPreset === "day" && repeatMode === "interval_days" ? (
              <View style={styles.repeatDetail}>
                <Text style={[styles.repeatDetailLabel, { color: colors.muted }]}>Repeat every</Text>
                <View style={[styles.intervalInput, { borderColor: colors.border, backgroundColor: colors.canvas }]}>
                  <TextInput
                    value={repeatInterval}
                    onChangeText={setRepeatInterval}
                    editable={!historicalRecurringRulesLocked}
                    keyboardType="number-pad"
                    maxLength={2}
                    placeholder="3"
                    style={[styles.intervalValue, { color: colors.ink }]}
                  />
                  <Text style={[styles.intervalSuffix, { color: colors.muted }]}>days</Text>
                </View>
              </View>
            ) : null}
            {durationPreset === "day" && repeatMode === "days_of_month" ? (
              <View style={styles.repeatDetail}>
                <Text style={[styles.repeatDetailLabel, { color: colors.muted }]}>Dates each month</Text>
                <TextInput
                  value={repeatMonthDays}
                  onChangeText={setRepeatMonthDays}
                  editable={!historicalRecurringRulesLocked}
                  keyboardType="numbers-and-punctuation"
                  placeholder="1, 15"
                  style={[styles.monthDaysInput, { color: colors.ink, borderColor: colors.border, backgroundColor: colors.canvas }]}
                />
              </View>
            ) : null}
            {durationPreset === "day" && repeatMode !== "once" ? (
              <View style={[styles.repeatUntil, { borderColor: colors.border, backgroundColor: colors.canvas }]}>
                <Text style={[styles.repeatUntilLabel, { color: colors.muted }]}>{t("Repeat until")}</Text>
                <TextInput
                  value={repeatUntil}
                  onChangeText={setRepeatUntil}
                  maxLength={10}
                  placeholder="YYYY-MM-DD"
                  style={[styles.repeatUntilInput, { color: colors.ink }]}
                />
              </View>
            ) : null}

            <Text style={[styles.label, { color: colors.ink }]}>Title · optional</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              maxLength={80}
              placeholder="For example, 20k step sprint"
              style={[styles.titleInput, { color: colors.ink, borderColor: colors.border, backgroundColor: colors.canvas }]}
            />

            <View
              style={[
                styles.visualSection,
                { borderColor: colors.border, backgroundColor: colors.canvas },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(`${visualOpen ? "Collapse" : "Customize"} challenge icon or image`)}
                accessibilityState={{ expanded: visualOpen }}
                onPress={() => setVisualOpen((open) => !open)}
                style={styles.visualHeader}
              >
                <ChallengeVisual
                  challenge={{ audience, visualIcon }}
                  imageUri={visualImagePreviewUri}
                  color={accent}
                  size={38}
                />
                <View style={styles.ruleCopy}>
                  <Text style={[styles.ruleTitle, { color: colors.ink }]}>Challenge icon or image</Text>
                  <Text style={[styles.ruleDetail, { color: colors.muted }]}>Optional · the image overrides the icon</Text>
                </View>
                <Ionicons
                  name={visualOpen ? "chevron-up" : "chevron-down"}
                  size={17}
                  color={colors.muted}
                />
              </Pressable>
              {visualOpen ? (
                <View style={[styles.visualBody, { borderTopColor: colors.border }]}>
                  <Text style={[styles.visualLabel, { color: colors.muted }]}>ICON</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.visualIcons}
                  >
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ selected: visualIcon === undefined }}
                      accessibilityLabel={t("Use default challenge icon")}
                      onPress={() => setVisualIcon(undefined)}
                      style={[
                        styles.visualIconChoice,
                        {
                          borderColor: visualIcon === undefined ? accent : colors.border,
                          backgroundColor: visualIcon === undefined ? colors.primarySoft : colors.card,
                        },
                      ]}
                    >
                      <Ionicons
                        name={audience === "public" ? "earth-outline" : "trophy-outline"}
                        size={19}
                        color={visualIcon === undefined ? accent : colors.muted}
                      />
                    </Pressable>
                    {CHALLENGE_VISUAL_ICONS.map((icon) => {
                      const selected = icon === visualIcon;
                      return (
                        <Pressable
                          key={icon}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          accessibilityLabel={t(`Use ${icon.replaceAll("-", " ")} challenge icon`)}
                          onPress={() => setVisualIcon(icon)}
                          style={[
                            styles.visualIconChoice,
                            {
                              borderColor: selected ? accent : colors.border,
                              backgroundColor: selected ? colors.primarySoft : colors.card,
                            },
                          ]}
                        >
                          <Ionicons name={icon} size={19} color={selected ? accent : colors.muted} />
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  <View style={styles.visualImageActions}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void chooseVisualImage()}
                      style={[styles.visualImageAction, { borderColor: colors.border }]}
                    >
                      <Ionicons name="image-outline" size={16} color={accent} />
                      <Text style={[styles.visualImageActionText, { color: accent }]}>Choose image</Text>
                    </Pressable>
                    {visualImagePreviewUri ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("Remove challenge image")}
                        onPress={() => {
                          setVisualImagePreviewUri(undefined);
                          setVisualImageUploadUri(undefined);
                          setVisualImageStoragePath(null);
                        }}
                        style={[styles.visualImageAction, { borderColor: palette.red }]}
                      >
                        <Ionicons name="trash-outline" size={15} color={palette.red} />
                        <Text style={[styles.visualImageActionText, { color: palette.red }]}>Remove</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </View>

            <Text style={[styles.label, { color: colors.ink }]}>Who can join</Text>
            <View style={styles.ruleChoices}>
              {([
                { id: "group", label: "Your group", detail: "Invite group members" },
                { id: "public", label: "Public", detail: "Anyone on HabHub can join" },
              ] as const).map((option) => {
                const selected = audience === option.id;
                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: Boolean(challenge) }}
                    disabled={Boolean(challenge)}
                    onPress={() => setAudience(option.id)}
                    style={[
                      styles.ruleChoice,
                      {
                        borderColor: selected ? accent : colors.border,
                        backgroundColor: selected ? colors.primarySoft : colors.canvas,
                      },
                    ]}
                  >
                    <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={16} color={selected ? accent : colors.faint} />
                    <View style={styles.ruleCopy}>
                      <Text style={[styles.ruleTitle, { color: colors.ink }]}>{option.label}</Text>
                      <Text style={[styles.ruleDetail, { color: colors.muted }]}>{option.detail}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {audience === "public" ? (
              <View style={[styles.publicLimit, { borderColor: colors.border, backgroundColor: colors.canvas }]}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: limitEnabled }}
                  onPress={() => setLimitEnabled((current) => !current)}
                  style={styles.publicLimitToggle}
                >
                  <Ionicons name={limitEnabled ? "checkbox" : "square-outline"} size={18} color={limitEnabled ? accent : colors.faint} />
                  <View style={styles.ruleCopy}>
                    <Text style={[styles.ruleTitle, { color: colors.ink }]}>Limit participants</Text>
                    <Text style={[styles.ruleDetail, { color: colors.muted }]}>Off means no creator-defined limit.</Text>
                  </View>
                </Pressable>
                {limitEnabled ? (
                  <TextInput
                    value={participantLimit}
                    onChangeText={setParticipantLimit}
                    keyboardType="number-pad"
                    maxLength={4}
                    placeholder="100"
                    style={[styles.publicLimitInput, { color: colors.ink, borderColor: colors.border }]}
                  />
                ) : null}
              </View>
            ) : null}

            {audience === "group" ? <><View style={styles.peopleHeader}>
              <View>
                <Text style={[styles.label, { color: colors.ink }]}>People</Text>
                <Text style={[styles.peopleHint, { color: colors.muted }]}>
                  {challenge
                    ? "Invited members are fixed after creation."
                    : "Invited members choose to accept or decline."}
                </Text>
              </View>
              {!challenge ? <Pressable
                onPress={() =>
                  setParticipants(
                    allSelected
                      ? [...new Set([currentUserId, challengeCreatorId])]
                      : group.members.map((member) => member.id),
                  )
                }
                style={[styles.allButton, { backgroundColor: colors.primarySoft }]}
              >
                <Text style={[styles.allButtonText, { color: accent }]}>{allSelected ? "Deselect all" : "All members"}</Text>
              </Pressable> : null}
            </View>
            <View style={styles.peopleGrid}>
              {group.members.map((member) => {
                const selected =
                  participants.includes(member.id) ||
                  member.id === currentUserId ||
                  member.id === challengeCreatorId;
                return (
                  <Pressable
                    key={member.id}
                    accessibilityRole="checkbox"
                    accessibilityLabel={member.id === currentUserId ? "You" : member.name}
                    accessibilityState={{
                      checked: selected,
                      disabled:
                        Boolean(challenge) ||
                        member.id === currentUserId ||
                        member.id === challengeCreatorId,
                    }}
                    disabled={
                      Boolean(challenge) ||
                      member.id === currentUserId ||
                      member.id === challengeCreatorId
                    }
                    onPress={() => toggleParticipant(member.id)}
                    style={[
                      styles.person,
                      {
                        borderColor: selected ? accent : colors.border,
                        backgroundColor: selected ? colors.primarySoft : colors.canvas,
                      },
                    ]}
                  >
                    <Avatar initials={member.initials} color={member.color} uri={member.avatarUri} size={28} />
                    <Text numberOfLines={1} style={[styles.personName, { color: colors.ink }]}>
                      {member.id === currentUserId ? "You" : member.name}
                    </Text>
                    <Ionicons name={selected ? "checkmark-circle" : "ellipse-outline"} size={17} color={selected ? accent : colors.faint} />
                  </Pressable>
                );
              })}
            </View>
            </> : (
              <Text style={[styles.peopleHint, { color: colors.muted }]}>Joining is instant and shares only this challenge tracker for its scoring dates.</Text>
            )}

            {error ? (
              <View style={[styles.error, { backgroundColor: `${palette.red}14` }]}>
                <Ionicons name="alert-circle-outline" size={16} color={palette.red} />
                <Text style={[styles.errorText, { color: palette.red }]}>{t(error)}</Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <Pressable onPress={onClose} style={[styles.cancel, { borderColor: colors.border }]}>
              <Text style={[styles.cancelText, { color: colors.muted }]}>Cancel</Text>
            </Pressable>
            <Pressable disabled={saving || !eligibleMetrics.length} onPress={submit} style={[styles.save, { backgroundColor: accent }, (saving || !eligibleMetrics.length) && styles.disabled]}>
              <Ionicons name={challenge ? "checkmark" : "trophy"} size={17} color={palette.white} />
              <Text style={styles.saveText}>{saving ? "Saving…" : challenge ? "Save challenge" : "Create challenge"}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: 14, backgroundColor: "rgba(5,14,36,0.62)" },
  sheet: { width: "100%", maxWidth: 560, maxHeight: "92%", borderRadius: 24, borderWidth: 1, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16, paddingBottom: 11 },
  heroIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1 },
  heading: { fontSize: 17, fontWeight: "900" },
  subheading: { fontSize: 9, lineHeight: 13, marginTop: 2 },
  close: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 16, paddingBottom: 12 },
  label: { fontSize: 10, fontWeight: "900", marginBottom: 6 },
  chips: { gap: 7, paddingBottom: 14 },
  metricChip: { minHeight: 36, borderRadius: 12, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10 },
  metricText: { fontSize: 10, fontWeight: "800" },
  fieldRow: { flexDirection: "row", gap: 9, marginBottom: 13 },
  ruleChoices: { flexDirection: "row", gap: 8, marginBottom: 13 },
  targetRuleChoices: { marginTop: 12 },
  ruleChoice: { flex: 1, minHeight: 50, borderRadius: 13, borderWidth: 1, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 7 },
  ruleCopy: { flex: 1 },
  ruleTitle: { fontSize: 10, fontWeight: "900" },
  ruleDetail: { marginTop: 1, fontSize: 8, lineHeight: 11 },
  targetOnlyField: { marginBottom: 13 },
  durationMenu: { marginBottom: 10 },
  dateField: { flex: 1.25 },
  inputWrap: { height: 42, borderRadius: 13, borderWidth: 1, flexDirection: "row", alignItems: "center" },
  input: { flex: 1, paddingHorizontal: 11, fontSize: 13, fontWeight: "800" },
  unit: { paddingRight: 10, fontSize: 9, fontWeight: "800" },
  dateControls: { height: 42, borderRadius: 13, borderWidth: 1, flexDirection: "row", alignItems: "center" },
  dateArrow: { width: 29, height: "100%", alignItems: "center", justifyContent: "center" },
  dateInput: { flex: 1, minWidth: 0, textAlign: "center", fontSize: 10, fontWeight: "800", paddingHorizontal: 0 },
  repeatMenu: { gap: 4, marginBottom: 9 },
  repeatSeriesHint: { paddingHorizontal: 3, fontSize: 8, lineHeight: 11 },
  repeatDetail: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 7 },
  repeatDetailLabel: { minWidth: 72, fontSize: 8, fontWeight: "800" },
  weekdayRow: { flexDirection: "row", flex: 1, gap: 5 },
  weekday: { width: 28, height: 28, borderRadius: 9, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  weekdayText: { fontSize: 8, fontWeight: "900" },
  intervalInput: { minHeight: 32, borderRadius: 11, borderWidth: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 9 },
  intervalValue: { width: 34, padding: 0, textAlign: "center", fontSize: 10, fontWeight: "900" },
  intervalSuffix: { fontSize: 8, fontWeight: "800" },
  monthDaysInput: { flex: 1, height: 34, borderRadius: 11, borderWidth: 1, paddingHorizontal: 9, fontSize: 9, fontWeight: "800" },
  repeatUntil: { alignSelf: "flex-start", minHeight: 34, borderRadius: 11, borderWidth: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 9, gap: 6, marginBottom: 13 },
  repeatUntilLabel: { fontSize: 8, fontWeight: "800" },
  repeatUntilInput: { width: 88, padding: 0, fontSize: 9, fontWeight: "900" },
  titleInput: { height: 42, borderRadius: 13, borderWidth: 1, paddingHorizontal: 11, fontSize: 11, marginBottom: 14 },
  visualSection: { borderWidth: 1, borderRadius: 14, marginBottom: 14, overflow: "hidden" },
  visualHeader: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingVertical: 8 },
  visualBody: { borderTopWidth: StyleSheet.hairlineWidth, padding: 10, gap: 8 },
  visualLabel: { fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  visualIcons: { gap: 7, paddingRight: 4 },
  visualIconChoice: { width: 38, height: 38, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  visualImageActions: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  visualImageAction: { minHeight: 34, borderRadius: 11, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 10 },
  visualImageActionText: { fontSize: 8, fontWeight: "900" },
  publicLimit: { borderWidth: 1, borderRadius: 13, padding: 10, marginBottom: 13, gap: 8 },
  publicLimitToggle: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 8 },
  publicLimitInput: { height: 36, borderWidth: 1, borderRadius: 11, paddingHorizontal: 10, fontSize: 11, fontWeight: "800" },
  peopleHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 7 },
  peopleHint: { fontSize: 8, lineHeight: 11 },
  allButton: { minHeight: 31, borderRadius: 11, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  allButtonText: { fontSize: 8, fontWeight: "900" },
  peopleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  person: { width: "48.8%", minWidth: 145, minHeight: 44, borderRadius: 13, borderWidth: 1, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 7 },
  personName: { flex: 1, fontSize: 10, fontWeight: "800" },
  error: { marginTop: 11, borderRadius: 12, padding: 9, flexDirection: "row", alignItems: "center", gap: 7 },
  errorText: { flex: 1, fontSize: 9, fontWeight: "800" },
  footer: { minHeight: 66, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, paddingHorizontal: 16 },
  cancel: { height: 40, borderRadius: 13, borderWidth: 1, paddingHorizontal: 15, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 10, fontWeight: "900" },
  save: { height: 40, minWidth: 145, borderRadius: 13, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  saveText: { color: palette.white, fontSize: 10, fontWeight: "900" },
  disabled: { opacity: 0.48 },
});
