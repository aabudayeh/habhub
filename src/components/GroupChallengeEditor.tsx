import { Ionicons } from "@expo/vector-icons";
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
import { Avatar } from "@/src/components/ui";
import { SaveGroupChallengeInput } from "@/src/cloud/groupChallenges";
import { dateKey, dateWithOffsetFrom } from "@/src/domain/date";
import {
  isChallengeMetric,
  validChallengeDate,
  validateGroupChallenge,
} from "@/src/domain/groupChallenges";
import { useTranslation } from "@/src/i18n";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import {
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
  const eligibleMetrics = useMemo(
    () => metrics.filter(isChallengeMetric),
    [metrics],
  );
  const [metricId, setMetricId] = useState(eligibleMetrics[0]?.id ?? "");
  const [target, setTarget] = useState("");
  const [title, setTitle] = useState("");
  const [localDate, setLocalDate] = useState(initialDate ?? dateKey());
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

  useEffect(() => {
    if (!visible) return;
    const metric =
      eligibleMetrics.find((item) => item.id === challenge?.metricId) ??
      eligibleMetrics[0];
    setMetricId(metric?.id ?? "");
    setTarget(
      challenge
        ? String(challenge.target)
        : metric?.goal.target
          ? String(metric.goal.target)
          : "",
    );
    setTitle(challenge?.title ?? "");
    setLocalDate(challenge?.localDate ?? initialDate ?? dateKey());
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
    setLocalDate((current) =>
      validChallengeDate(current)
        ? dateWithOffsetFrom(current, days)
        : dateKey(),
    );
  }

  async function submit() {
    const numericTarget = Number(target.replace(",", "."));
    const monthDays = [
      ...new Set(
        repeatMonthDays
          .split(",")
          .map((item) => Number(item.trim()))
          .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31),
      ),
    ];
    const recurrence: GoalSchedule | undefined =
      repeatMode === "once"
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
    const participantIds = [
      ...new Set([...participants, currentUserId, challengeCreatorId]),
    ];
    const validation = validateGroupChallenge({
      title,
      target: numericTarget,
      localDate,
      metric: selectedMetric,
      participantIds,
      creatorId: challengeCreatorId,
      recurrence,
      today: dateKey(),
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
        target: numericTarget,
        localDate,
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
                One target, one day, live group progress.
              </Text>
            </View>
            <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.close}>
              <Ionicons name="close" size={20} color={colors.muted} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <Text style={[styles.label, { color: colors.ink }]}>Tracker</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {eligibleMetrics.map((metric) => {
                const selected = metric.id === metricId;
                return (
                  <Pressable
                    key={metric.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={metric.name}
                    onPress={() => {
                      setMetricId(metric.id);
                      if (!challenge) setTarget(String(metric.goal.target || ""));
                    }}
                    style={[
                      styles.metricChip,
                      {
                        borderColor: selected ? metric.color : colors.border,
                        backgroundColor: selected ? colors.primarySoft : colors.canvas,
                      },
                    ]}
                  >
                    <Ionicons name={metric.icon as keyof typeof Ionicons.glyphMap} size={15} color={selected ? metric.color : colors.muted} />
                    <Text style={[styles.metricText, { color: colors.ink }]}>{metric.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.fieldRow}>
              <View style={styles.targetField}>
                <Text style={[styles.label, { color: colors.ink }]}>Target</Text>
                <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.canvas }]}>
                  <TextInput
                    value={target}
                    onChangeText={setTarget}
                    keyboardType="decimal-pad"
                    placeholder="Challenge target"
                    style={[styles.input, { color: colors.ink }]}
                  />
                  <Text style={[styles.unit, { color: colors.muted }]}>{selectedMetric?.unit}</Text>
                </View>
              </View>
              <View style={styles.dateField}>
                <Text style={[styles.label, { color: colors.ink }]}>Challenge day</Text>
                <View style={[styles.dateControls, { borderColor: colors.border, backgroundColor: colors.canvas }]}>
                  <Pressable onPress={() => shiftDay(-1)} style={styles.dateArrow}>
                    <Ionicons name="chevron-back" size={16} color={colors.muted} />
                  </Pressable>
                  <TextInput
                    value={localDate}
                    onChangeText={setLocalDate}
                    maxLength={10}
                    placeholder="YYYY-MM-DD"
                    style={[styles.dateInput, { color: colors.ink }]}
                  />
                  <Pressable onPress={() => shiftDay(1)} style={styles.dateArrow}>
                    <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                  </Pressable>
                </View>
              </View>
            </View>

            <View style={styles.repeatHeader}>
              <Text style={[styles.label, { color: colors.ink }]}>Repeat</Text>
              {repeatMode !== "once" ? (
                <Text style={[styles.peopleHint, { color: colors.muted }]}>Responses apply to the whole series.</Text>
              ) : null}
            </View>
            <View style={styles.repeatRow}>
              {(
                [
                  ["once", "Once"],
                  ["daily", "Daily"],
                  ["selected_days", "Weekdays"],
                  ["every_other_day", "Every other"],
                  ["interval_days", "Every N days"],
                  ["days_of_month", "Month dates"],
                ] as const
              ).map(([mode, label]) => {
                const selected = repeatMode === mode;
                return (
                  <Pressable
                    key={mode}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setRepeatMode(mode);
                      if (mode !== "once" && repeatUntil < localDate)
                        setRepeatUntil(dateWithOffsetFrom(localDate, 28));
                    }}
                    style={[
                      styles.repeatChip,
                      {
                        borderColor: selected ? accent : colors.border,
                        backgroundColor: selected
                          ? colors.primarySoft
                          : colors.canvas,
                      },
                    ]}
                  >
                    <Text style={[styles.repeatText, { color: selected ? accent : colors.muted }]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {repeatMode === "selected_days" ? (
              <View style={styles.repeatDetail}>
                <Text style={[styles.repeatDetailLabel, { color: colors.muted }]}>{t("Repeat on")}</Text>
                <View style={styles.weekdayRow}>
                  {["S", "M", "T", "W", "T", "F", "S"].map((label, day) => {
                    const selected = repeatDays.includes(day);
                    return (
                      <Pressable
                        key={`${label}-${day}`}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected }}
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
            {repeatMode === "interval_days" ? (
              <View style={styles.repeatDetail}>
                <Text style={[styles.repeatDetailLabel, { color: colors.muted }]}>Repeat every</Text>
                <View style={[styles.intervalInput, { borderColor: colors.border, backgroundColor: colors.canvas }]}>
                  <TextInput
                    value={repeatInterval}
                    onChangeText={setRepeatInterval}
                    keyboardType="number-pad"
                    maxLength={2}
                    placeholder="3"
                    style={[styles.intervalValue, { color: colors.ink }]}
                  />
                  <Text style={[styles.intervalSuffix, { color: colors.muted }]}>days</Text>
                </View>
              </View>
            ) : null}
            {repeatMode === "days_of_month" ? (
              <View style={styles.repeatDetail}>
                <Text style={[styles.repeatDetailLabel, { color: colors.muted }]}>Dates each month</Text>
                <TextInput
                  value={repeatMonthDays}
                  onChangeText={setRepeatMonthDays}
                  keyboardType="numbers-and-punctuation"
                  placeholder="1, 15"
                  style={[styles.monthDaysInput, { color: colors.ink, borderColor: colors.border, backgroundColor: colors.canvas }]}
                />
              </View>
            ) : null}
            {repeatMode !== "once" ? (
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

            <View style={styles.peopleHeader}>
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
  targetField: { flex: 0.9 },
  dateField: { flex: 1.25 },
  inputWrap: { height: 42, borderRadius: 13, borderWidth: 1, flexDirection: "row", alignItems: "center" },
  input: { flex: 1, paddingHorizontal: 11, fontSize: 13, fontWeight: "800" },
  unit: { paddingRight: 10, fontSize: 9, fontWeight: "800" },
  dateControls: { height: 42, borderRadius: 13, borderWidth: 1, flexDirection: "row", alignItems: "center" },
  dateArrow: { width: 29, height: "100%", alignItems: "center", justifyContent: "center" },
  dateInput: { flex: 1, minWidth: 0, textAlign: "center", fontSize: 10, fontWeight: "800", paddingHorizontal: 0 },
  repeatHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  repeatRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 13 },
  repeatChip: { minHeight: 32, borderRadius: 11, borderWidth: 1, paddingHorizontal: 9, alignItems: "center", justifyContent: "center" },
  repeatText: { fontSize: 8, fontWeight: "900" },
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
