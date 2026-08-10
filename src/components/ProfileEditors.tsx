import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText as Text } from "@/src/components/AppText";
import { useLocale, useLocalization } from "@/src/i18n";
import { localizeMetricName } from "@/src/i18n/domain";

import {
  ACTIVITY_LABELS,
  calculateActivityFromLevel,
  calculateBmr,
  calculateDailyActivity,
  calculateDailyEnergy,
  recommendedDailyDeficit,
  recommendedDailyIntakeForDirection,
} from "@/src/domain/energy";
import { dateKey } from "@/src/domain/date";
import { VACATION_COLOR } from "@/src/domain/vacation";
import {
  isMetricTrackedOnDate,
  weightProgressStats,
} from "@/src/domain/metrics";
import { isInternalTracker } from "@/src/domain/trackerCatalog";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { ActivityLevel, BiologicalSex, WeightDirection } from "@/src/types";
import { Card, Chip } from "./ui";
import { DraftNumberInput } from "./DraftNumberInput";

export function EnergyProfileEditor() {
  const { state, updateEnergyProfile, updateSettings } = useApp();
  const profile = state.settings.energyProfile;
  const colors = useAppColors();
  const locale = useLocale();
  const bmr = Math.round(calculateBmr(profile));
  const estimatedActivity = Math.round(calculateActivityFromLevel(profile));
  const activity = Math.round(calculateDailyActivity(profile));
  const daily = Math.round(calculateDailyEnergy(profile));
  const direction = state.settings.weightDirection ?? "lose";
  const [collapsed, setCollapsed] = React.useState(true);
  const adjustment = recommendedDailyDeficit(profile);
  const intake = recommendedDailyIntakeForDirection(profile, direction);
  const weightPlan = weightProgressStats(
    state,
    state.currentUserId,
    dateKey(),
  );
  const expectedDate = weightPlan.expectedGoalDate
    ? new Intl.DateTimeFormat(locale, {
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(new Date(`${weightPlan.expectedGoalDate}T12:00:00`))
    : null;
  function setDirection(next: WeightDirection) {
    updateSettings({ weightDirection: next });
    updateEnergyProfile({
      targetWeightKg:
        next === "maintain"
          ? profile.weightKg
          : next === "lose"
            ? Math.min(profile.targetWeightKg, profile.weightKg - 0.1)
            : Math.max(profile.targetWeightKg, profile.weightKg + 0.1),
      desiredWeeklyLossKg:
        next === "maintain"
          ? 0
          : Math.max(0.25, profile.desiredWeeklyLossKg || 0.5),
    });
  }
  return (
    <>
      <CollapsibleSectionHeader
        title="Body & energy profile"
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
      />
      {!collapsed ? <Card>
        <Text style={[styles.help, { color: colors.muted }]}>
          Used for your private BMR, recommended deficit, and food-intake goals.
        </Text>
        <Text style={[styles.label, { color: colors.ink }]}>Weight direction</Text>
        <View style={styles.chips}>
          {(["lose", "maintain", "gain"] as WeightDirection[]).map((item) => (
            <Chip
              key={item}
              label={item[0].toUpperCase() + item.slice(1)}
              selected={direction === item}
              onPress={() => setDirection(item)}
            />
          ))}
        </View>
        <Text style={[styles.help, { color: colors.muted }]}>
          {direction === "lose"
            ? "Target weight must be below your current weight."
            : direction === "gain"
              ? "Target weight must be above your current weight."
              : "Maintenance keeps target weight equal to current weight."}
        </Text>
        <View style={styles.grid}>
          {[
            {
              label: "Age",
              value: profile.age,
              unit: "years",
              key: "age" as const,
            },
            {
              label: "Height",
              value: profile.heightCm,
              unit: "cm",
              key: "heightCm" as const,
            },
            {
              label: "Current weight",
              value: profile.weightKg,
              unit: "kg",
              key: "weightKg" as const,
            },
            {
              label: "Starting weight",
              value: profile.startingWeightKg ?? profile.weightKg,
              unit: "kg",
              key: "startingWeightKg" as const,
            },
            {
              label: "Target weight",
              value: profile.targetWeightKg,
              unit: "kg",
              key: "targetWeightKg" as const,
            },
          ].map((field) => (
            <View key={field.key} style={styles.field}>
              <Text style={[styles.label, { color: colors.ink }]}>{field.label}</Text>
              <View style={[styles.inputWrap, { borderColor: colors.border }]}>
                <DraftNumberInput
                  value={field.value}
                  selectTextOnFocus
                  keyboardType="decimal-pad"
                  minimum={field.key === "age" ? 13 : field.key === "heightCm" ? 80 : 20}
                  maximum={field.key === "age" ? 120 : field.key === "heightCm" ? 260 : 500}
                  onCommit={(value) => updateEnergyProfile({ [field.key]: value })}
                  style={[styles.input, { color: colors.ink }]}
                />
                <Text style={[styles.unit, { color: colors.muted }]}>{field.unit}</Text>
              </View>
            </View>
          ))}
        </View>
        <Text style={[styles.label, { color: colors.ink }]}>
          Biological sex used by the BMR estimate
        </Text>
        <View style={styles.chips}>
          {(["female", "male", "unspecified"] as BiologicalSex[]).map((sex) => (
            <Chip
              key={sex}
              label={
                sex === "unspecified"
                  ? "Prefer not to say"
                  : sex[0].toUpperCase() + sex.slice(1)
              }
              selected={profile.sex === sex}
              onPress={() => updateEnergyProfile({ sex })}
            />
          ))}
        </View>
        <Text style={[styles.label, { color: colors.ink }]}>General activity level</Text>
        <View style={styles.chips}>
          {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((level) => (
            <Chip
              key={level}
              label={ACTIVITY_LABELS[level]}
              selected={
                profile.dailyActivityCaloriesOverride === undefined &&
                profile.activityLevel === level
              }
              onPress={() =>
                updateEnergyProfile({
                  activityLevel: level,
                  dailyActivityCaloriesOverride: undefined,
                })
              }
            />
          ))}
          <Chip
            label="Custom"
            selected={profile.dailyActivityCaloriesOverride !== undefined}
            onPress={() =>
              updateEnergyProfile({
                dailyActivityCaloriesOverride: estimatedActivity,
              })
            }
          />
        </View>
        {profile.dailyActivityCaloriesOverride !== undefined ? (
          <View
            style={[
              styles.rateInputWrap,
              styles.activityOverride,
              { borderColor: colors.border },
            ]}
          >
            <DraftNumberInput
              value={profile.dailyActivityCaloriesOverride}
              selectTextOnFocus
              keyboardType="number-pad"
              minimum={0}
              maximum={5000}
              commitOnChange
              onCommit={(dailyActivityCaloriesOverride) =>
                updateEnergyProfile({ dailyActivityCaloriesOverride })
              }
              style={[styles.rateInput, { color: colors.ink }]}
            />
            <Text style={[styles.unit, { color: colors.muted }]}>kcal/day</Text>
          </View>
        ) : null}
        {direction !== "maintain" ? (
          <>
            <Text style={[styles.label, { color: colors.ink }]}>Planned weight {direction === "gain" ? "gain" : "loss"} per week</Text>
            <View style={styles.chips}>
              {[0.25, 0.5, 0.75, 1].map((rate) => (
                <Chip
                  key={rate}
                  label={`${rate} kg`}
                  selected={profile.desiredWeeklyLossKg === rate}
                  onPress={() => updateEnergyProfile({ desiredWeeklyLossKg: rate })}
                />
              ))}
            </View>
            <View style={styles.customRate}>
              <Text style={[styles.help, { color: colors.muted }]}>
                Custom rate
              </Text>
              <View
                style={[styles.rateInputWrap, { borderColor: colors.border }]}
              >
                <DraftNumberInput
                  value={profile.desiredWeeklyLossKg}
                  selectTextOnFocus
                  keyboardType="decimal-pad"
                  minimum={0.05}
                  maximum={2}
                  commitOnChange
                  onCommit={(desiredWeeklyLossKg) =>
                    updateEnergyProfile({ desiredWeeklyLossKg })
                  }
                  style={[styles.rateInput, { color: colors.ink }]}
                />
                <Text style={[styles.unit, { color: colors.muted }]}>
                  kg/week
                </Text>
              </View>
            </View>
            {expectedDate ? (
              <Text style={[styles.help, { color: colors.muted }]}>
                Estimated target date: {expectedDate}. This follows your recent
                measured pace when enough weigh-ins exist; otherwise it uses
                your selected plan.
              </Text>
            ) : null}
          </>
        ) : null}
        <View style={[styles.equation, { backgroundColor: colors.canvas }]}>
          <Stat value={bmr} label="BMR kcal" />
          <Text style={[styles.symbol, { color: colors.faint }]}>+</Text>
          <Stat value={activity} label="daily activity" />
          <Text style={[styles.symbol, { color: colors.faint }]}>=</Text>
          <Stat value={daily} label="daily energy" accent />
        </View>
        <View style={styles.recommendations}>
          <View style={[styles.recommendation, { backgroundColor: colors.canvas }]}>
            <Ionicons
              name="trending-down-outline"
              size={19}
              color={palette.purple}
            />
            <Text style={[styles.recommendationValue, { color: colors.ink }]}>{direction === "maintain" ? 0 : adjustment}</Text>
            <Text style={[styles.recommendationLabel, { color: colors.muted }]}>
              {direction === "gain" ? "recommended surplus" : direction === "maintain" ? "energy adjustment" : "recommended deficit"}
            </Text>
          </View>
          <View style={[styles.recommendation, { backgroundColor: colors.canvas }]}>
            <Ionicons
              name="restaurant-outline"
              size={19}
              color={palette.amber}
            />
            <Text style={[styles.recommendationValue, { color: colors.ink }]}>{intake}</Text>
            <Text style={[styles.recommendationLabel, { color: colors.muted }]}>base food goal</Text>
          </View>
        </View>
        <Text style={[styles.label, { color: colors.ink }]}>Food-goal behavior</Text>
        <View style={styles.chips}>
          <Chip
            label="Adjust with activity"
            selected={state.settings.foodGoalMode === "activity_adjusted"}
            onPress={() =>
              updateSettings({ foodGoalMode: "activity_adjusted" })
            }
          />
          <Chip
            label="Keep fixed"
            selected={state.settings.foodGoalMode === "fixed"}
            onPress={() => updateSettings({ foodGoalMode: "fixed" })}
          />
        </View>
        <Text style={[styles.help, { color: colors.muted }]}>
          {state.settings.foodGoalMode === "activity_adjusted"
            ? "Default: active calories logged today are added to your food allowance while preserving the deficit target."
            : "Your food target stays fixed even when active energy changes."}
        </Text>
        <Text style={[styles.disclaimer, { color: colors.muted }]}>
          These planning estimates are not medical advice.
        </Text>
      </Card> : null}
    </>
  );
}

export function MetricGoalsEditor() {
  const { state, updateMetric } = useApp();
  const { language } = useLocalization();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [collapsed, setCollapsed] = React.useState(true);
  const metrics = state.metrics
    .filter(
      (metric) =>
        !isInternalTracker(metric) &&
        metric.goalEnabled !== false &&
        metric.dataType !== "text" &&
        metric.dataType !== "photo" &&
        isMetricTrackedOnDate(state, metric, dateKey()),
    )
    .sort((a, b) => a.order - b.order);
  return (
    <>
      <CollapsibleSectionHeader
        title="Metric goals"
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
        action={
          <Pressable onPress={() => router.push("/customize" as never)}>
            <Text style={[styles.link, { color: accent }]}>Full customization</Text>
          </Pressable>
        }
      />
      {!collapsed ? <Card style={styles.goalList}>
        {metrics.length ? metrics.map((metric, index, list) => (
            <View
              key={metric.id}
              style={[styles.goal, index < list.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
            >
              <View
                style={[styles.icon, { backgroundColor: `${metric.color}18` }]}
              >
                <Ionicons
                  name={metric.icon as keyof typeof Ionicons.glyphMap}
                  size={18}
                  color={metric.color}
                />
              </View>
              <View style={styles.grow}>
                <Text translate={false} style={[styles.goalName, { color: colors.ink }]}>{localizeMetricName(language, metric)}</Text>
                <Text style={[styles.goalMeta, { color: colors.muted }]}>
                  {metric.goal.kind.replace("_", " ")} ·{" "}
                  {metric.defaultVisibility === "private"
                    ? "Private"
                    : metric.defaultVisibility === "status"
                      ? "Status only"
                      : "Shared exact"}
                </Text>
              </View>
              <View style={[styles.goalInput, { borderColor: colors.border }]}>
                <DraftNumberInput
                  value={metric.goal.target}
                  selectTextOnFocus
                  keyboardType="decimal-pad"
                  onCommit={(target) => updateMetric(metric.id, {
                    goal: { ...metric.goal, target },
                  })}
                  style={[styles.goalText, { color: colors.ink }]}
                />
                <Text style={[styles.goalUnit, { color: colors.muted }]}>{metric.unit}</Text>
              </View>
            </View>
          )) : <Text style={[styles.help, { color: colors.muted, marginVertical: 12 }]}>No goals are currently tracked. Add one in customization.</Text>}
      </Card> : null}
    </>
  );
}

export function StreakSettingsEditor() {
  const { state, updateSettings } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { t } = useLocalization();
  const [collapsed, setCollapsed] = React.useState(true);
  const restDays = Math.max(
    0,
    Math.min(4, state.settings.streakRestDaysPerWeek ?? 1),
  );
  const vacationActive = (state.settings.vacationPeriods ?? []).some(
    (period) => !period.to,
  );
  return (
    <>
      <CollapsibleSectionHeader
        title="Streaks & rest days"
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
        action={
          vacationActive ? (
            <View
              accessible
              accessibilityLabel={t("Vacation mode is active")}
              style={[
                styles.vacationHeaderStatus,
                { backgroundColor: `${VACATION_COLOR}1C` },
              ]}
            >
              <Ionicons name="airplane" size={12} color={VACATION_COLOR} />
              <Ionicons name="checkmark-circle" size={13} color={VACATION_COLOR} />
            </View>
          ) : undefined
        }
      />
      {!collapsed ? (
        <Card style={styles.goalList}>
          <Text style={[styles.goalName, { color: colors.ink }]}>
            Weekly streak rest days
          </Text>
          <Text style={[styles.goalMeta, { color: colors.muted }]}>
            Protect personal Today and Progress streaks without changing group
            competition rules. Up to four days are allowed; use Vacation mode
            for a longer break.
          </Text>
          <View style={[styles.restDaysList, { borderTopColor: colors.border }]}>
            {Array.from({ length: 5 }, (_, count) => count).map((count) => {
              const selected = restDays === count;
              return (
                <Pressable
                  key={count}
                  onPress={() => updateSettings({ streakRestDaysPerWeek: count })}
                  style={[
                    styles.restDaysOption,
                    selected && { backgroundColor: colors.primarySoft },
                  ]}
                >
                  <Text
                    style={[
                      styles.goalName,
                      { color: selected ? accent : colors.ink },
                    ]}
                  >
                    {count === 0
                      ? "No rest days"
                      : `${count} rest day${count === 1 ? "" : "s"} per week`}
                  </Text>
                  {selected ? (
                    <Ionicons name="checkmark" size={17} color={accent} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(
              vacationActive ? "Vacation mode is active" : "Vacation mode",
            )}
            onPress={() => router.navigate("/vacation" as never)}
            style={[styles.vacationLink, { borderTopColor: colors.border }]}
          >
            <View
              style={[
                styles.vacationIcon,
                {
                  backgroundColor: vacationActive
                    ? `${VACATION_COLOR}1C`
                    : colors.primarySoft,
                },
              ]}
            >
              <Ionicons
                name={vacationActive ? "airplane" : "airplane-outline"}
                size={17}
                color={vacationActive ? VACATION_COLOR : accent}
              />
            </View>
            <View style={styles.grow}>
              <Text style={[styles.goalName, { color: colors.ink }]}>Vacation mode</Text>
              <Text style={[styles.goalMeta, { color: colors.muted }]}>
                {vacationActive
                  ? "Active · your streaks are protected"
                  : "Pause goal streaks without changing logged measurements."}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={colors.faint} />
          </Pressable>
        </Card>
      ) : null}
    </>
  );
}

function CollapsibleSectionHeader({
  title,
  collapsed,
  onToggle,
  action,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.sectionHeader}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        onPress={onToggle}
        hitSlop={6}
        style={styles.sectionTitleButton}
      >
        <Text style={[styles.sectionTitle, { color: colors.ink }]}>{title}</Text>
      </Pressable>
      {action}
      <Pressable
        accessibilityLabel={`${collapsed ? "Expand" : "Collapse"} ${title}`}
        onPress={onToggle}
        hitSlop={8}
        style={styles.sectionChevron}
      >
        <Ionicons
          name={collapsed ? "chevron-down" : "chevron-up"}
          size={18}
          color={colors.muted}
        />
      </Pressable>
    </View>
  );
}

function Stat({
  value,
  label,
  accent = false,
}: {
  value: number;
  label: string;
  accent?: boolean;
}) {
  const colors = useAppColors();
  const groupAccent = useGroupAccent();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: accent ? groupAccent : colors.ink }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
    marginBottom: 12,
  },
  sectionTitleButton: {
    flex: 1,
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
  },
  sectionChevron: {
    width: 30,
    minHeight: 34,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  sectionTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  help: { color: palette.muted, fontSize: 11, lineHeight: 16, marginBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  field: { width: "48%", minWidth: 130 },
  label: {
    color: palette.ink,
    fontSize: 10,
    fontWeight: "900",
    marginBottom: 6,
    marginTop: 9,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    paddingHorizontal: 10,
  },
  input: {
    flex: 1,
    color: palette.ink,
    fontSize: 14,
    fontWeight: "900",
    paddingVertical: 10,
  },
  unit: { color: palette.muted, fontSize: 9 },
  customRate: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 2,
  },
  rateInputWrap: {
    width: 136,
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 9,
  },
  activityOverride: { marginTop: 2 },
  rateInput: {
    flex: 1,
    fontSize: 11,
    fontWeight: "900",
    paddingVertical: 7,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 4 },
  equation: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: palette.canvas,
    borderRadius: 15,
    padding: 11,
    marginTop: 13,
  },
  stat: { flex: 1, alignItems: "center" },
  statValue: { color: palette.ink, fontSize: 17, fontWeight: "900" },
  accent: { color: palette.primary },
  statLabel: {
    color: palette.muted,
    fontSize: 8,
    textAlign: "center",
    marginTop: 2,
  },
  symbol: { color: palette.faint, fontWeight: "900" },
  recommendations: { flexDirection: "row", gap: 8, marginTop: 9 },
  recommendation: {
    flex: 1,
    backgroundColor: palette.canvas,
    borderRadius: 14,
    padding: 11,
  },
  recommendationValue: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 5,
  },
  recommendationLabel: { color: palette.muted, fontSize: 8, marginTop: 2 },
  disclaimer: {
    color: palette.muted,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 9,
  },
  link: { color: palette.primary, fontSize: 11, fontWeight: "900" },
  goalList: { paddingHorizontal: 12, paddingVertical: 2 },
  goal: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 8 },
  border: { borderBottomWidth: 1, borderBottomColor: palette.border },
  icon: {
    width: 37,
    height: 37,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  grow: { flex: 1 },
  goalName: { color: palette.ink, fontSize: 12, fontWeight: "900" },
  goalMeta: { color: palette.muted, fontSize: 8, marginTop: 2 },
  goalInput: {
    width: 90,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 7,
  },
  goalText: {
    flex: 1,
    color: palette.ink,
    fontSize: 11,
    fontWeight: "900",
    paddingVertical: 7,
  },
  goalUnit: { color: palette.muted, fontSize: 7 },
  restDays: { borderTopWidth: 1, marginTop: 4 },
  restDaysHeading: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  restDaysList: { borderTopWidth: 1, paddingVertical: 4 },
  restDaysOption: {
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  vacationLink: {
    minHeight: 58,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 4,
  },
  vacationIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  vacationHeaderStatus: {
    minHeight: 24,
    borderRadius: 999,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
});
