import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";

import { AppText as Text } from "@/src/components/AppText";
import { useApp } from "@/src/state/AppProvider";
import { activeLiveSetupStep, skipAllTutorialsSettings } from "@/src/domain/tutorialUsability";
import { readableTextColor } from "@/src/domain/colors";
import { IconButton, PageHeader, Screen } from "@/src/components/ui";
import { useLocalization } from "@/src/i18n";
import { localizedTutorialGuides } from "@/src/i18n/tutorial";
import { resolvedTutorialRoute, routeForStep } from "@/src/tutorial/session";
import { useTutorial } from "@/src/tutorial/TutorialContext";
import type {
  TutorialExperienceMode,
  TutorialGuide,
} from "@/src/tutorial/types";
import { useAppColors, useGroupAccent } from "@/src/theme";

const GUIDE_GROUPS = [
  {
    id: "core",
    title: "Everyday pages",
    detail: "Today, trackers, logging, progress, workouts, food and timers",
    icon: "today-outline",
    guideIds: [
      "module:today",
      "module:status",
      "module:metric-detail",
      "module:todo",
      "module:log",
      "module:food",
      "module:timer",
      "module:progress",
      "module:daily-detail",
      "module:workout",
    ],
  },
  {
    id: "social",
    title: "Groups and motivation",
    detail: "Leaderboards, challenges, comparisons, badges and conversations",
    icon: "people-circle-outline",
    guideIds: [
      "module:leaderboard",
      "module:challenges",
      "module:comparison",
      "module:badges",
      "module:groups",
      "module:chat",
      "module:group-recap",
      "module:group-schedule",
      "module:group-notes",
    ],
  },
  {
    id: "settings",
    title: "Settings and privacy",
    detail: "Menu, health/cloud controls and notification reliability",
    icon: "shield-checkmark-outline",
    guideIds: ["module:menu", "module:settings", "module:notifications"],
  },
  {
    id: "optional",
    title: "Optional tools",
    detail: "Schedule, journal, performance, Screen Time and fasting",
    icon: "apps-outline",
    guideIds: [
      "module:schedule",
      "module:journal",
      "module:performance",
      "module:screen-time",
      "module:fasting",
    ],
  },
] as const;

export default function QuickGuideScreen() {
  const { state, updateSettings } = useApp();
  const {
    guides,
    progressByGuide,
    startGuide,
    activeSession,
    hydrated,
  } = useTutorial();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const onAccent = readableTextColor(accent);
  const { language, t } = useLocalization();
  const localizedGuides = localizedTutorialGuides(guides, language);
  const params = useLocalSearchParams<{ completed?: string }>();
  const basicJustCompleted = params.completed === "essential";
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  function launch(
    guide: TutorialGuide,
    resume: boolean,
    mode: TutorialExperienceMode,
  ) {
    const session = startGuide(guide.id, { resume, mode });
    if (!session) return;
    const destination = resolvedTutorialRoute(
      routeForStep(guide.steps[session.stepIndex], session.demoAnchorDate),
      session.demoAnchorDate,
    );
    // Leave the modal immediately. The spotlight route guard remains as a
    // fallback, but restart should visibly return to step one on the same tap.
    if (destination) router.replace(destination as never);
  }

  function guideCard(guide: TutorialGuide, featured = false) {
    const progress = progressByGuide[guide.id];
    const completedCount = progress?.completed
      ? guide.steps.length
      : Math.min(progress?.completedStepIds.length ?? 0, guide.steps.length);
    const canResume = Boolean(progress && !progress.completed && completedCount > 0);
    const active = activeSession?.guideId === guide.id;
    const percent = guide.steps.length
      ? Math.round((completedCount / guide.steps.length) * 100)
      : 0;
    const sectionCount = guide.sections?.length ?? 0;
    const meta = [
      t("{count} steps").replace("{count}", String(guide.steps.length)),
      sectionCount > 1
        ? t("{count} sections").replace("{count}", String(sectionCount))
        : undefined,
    ].filter(Boolean).join(" · ");

    return (
      <View
        key={guide.id}
        style={[
          featured ? styles.featuredCard : styles.card,
          {
            backgroundColor: featured ? colors.primarySoft : colors.card,
            borderColor: featured ? accent : colors.border,
          },
        ]}
      >
        <View style={styles.row}>
          <View style={[styles.icon, { backgroundColor: featured ? colors.card : colors.primarySoft }]}>
            <Ionicons name={guide.icon as keyof typeof Ionicons.glyphMap} size={21} color={accent} />
          </View>
          <View style={styles.copy}>
            <View style={styles.titleRow}>
              <Text style={[styles.title, { color: colors.ink }]}>{guide.title}</Text>
              {progress?.completed ? <Ionicons name="checkmark-circle" size={17} color="#149D67" /> : null}
            </View>
            <Text style={[styles.detail, { color: colors.muted }]}>{guide.detail}</Text>
            <View style={styles.metaRow}>
              <Text style={[styles.meta, { color: colors.muted }]}>{meta}</Text>
              <Text style={[styles.meta, { color: accent }]}>
                {active ? t("In progress") : progress?.completed ? t("Complete") : completedCount ? `${percent}%` : null}
              </Text>
            </View>
            {completedCount > 0 ? <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
              <View style={[styles.progressFill, { backgroundColor: accent, width: `${percent}%` }]} />
            </View> : null}
          </View>
        </View>
        <View style={styles.actions}>
          {canResume || active ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Resume {name}").replace("{name}", guide.title)}
              onPress={() => launch(guide, true, activeSession?.experienceMode ?? "practice")}
              style={[styles.secondaryButton, { borderColor: colors.border }]}
            >
              <Ionicons name="return-down-forward" size={15} color={colors.ink} />
              <Text style={[styles.secondaryText, { color: colors.ink }]}>{t("Resume")}</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t("Watch")} ${guide.title}`}
            onPress={() => launch(guide, false, "watch")}
            style={[styles.secondaryButton, { borderColor: accent }]}
          >
            <Ionicons name="play" size={15} color={colors.ink} />
            <Text preserveColor style={[styles.secondaryText, { color: colors.ink }]}>{t("Watch")}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(progress ? "Restart {name}" : "Start {name}").replace("{name}", guide.title)}
            onPress={() => launch(guide, false, "practice")}
            style={[styles.primaryButton, { backgroundColor: accent }]}
          >
            <Ionicons name={progress ? "refresh" : "hand-left"} size={15} color={onAccent} />
            <Text preserveColor style={[styles.primaryText, { color: onAccent }]}>{progress ? t("Start over") : t("Practice")}</Text>
          </Pressable>
        </View>
      </View>

    );
  }

  const basicGuide = localizedGuides.find((guide) => guide.id === "essential");
  const fullGuide = localizedGuides.find((guide) => guide.id === "full-app");
  const advancedGuides = ["module:display", "module:custom-metric"]
    .map((id) => localizedGuides.find((guide) => guide.id === id))
    .filter((guide): guide is TutorialGuide => Boolean(guide));

  return (
    <Screen contentContainerStyle={styles.page}>
      <View style={styles.content}>
      <PageHeader
        title={t("Guided tutorials")}
        subtitle={t("Learn at your pace. Watch a short tour or try it with safe demo data.")}
        showMenu={false}
        action={<IconButton icon="close" label="Close guide" onPress={() => router.back()} />}
      />

      <View style={[styles.promptSettings, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.promptSettingCopy}>
          <Text style={[styles.collectionTitle, { color: colors.ink }]}>{t("Automatic tutorial prompts")}</Text>
          <Text style={[styles.collectionDetail, { color: colors.muted }]}>{t("Turn off to skip all automatic tutorials. You can still start any guide below.")}</Text>
        </View>
        <Switch testID="tutorial-prompts-toggle" accessibilityLabel={t("Automatic tutorial prompts")} value={!state.settings.tutorialPromptsDisabled} onValueChange={(enabled) => updateSettings(enabled ? { tutorialPromptsDisabled: false } : skipAllTutorialsSettings())} trackColor={{ false: colors.border, true: accent }} />
      </View>

      {!activeSession ? (
        <Pressable
          testID="quick-guide-live-setup"
          accessibilityRole="button"
          onPress={() => {
            if (!state.settings.onboardingComplete) {
              router.replace("/onboarding" as never);
              return;
            }
            updateSettings({
              guidedSetupStep: activeLiveSetupStep(state.settings) ?? "trackers",
              tutorialPromptsDisabled: false,
              tutorialComplete: true,
              tutorialGuideId: undefined,
              tutorialGuideRunId: undefined,
            });
            router.replace("/" as never);
          }}
          style={[styles.liveSetupAction, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}
        >
          <Ionicons name="compass-outline" size={21} color={accent} />
          <Text preserveColor style={[styles.liveSetupActionText, { color: colors.ink }]}>{state.settings.tutorialPromptsDisabled ? t("Turn on tutorials and set up Today") : t("Set up Today interactively")}</Text>
          <Ionicons name="arrow-forward" size={17} color={accent} />
        </Pressable>
      ) : null}

      {basicJustCompleted ? (
        <View accessibilityRole="summary" style={[styles.completionHero, { backgroundColor: colors.primarySoft, borderColor: accent }]}>
          <View style={[styles.completionIcon, { backgroundColor: accent }]}>
            <Ionicons name="checkmark" size={23} color={onAccent} />
          </View>
          <View style={styles.completionCopy}>
            <Text accessibilityRole="header" style={[styles.completionTitle, { color: colors.ink }]}>{t("Basic guide complete")}</Text>
            <Text style={[styles.detail, { color: colors.muted }]}>{state.settings.tutorialPromptsDisabled ? t("No automatic tips on any page. Guides stay available in Quick Guide.") : t("You know the essentials. Explore freely: each page offers one short, skippable tour the first time you open it.")}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => router.replace("/" as never)} style={[styles.primaryButton, { backgroundColor: accent }]}>
            <Text preserveColor style={[styles.primaryText, { color: onAccent }]}>{t("Use HabHub")}</Text>
            <Ionicons name="arrow-forward" size={15} color={onAccent} />
          </Pressable>
        </View>
      ) : null}

      {!hydrated ? (
        <View accessibilityLiveRegion="polite" style={[styles.loading, { backgroundColor: colors.card }]}>
          <Text style={[styles.detail, { color: colors.muted }]}>{t("Loading your tutorial progress...")}</Text>
        </View>
      ) : (
        <>
          <View style={styles.sectionIntro}>
            <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t("Start here")}</Text>
            <Text style={[styles.sectionDetail, { color: colors.muted }]}>{t("A few everyday skills are enough to get started. Explore the rest whenever you need it.")}</Text>
          </View>
          {basicGuide ? guideCard(basicGuide, true) : null}

          <View style={styles.sectionIntro}>
            <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t("Browse focused guides")}</Text>
            <Text style={[styles.sectionDetail, { color: colors.muted }]}>{t("Optional pages stay out of the main navigation until you enable them in Display settings.")}</Text>
          </View>
          {GUIDE_GROUPS.map((group) => {
            const open = openGroups[group.id] === true;
            const groupGuides = group.guideIds
              .map((id) => localizedGuides.find((guide) => guide.id === id))
              .filter((guide): guide is TutorialGuide => Boolean(guide));
            return (
              <View key={group.id} style={[styles.collection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  onPress={() => setOpenGroups((current) => ({ ...current, [group.id]: !open }))}
                  style={styles.collectionHeader}
                >
                  <View style={[styles.collectionIcon, { backgroundColor: colors.primarySoft }]}>
                    <Ionicons name={group.icon as keyof typeof Ionicons.glyphMap} size={18} color={accent} />
                  </View>
                  <View style={styles.collectionCopy}>
                    <Text style={[styles.collectionTitle, { color: colors.ink }]}>{t(group.title)}</Text>
                    <Text style={[styles.collectionDetail, { color: colors.muted }]}>{t(group.detail)}</Text>
                  </View>
                  <View style={[styles.countPill, { backgroundColor: colors.primarySoft }]}>
                    <Text style={[styles.countText, { color: accent }]}>{groupGuides.length}</Text>
                  </View>
                  <Ionicons name={open ? "chevron-up" : "chevron-down"} size={17} color={colors.muted} />
                </Pressable>
                {open ? <View style={styles.collectionBody}>{groupGuides.map((guide) => guideCard(guide))}</View> : null}
              </View>
            );
          })}
          <View style={[styles.collection, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: openGroups.advanced === true }}
              onPress={() => setOpenGroups((current) => ({ ...current, advanced: !current.advanced }))}
              style={styles.collectionHeader}
            >
              <View style={[styles.collectionIcon, { backgroundColor: colors.primarySoft }]}>
                <Ionicons name="options-outline" size={18} color={accent} />
              </View>
              <View style={styles.collectionCopy}>
                <Text style={[styles.collectionTitle, { color: colors.ink }]}>{t("Advanced customization")}</Text>
                <Text style={[styles.collectionDetail, { color: colors.muted }]}>{t("Master display settings and build reusable custom metrics, formulas and tracker styles.")}</Text>
              </View>
              <Ionicons name={openGroups.advanced ? "chevron-up" : "chevron-down"} size={17} color={colors.muted} />
            </Pressable>
            {openGroups.advanced ? <View style={styles.collectionBody}>{advancedGuides.map((guide) => guideCard(guide))}</View> : null}
          </View>
          {fullGuide ? (
            <View style={[styles.collection, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Pressable
                testID="quick-guide-full-course"
                accessibilityRole="button"
                accessibilityState={{ expanded: openGroups.complete === true }}
                onPress={() => setOpenGroups((current) => ({ ...current, complete: !current.complete }))}
                style={styles.collectionHeader}
              >
                <View style={[styles.collectionIcon, { backgroundColor: colors.primarySoft }]}>
                  <Ionicons name="map-outline" size={18} color={accent} />
                </View>
                <View style={styles.collectionCopy}>
                  <Text style={[styles.collectionTitle, { color: colors.ink }]}>{fullGuide.title}</Text>
                  <Text style={[styles.collectionDetail, { color: colors.muted }]}>{t("Every feature, one guided journey. Pause and resume whenever you like.")}</Text>
                </View>
                <Ionicons name={openGroups.complete ? "chevron-up" : "chevron-down"} size={17} color={colors.muted} />
              </Pressable>
              {openGroups.complete ? <View style={styles.collectionBody}>{guideCard(fullGuide)}</View> : null}
            </View>
          ) : null}
        </>
      )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  promptSettings: { borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: "row", alignItems: "center", gap: 14 },
  promptSettingCopy: { flex: 1, minWidth: 0, gap: 4 },
  liveSetupAction: { minHeight: 52, borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  liveSetupActionText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "800" },
  page: { paddingBottom: 28 },
  content: { gap: 10 },
  completionHero: { borderWidth: 1, borderRadius: 20, padding: 14, gap: 10, alignItems: "flex-start" },
  completionIcon: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  completionCopy: { gap: 5 },
  completionTitle: { fontSize: 17, fontWeight: "900" },
  loading: { minHeight: 72, borderRadius: 17, padding: 16, justifyContent: "center" },
  sectionIntro: { marginTop: 8, gap: 3, paddingHorizontal: 2 },
  sectionTitle: { fontSize: 15, lineHeight: 20, fontWeight: "900" },
  sectionDetail: { fontSize: 12, lineHeight: 18 },
  featuredCard: { borderWidth: 1, borderRadius: 20, padding: 14, gap: 12 },
  card: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 11 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  icon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: "900" },
  detail: { fontSize: 12, lineHeight: 18 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  meta: { fontSize: 11, lineHeight: 16, fontWeight: "800" },
  progressTrack: { height: 4, borderRadius: 2, overflow: "hidden", marginTop: 2 },
  progressFill: { height: 4, borderRadius: 2 },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 7 },
  secondaryButton: { flexGrow: 1, minWidth: 100, minHeight: 44, borderWidth: 1, borderRadius: 11, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  secondaryText: { fontSize: 12, fontWeight: "900" },
  primaryButton: { flexGrow: 1, minWidth: 100, minHeight: 44, borderRadius: 11, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  primaryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  collection: { borderWidth: 1, borderRadius: 17, overflow: "hidden" },
  collectionHeader: { minHeight: 80, padding: 14, flexDirection: "row", alignItems: "center", gap: 11 },
  collectionIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  collectionCopy: { flex: 1, gap: 2 },
  collectionTitle: { fontSize: 14, lineHeight: 20, fontWeight: "900" },
  collectionDetail: { fontSize: 11, lineHeight: 17 },
  countPill: { minWidth: 27, height: 27, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  countText: { fontSize: 9, fontWeight: "900" },
  collectionBody: { padding: 9, paddingTop: 0, gap: 8 },
});
