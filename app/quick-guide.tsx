import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { IconButton, PageHeader, Screen } from "@/src/components/ui";
import { useTutorial } from "@/src/tutorial/TutorialContext";
import type { TutorialGuide } from "@/src/tutorial/types";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { useLocalization } from "@/src/i18n";
import { localizedTutorialGuides } from "@/src/i18n/tutorial";

export default function QuickGuideScreen() {
  const {
    guides,
    progressByGuide,
    startGuide,
    activeSession,
    hydrated,
  } = useTutorial();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { language, t } = useLocalization();
  const localizedGuides = localizedTutorialGuides(guides, language);
  const params = useLocalSearchParams<{ completed?: string }>();
  const basicJustCompleted = params.completed === "essential";

  function launch(guide: TutorialGuide, resume: boolean) {
    if (!startGuide(guide.id, { resume })) return;
  }

  function startCompleteGuide() {
    const completeGuide = localizedGuides.find((guide) => guide.id === "full-app");
    if (completeGuide) launch(completeGuide, false);
  }

  return (
    <Screen contentContainerStyle={styles.page}>
      <PageHeader
        title={t("Guided tutorials")}
        subtitle={t("Learn each part of HabHub with anchored, interactive walkthroughs. Practice steps use a temporary demo workspace and never change your own entries.")}
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close guide"
            onPress={() => router.back()}
          />
        }
      />
      {basicJustCompleted ? (
        <View
          accessibilityRole="summary"
          style={[
            styles.completionHero,
            { backgroundColor: colors.primarySoft, borderColor: accent },
          ]}
        >
          <View style={[styles.completionIcon, { backgroundColor: accent }]}>
            <Ionicons name="checkmark" size={23} color="#FFFFFF" />
          </View>
          <View style={styles.completionCopy}>
            <Text accessibilityRole="header" style={[styles.completionTitle, { color: colors.ink }]}>
              {t("Basic guide complete")}
            </Text>
            <Text style={[styles.detail, { color: colors.muted }]}>
              {t("You know the essentials. Continue with the complete guided tour, or start using HabHub now. Every guide stays available here.")}
            </Text>
          </View>
          <View style={styles.completionActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Use HabHub")}
              onPress={() => router.replace("/" as never)}
              style={[styles.secondaryButton, { borderColor: accent }]}
            >
              <Text style={[styles.secondaryText, { color: accent }]}>
                {t("Use HabHub")}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Start complete guide")}
              onPress={startCompleteGuide}
              style={[styles.primaryButton, { backgroundColor: accent }]}
            >
              <Ionicons name="map-outline" size={16} color="#FFFFFF" />
              <Text preserveColor style={styles.primaryText}>
                {t("Start complete guide")}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {!hydrated ? (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.loading, { backgroundColor: colors.card }]}
        >
          <Text style={[styles.detail, { color: colors.muted }]}>{t("Loading your tutorial progress...")}</Text>
        </View>
      ) : (
        localizedGuides.map((guide) => {
          const progress = progressByGuide[guide.id];
          const completedCount = progress?.completed
            ? guide.steps.length
            : Math.min(progress?.completedStepIds.length ?? 0, guide.steps.length);
          const canResume = Boolean(progress && !progress.completed && completedCount > 0);
          const active = activeSession?.guideId === guide.id;
          const percent = guide.steps.length
            ? Math.round((completedCount / guide.steps.length) * 100)
            : 0;
          return (
            <View
              key={guide.id}
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.row}>
                <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
                  <Ionicons
                    name={guide.icon as keyof typeof Ionicons.glyphMap}
                    size={21}
                    color={accent}
                  />
                </View>
                <View style={styles.copy}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.title, { color: colors.ink }]}>
                      {guide.title}
                    </Text>
                    {progress?.completed ? (
                      <Ionicons name="checkmark-circle" size={17} color="#149D67" />
                    ) : null}
                  </View>
                  <Text style={[styles.detail, { color: colors.muted }]}>
                    {guide.detail}
                  </Text>
                  <View style={styles.metaRow}>
                    <Text style={[styles.meta, { color: colors.muted }]}>
                      {t("{count} steps").replace(
                        "{count}",
                        String(guide.steps.length),
                      )}
                      {guide.sections?.length
                        ? ` / ${t("{count} sections").replace("{count}", String(guide.sections.length))}`
                        : ""}
                    </Text>
                    <Text style={[styles.meta, { color: accent }]}>
                      {active ? t("In progress") : progress?.completed ? t("Complete") : `${percent}%`}
                    </Text>
                  </View>
                  <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                    <View
                      style={[
                        styles.progressFill,
                        { backgroundColor: accent, width: `${percent}%` },
                      ]}
                    />
                  </View>
                </View>
              </View>
              <View style={styles.actions}>
                {canResume || active ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("Resume {name}").replace("{name}", guide.title)}
                    onPress={() => launch(guide, true)}
                    style={[styles.secondaryButton, { borderColor: accent }]}
                  >
                    <Ionicons name="return-down-forward" size={16} color={accent} />
                    <Text style={[styles.secondaryText, { color: accent }]}>
                      {t("Resume")}
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t(
                    progress ? "Restart {name}" : "Start {name}",
                  ).replace("{name}", guide.title)}
                  onPress={() => launch(guide, false)}
                  style={[styles.primaryButton, { backgroundColor: accent }]}
                >
                  <Ionicons
                    name={progress ? "refresh" : "play"}
                    size={16}
                    color="#FFFFFF"
                  />
                  <Text preserveColor style={styles.primaryText}>
                    {progress ? t("Start over") : t("Start")}
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { paddingBottom: 24, gap: 10 },
  completionHero: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 15,
    gap: 12,
  },
  completionIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  completionCopy: { gap: 5 },
  completionTitle: { fontSize: 17, fontWeight: "900" },
  completionActions: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  loading: { minHeight: 72, borderRadius: 17, padding: 16, justifyContent: "center" },
  card: { borderWidth: 1, borderRadius: 18, padding: 13, gap: 12 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flex: 1, fontSize: 14, fontWeight: "900" },
  detail: { fontSize: 11, lineHeight: 16 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  meta: { fontSize: 9, lineHeight: 13, fontWeight: "800" },
  progressTrack: { height: 4, borderRadius: 2, overflow: "hidden", marginTop: 2 },
  progressFill: { height: 4, borderRadius: 2 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  secondaryButton: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  secondaryText: { fontSize: 10, fontWeight: "900" },
  primaryButton: {
    minHeight: 42,
    borderRadius: 12,
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  primaryText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
});
