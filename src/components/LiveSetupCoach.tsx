import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { guidedSuggestedTrackerIds } from "@/src/domain/onboarding";
import { trackerPresets, TrackerPreset } from "@/src/domain/trackerCatalog";
import { activeLiveSetupStep, nextLiveSetupStep, skipAllTutorialsSettings } from "@/src/domain/tutorialUsability";
import { dateKey } from "@/src/domain/date";
import { readableTextColor } from "@/src/domain/colors";
import { useLocalization } from "@/src/i18n";
import { useApp } from "@/src/state/AppProvider";
import { useOptionalTutorial } from "@/src/tutorial/TutorialContext";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";
import { useAppColors, useGroupAccent } from "@/src/theme";

/** Live setup uses only explicit, ordinary user handlers. It is intentionally
 * separate from the disposable Watch/Practice tutorial engine. */
export function LiveSetupCoach({ onEditToday }: { onEditToday: () => void }) {
  const { state, addMetric, updateMetric, updateSettings } = useApp();
  const tutorial = useOptionalTutorial();
  const sandbox = useTutorialSandboxActive();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { t } = useLocalization();
  const [collapsed, setCollapsed] = useState(false);
  const step = activeLiveSetupStep(state.settings);
  if (!step || sandbox || tutorial?.activeSession) return null;

  const stageIndex = ["trackers", "layout", "first-log", "explore"].indexOf(step);
  const suggested = guidedSuggestedTrackerIds(state.settings.selectedGoals ?? []);
  const presets = trackerPresets(state);
  const choices = suggested.slice(0, 4).flatMap((id) => {
    const preset = presets.find((item) => item.templateId === id);
    return preset ? [preset] : [];
  });
  const loggingMetric = state.metrics.find((metric) =>
    metric.sections.today && metric.id !== "todo_completion" && metric.dataType !== "calculated" && metric.manualEntry !== false,
  );
  const next = () => updateSettings({ guidedSetupStep: nextLiveSetupStep(step) });
  const skipAll = () => updateSettings(skipAllTutorialsSettings());
  const choose = (preset: TrackerPreset) => {
    const existing = state.metrics.find((metric) => metric.id === preset.templateId);
    if (existing) {
      // Visibility is reversible; the definition, goal history and entries stay.
      updateMetric(existing.id, { sections: { ...existing.sections, today: !existing.sections.today } });
    } else {
      const { description: _description, ...definition } = preset;
      addMetric({ ...definition, activeFrom: dateKey(), trackGoal: false, addToToday: true });
    }
  };
  const title = step === "trackers" ? t("Make Today yours")
    : step === "layout" ? t("Keep only what helps")
      : step === "first-log" ? t("Try your first real log") : t("Your app is ready to explore");
  const detail = step === "trackers"
    ? t("These are your real trackers. Tap a chip to show or hide it below; nothing is logged or deleted.")
    : step === "layout"
      ? t("Trackers keep history. Flag a few as daily goals; to-dos are individual tasks. Both sections are optional.")
      : step === "first-log"
        ? t("Open a tracker to see its history, or add a real value in Log. No sample entries will be saved.")
        : t("Use the bottom bar to explore. Progress shows your history; Groups is for friends. More tools and safe demo tours stay in the menu.");

  if (collapsed) return (
    <Pressable testID="live-setup-resume" accessibilityRole="button" onPress={() => setCollapsed(false)} style={[styles.resume, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}>
      <Ionicons name="compass-outline" size={18} color={accent} />
      <Text preserveColor style={[styles.buttonText, { color: colors.ink }]}>{t("Continue setting up your Today")}</Text>
      <Ionicons name="chevron-down" size={16} color={accent} />
    </Pressable>
  );

  return (
    <View testID="live-setup-coach" accessibilityLabel={t("Live setup")} style={[styles.card, { backgroundColor: colors.card, borderColor: accent }]}>
      <View style={styles.heading}>
        <Ionicons name="compass-outline" size={19} color={accent} />
        <View style={styles.headingCopy}>
          <Text translate={false} accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{title}</Text>
          <Text style={[styles.counter, { color: colors.muted }]}>{t("Step {current} of {total}").replace("{current}", String(stageIndex + 1)).replace("{total}", "4")}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Minimize setup")} onPress={() => setCollapsed(true)} style={styles.iconButton}>
          <Ionicons name="remove" size={19} color={colors.muted} />
        </Pressable>
        <Pressable testID="live-setup-skip-all" accessibilityRole="button" accessibilityLabel={t("Skip all tutorials")} onPress={skipAll} style={styles.iconButton}>
          <Ionicons name="close" size={19} color={colors.muted} />
        </Pressable>
      </View>
      {step === "explore" && state.settings.selectedGoals.some((goal) => ["weight", "nutrition", "health"].includes(goal)) ? (
        <Pressable accessibilityRole="button" onPress={() => router.navigate("/profile" as never)} style={styles.profileLink}>
          <Ionicons name="person-circle-outline" size={19} color={accent} />
          <Text preserveColor style={[styles.detail, styles.profileCopy, { color: colors.ink }]}>{t("My profile: personalize body-based estimates when you are ready.")}</Text>
        </Pressable>
      ) : null}
      <Text translate={false} style={[styles.detail, { color: colors.muted }]}>{detail}</Text>
      {step === "trackers" ? (
        <View style={styles.choices}>
          {choices.map((preset) => {
            const selected = state.metrics.some((metric) => metric.id === preset.templateId && metric.sections.today);
            return (
              <Pressable key={preset.templateId} testID={`live-setup-tracker-${preset.templateId}`} accessibilityRole="checkbox" accessibilityLabel={t("Show {name} on Today").replace("{name}", t(preset.name))} accessibilityState={{ checked: selected }} aria-checked={selected} onPress={() => choose(preset)} style={[styles.chip, { borderColor: selected ? accent : colors.border, backgroundColor: selected ? colors.primarySoft : colors.canvas }]}>
                <Ionicons name={preset.icon as keyof typeof Ionicons.glyphMap} size={17} color={selected ? accent : colors.muted} />
                <Text numberOfLines={1} style={[styles.chipText, { color: colors.ink }]}>{t(preset.name)}</Text>
                <Ionicons name={selected ? "checkmark-circle" : "add-circle-outline"} size={18} color={selected ? accent : colors.muted} />
              </Pressable>
            );
          })}
        </View>
      ) : step === "layout" ? (
        <View>
          {([
            ["showGoalsToday", "Show trackers", state.settings.showGoalsToday !== false],
            ["showTodosToday", "Show to-dos", state.settings.showTodosToday !== false],
          ] as const).map(([key, label, value]) => (
            <View key={key} style={styles.switchRow}>
              <Text style={[styles.buttonText, { color: colors.ink }]}>{t(label)}</Text>
              <Switch testID={`live-setup-${key}`} accessibilityLabel={t(key === "showGoalsToday" ? "Show trackers on Today" : "Show To-dos on Today")} value={value} onValueChange={(enabled) => updateSettings({ [key]: enabled })} trackColor={{ false: colors.border, true: accent }} />
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.actions}>
        {step === "trackers" ? (
          <CoachButton label="More trackers" icon="add-outline" onPress={() => router.navigate("/customize?tab=all" as never)} />
        ) : step === "layout" ? (
          <CoachButton label="Choose daily goals" icon="flag-outline" onPress={onEditToday} />
        ) : step === "first-log" ? (
          <CoachButton label="Open Log" icon="create-outline" onPress={() => router.navigate((loggingMetric ? `/log?metric=${encodeURIComponent(loggingMetric.id)}` : "/log") as never)} />
        ) : (
          <CoachButton label="Explore Progress" icon="stats-chart-outline" onPress={() => { next(); router.navigate("/insights" as never); }} />
        )}
        <CoachButton primary testID="live-setup-next" accessibilityLabel={step === "explore" ? "Finish live setup" : "Continue live setup"} label={step === "explore" ? "Finish setup" : step === "first-log" ? "Skip logging" : "Next"} onPress={next} />
      </View>
    </View>
  );
}

/** Inline in real pages, never a floating layer over Log's save/keyboard area. */
export function LiveSetupLogHint({ tracker = false, onContinue }: { tracker?: boolean; onContinue?: (work: () => void) => void }) {
  const { state, updateSettings } = useApp();
  const sandbox = useTutorialSandboxActive();
  const tutorial = useOptionalTutorial();
  const colors = useAppColors();
  const { t } = useLocalization();
  if (activeLiveSetupStep(state.settings) !== "first-log" || sandbox || tutorial?.activeSession) return null;
  const continueSetup = () => {
    const work = () => { updateSettings({ guidedSetupStep: "explore" }); router.navigate("/" as never); };
    if (onContinue) onContinue(work);
    else work();
  };
  return (
    <View testID="live-setup-log-hint" style={[styles.card, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.ink }]}>{t(tracker ? "This is your tracker history" : "Only log a real value")}</Text>
      <Text style={[styles.detail, { color: colors.muted }]}>{t(tracker ? "An empty chart is normal at the start. Your own entries will build this history; range buttons let you look back." : "Choose the date and enter your own value. Saving adds it to your account; leaving without saving adds nothing.")}</Text>
      <Pressable accessibilityRole="button" onPress={continueSetup} style={styles.hintAction}>
        <Text preserveColor style={[styles.buttonText, { color: colors.ink }]}>{t("Continue setup on Today")}</Text>
        <Ionicons name="arrow-forward" size={16} color={colors.ink} />
      </Pressable>
    </View>
  );
}

function CoachButton({ label, onPress, primary, icon, testID, accessibilityLabel }: { label: string; onPress: () => void; primary?: boolean; icon?: keyof typeof Ionicons.glyphMap; testID?: string; accessibilityLabel?: string }) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { t } = useLocalization();
  const color = primary ? readableTextColor(accent) : colors.ink;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel ? t(accessibilityLabel) : undefined} onPress={onPress} style={[styles.button, { borderColor: primary ? accent : colors.border, backgroundColor: primary ? accent : colors.card }]}>
      {icon ? <Ionicons name={icon} size={16} color={color} /> : null}
      <Text preserveColor style={[styles.buttonText, { color }]}>{t(label)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, padding: 12, gap: 8, marginVertical: 8 },
  heading: { flexDirection: "row", alignItems: "center", gap: 7 },
  headingCopy: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 15, fontWeight: "800", lineHeight: 20 },
  counter: { fontSize: 11, lineHeight: 15 },
  detail: { fontSize: 12, lineHeight: 18 },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: { flexGrow: 1, flexBasis: "46%", minWidth: 100, minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 6 },
  chipText: { flex: 1, minWidth: 0, fontSize: 12, fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { flexGrow: 1, flexBasis: "45%", minHeight: 44, paddingHorizontal: 9, paddingVertical: 8, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5 },
  buttonText: { fontSize: 12, lineHeight: 17, fontWeight: "700", textAlign: "center", flexShrink: 1 },
  switchRow: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  resume: { minHeight: 48, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginVertical: 8 },
  hintAction: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  profileLink: { minHeight: 44, flexDirection: "row", gap: 7, alignItems: "center" },
  profileCopy: { flex: 1, minWidth: 0 },
});
