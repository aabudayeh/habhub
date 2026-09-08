import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { activeLiveSetupStep, nextLiveSetupStep } from "@/src/domain/tutorialUsability";
import { readableTextColor } from "@/src/domain/colors";
import { isInternalTracker } from "@/src/domain/trackerCatalog";
import { useLocalization } from "@/src/i18n";
import { useApp } from "@/src/state/AppProvider";
import { useOptionalTutorial } from "@/src/tutorial/TutorialContext";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";
import { useAppColors, useGroupAccent } from "@/src/theme";

/** Compact instructions beside the real page; never a second configuration form. */
export function LiveSetupCoach({ onEditToday }: { onEditToday: () => void }) {
  const { state, updateSettings, finishGuidedSetup } = useApp();
  const tutorial = useOptionalTutorial();
  const sandbox = useTutorialSandboxActive();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { t } = useLocalization();
  const [collapsed, setCollapsed] = useState(false);
  const step = activeLiveSetupStep(state.settings);
  if (!step || sandbox || tutorial?.activeSession) return null;
  const stageIndex = ["trackers", "layout", "first-log", "explore"].indexOf(step);
  const visibleTrackers = state.metrics.filter((metric) => !isInternalTracker(metric));
  const loggingMetric = visibleTrackers.find((metric) => metric.sections.today &&
    metric.id !== "todo_completion" && metric.dataType !== "calculated" && metric.manualEntry !== false);
  const next = () => step === "explore" ? finishGuidedSetup() : updateSettings({ guidedSetupStep: nextLiveSetupStep(step) });
  const title = step === "trackers" ? "Add your first tracker"
    : step === "layout" ? "Arrange Today" : step === "first-log" ? "Build your own history" : "Ready to explore";
  const detail = step === "trackers"
    ? "Choose ready-made trackers or create your own. Adding a tracker never adds sample history."
    : step === "layout" ? "Edit Today to reorder trackers, choose daily goals, or hide trackers and to-dos."
      : step === "first-log" ? "Tap a tracker for its history. Use Log to save a real value; an empty chart is normal at the start."
        : "Use the bottom bar to explore. Each page has a short optional guide; more help stays in Quick Guide.";
  if (collapsed) return (
    <Pressable testID="live-setup-resume" accessibilityRole="button" onPress={() => setCollapsed(false)} style={[styles.resume, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}>
      <Ionicons name="compass-outline" size={17} color={accent} />
      <Text preserveColor style={[styles.buttonText, { color: colors.ink }]}>{t("Continue setting up your Today")}</Text>
      <Ionicons name="chevron-down" size={16} color={accent} />
    </Pressable>
  );
  return (
    <View testID="live-setup-coach" accessibilityLabel={t("Live setup")} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.heading}>
        <Ionicons name="compass-outline" size={17} color={accent} />
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{title}</Text>
          <Text translate={false} style={[styles.counter, { color: colors.muted }]}>{t("Step {current} of {total}").replace("{current}", String(stageIndex + 1)).replace("{total}", "4")}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t("Minimize setup")} onPress={() => setCollapsed(true)} style={styles.iconButton}><Ionicons name="remove" size={18} color={colors.muted} /></Pressable>
        <Pressable testID="live-setup-skip-all" accessibilityRole="button" accessibilityLabel={t("Skip all tutorials")} onPress={() => finishGuidedSetup(true)} style={styles.iconButton}><Ionicons name="close" size={18} color={colors.muted} /></Pressable>
      </View>
      <Text style={[styles.detail, { color: colors.muted }]}>{detail}</Text>
      <View style={styles.actions}>
        {step === "trackers" ? <CoachButton primary testID="live-setup-add-trackers" label="Add trackers" icon="add-outline" onPress={() => router.push("/metric-editor?id=new" as never)} />
          : step === "layout" ? <CoachButton primary label="Edit Today" icon="options-outline" onPress={onEditToday} />
            : step === "first-log" ? <CoachButton primary label="Open Log" icon="create-outline" onPress={() => router.push((loggingMetric ? "/log?metric=" + encodeURIComponent(loggingMetric.id) : "/log") as never)} />
              : <CoachButton label="Explore Progress" icon="stats-chart-outline" onPress={() => { finishGuidedSetup(); router.navigate("/insights" as never); }} />}
        <CoachButton testID="live-setup-next" accessibilityLabel={step === "explore" ? "Finish live setup" : "Continue live setup"}
          label={step === "explore" ? "Finish setup" : step === "trackers" && !visibleTrackers.length ? "Use defaults" : "Next"}
          onPress={step === "trackers" && !visibleTrackers.length ? () => finishGuidedSetup() : next} />
      </View>
    </View>
  );
}

/** Inline, with no overlay over the real save controls. */
export function LiveSetupLogHint({ tracker = false, onContinue }: { tracker?: boolean; onContinue?: (work: () => void) => void }) {
  const { state, updateSettings } = useApp();
  const sandbox = useTutorialSandboxActive();
  const tutorial = useOptionalTutorial();
  const colors = useAppColors();
  const { t } = useLocalization();
  if (activeLiveSetupStep(state.settings) !== "first-log" || sandbox || tutorial?.activeSession) return null;
  const continueSetup = () => {
    const work = () => { updateSettings({ guidedSetupStep: "explore" }); router.navigate("/" as never); };
    if (onContinue) onContinue(work); else work();
  };
  return (
    <View testID="live-setup-log-hint" style={[styles.card, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.ink }]}>{tracker ? "This is your tracker history" : "Only log a real value"}</Text>
      <Text style={[styles.detail, { color: colors.muted }]}>{tracker ? "Your own entries build this chart. Use the range buttons to look back." : "Choose a date and your own value. Leaving without saving adds nothing."}</Text>
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
  card: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingBottom: 10, paddingTop: 4, gap: 5, marginVertical: 6 },
  heading: { flexDirection: "row", alignItems: "center", gap: 6 },
  headingCopy: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontSize: 13, fontWeight: "800", lineHeight: 18 },
  counter: { fontSize: 10, lineHeight: 14 },
  detail: { fontSize: 11, lineHeight: 16 },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", gap: 7, marginTop: 2 },
  button: { flex: 1, minHeight: 44, paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderRadius: 11, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5 },
  buttonText: { fontSize: 11, lineHeight: 16, fontWeight: "700", textAlign: "center", flexShrink: 1 },
  resume: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 7, marginVertical: 6 },
  hintAction: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
});
