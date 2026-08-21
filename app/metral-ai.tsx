import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { LocalizedAlert as Alert } from "@/src/i18n";
import { Card, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { dateKey } from "@/src/domain/date";
import { supabase } from "@/src/lib/supabase";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import { NutritionDetails } from "@/src/types";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";

type NutritionEstimate = NutritionDetails & {
  calories: number;
  foodName?: string;
  confidence?: "low" | "medium" | "high";
};

export default function MetRalAiScreen() {
  const tutorialSandbox = useTutorialSandboxActive();
  const {
    state,
    logMetric,
    addMetric,
    saveTodo,
    saveCalendarReminder,
  } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [input, setInput] = useState("");
  const [reply, setReply] = useState(
    "Ask me to log a tracker, create a to-do, make a simple tracker, or set a reminder. Food-photo estimates always require your confirmation.",
  );
  const [working, setWorking] = useState(false);
  const [estimate, setEstimate] = useState<NutritionEstimate | null>(null);

  function handleLocalCommand(text: string) {
    const todo = text.match(/^(?:add|create)\s+(?:a\s+)?to-?do[:\s]+(.+)$/i);
    if (todo) {
      const now = new Date().toISOString();
      saveTodo({
        id: `todo-${Date.now().toString(36)}`,
        title: todo[1].trim(),
        createdAt: now,
        priority: "normal",
        reminders: [],
        completedDates: [],
      });
      return `Added “${todo[1].trim()}” to your to-dos.`;
    }
    const log = text.match(
      /^(?:log|record)\s+(-?\d+(?:[.,]\d+)?)\s*(?:\w+\s+)?(?:for\s+)?(.+)$/i,
    );
    if (log) {
      const value = Number(log[1].replace(",", "."));
      const query = log[2].trim().toLowerCase();
      const metric = state.metrics.find(
        (item) =>
          item.id.toLowerCase() === query ||
          item.name.toLowerCase() === query ||
          item.name.toLowerCase().includes(query),
      );
      if (metric && metric.manualEntry !== false) {
        logMetric(metric.id, value, metric.defaultVisibility, "add", {
          localDate: dateKey(),
          note: "Logged with MetRal AI",
        });
        return `Logged ${value} ${metric.unit} for ${metric.name}.`;
      }
    }
    const create = text.match(
      /^create\s+(?:a\s+)?tracker[:\s]+(.+?)(?:\s+goal\s+(\d+(?:[.,]\d+)?))?$/i,
    );
    if (create) {
      const target = Number((create[2] ?? "1").replace(",", "."));
      addMetric({
        name: create[1].trim(),
        icon: "sparkles-outline",
        color: "#5A78C9",
        unit: "",
        dataType: "number",
        aggregation: "sum",
        goal: { kind: "at_least", target },
        goalEnabled: true,
        rankingDirection: "higher",
        defaultVisibility: "group",
        category: "other",
        manualEntry: true,
        goalSchedule: { mode: "daily" },
        reminder: { enabled: false, time: "19:00" },
        reminders: [],
        addToToday: true,
      });
      return `Created ${create[1].trim()} with a target of ${target}. You can refine it in Customize trackers.`;
    }
    const reminder = text.match(
      /^remind me (?:at\s+)?(\d{1,2}:\d{2})\s+(?:to\s+)?(.+)$/i,
    );
    if (reminder) {
      const time = reminder[1].padStart(5, "0");
      saveCalendarReminder({
        id: `calendar-${Date.now().toString(36)}`,
        title: reminder[2].trim(),
        kind: "general",
        time,
        enabled: true,
        schedule: { mode: "daily", anchorDate: dateKey() },
      });
      return `Scheduled “${reminder[2].trim()}” every day at ${time}.`;
    }
    return undefined;
  }

  async function ask() {
    const text = input.trim();
    if (!text) return;
    const local = handleLocalCommand(text);
    setInput("");
    if (local) {
      setReply(local);
      return;
    }
    if (tutorialSandbox || !supabase) {
      setReply(
        "That request needs the optional cloud AI function. Local commands still work: “log 30 reading”, “add todo buy groceries”, “create tracker meditation goal 10”, or “remind me 19:00 to stretch”.",
      );
      return;
    }
    setWorking(true);
    const { data, error } = await supabase.functions.invoke("metral-ai", {
      body: {
        mode: "chat",
        text,
        context: {
          trackerNames: state.metrics.map((metric) => metric.name).slice(0, 50),
        },
      },
    });
    setWorking(false);
    setReply(
      error
        ? "Cloud AI is not configured yet. Add the server-side AI provider secrets; no API key is stored in the app."
        : String(data?.text ?? "I could not produce a response."),
    );
  }

  async function chooseFoodPhoto() {
    if (tutorialSandbox) {
      setReply(
        "Photo picking and cloud estimation are disabled in this practice preview. Your real library and account stay untouched.",
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.72,
      base64: true,
    });
    if (result.canceled) return;
    if (!supabase) {
      Alert.alert(
        "Cloud AI is not configured",
        "Food-photo estimation runs through the private server function, never through an API key embedded in the app.",
      );
      return;
    }
    setWorking(true);
    const asset = result.assets[0];
    const { data, error } = await supabase.functions.invoke("metral-ai", {
      body: {
        mode: "nutrition",
        imageBase64: asset.base64,
        mimeType: asset.mimeType ?? "image/jpeg",
      },
    });
    setWorking(false);
    if (error || !data?.nutrition) {
      setReply("The food estimate was unavailable. You can still search or log it manually.");
      return;
    }
    setEstimate(data.nutrition as NutritionEstimate);
    setReply(
      "Review this estimate carefully. Portions and hidden ingredients can make photo estimates inaccurate.",
    );
  }

  function logEstimate() {
    if (!estimate) return;
    logMetric("food", Math.max(0, estimate.calories), "group", "add", {
      localDate: dateKey(),
      note: `AI photo estimate${estimate.confidence ? ` · ${estimate.confidence} confidence` : ""}`,
      label: estimate.foodName ?? "Food photo estimate",
      nutrition: estimate,
    });
    setReply("Food estimate logged. You can edit or delete the entry from Food history.");
    setEstimate(null);
  }

  return (
    <Screen keyboardShouldPersistTaps="handled">
      <PageHeader
        title="MetRal AI"
        subtitle="Assistant preview · estimates are not medical advice"
        showMenu={false}
        action={
          <IconButton icon="close" label="Close" onPress={() => router.back()} />
        }
      />
      <Card style={styles.reply}>
        <View style={[styles.aiIcon, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="sparkles" size={18} color={accent} />
        </View>
        <Text style={[styles.replyText, { color: colors.ink }]}>{reply}</Text>
      </Card>
      {estimate ? (
        <Card style={styles.estimate}>
          <Text style={[styles.estimateTitle, { color: colors.ink }]}>
            {estimate.foodName ?? "Estimated meal"}
          </Text>
          <Text style={[styles.value, { color: accent }]}>
            ~{Math.round(estimate.calories)} kcal
          </Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            Protein {Math.round(estimate.proteinG ?? 0)}g · Carbs{" "}
            {Math.round(estimate.carbsG ?? 0)}g · Fat{" "}
            {Math.round(estimate.fatG ?? 0)}g
          </Text>
          <Pressable
            onPress={logEstimate}
            style={[styles.primary, { backgroundColor: accent }]}
          >
            <Text style={styles.primaryText}>Confirm and log</Text>
          </Pressable>
        </Card>
      ) : null}
      <Card style={styles.composer}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="What would you like to do?"
          placeholderTextColor={colors.faint}
          multiline
          style={[
            styles.input,
            { color: colors.ink, borderColor: colors.border },
          ]}
        />
        <View style={styles.actions}>
          <Pressable
            onPress={chooseFoodPhoto}
            style={[styles.secondary, { borderColor: accent }]}
          >
            <Ionicons name="camera-outline" size={17} color={accent} />
            <Text style={[styles.secondaryText, { color: accent }]}>
              Food photo
            </Text>
          </Pressable>
          <Pressable
            onPress={() =>
              Alert.alert(
                "Voice is prepared for the next connector",
                "The command layer is ready, but microphone transcription needs a server speech provider. No recording is uploaded until that provider is configured.",
              )
            }
            style={[styles.secondary, { borderColor: colors.border }]}
          >
            <Ionicons name="mic-outline" size={17} color={colors.muted} />
            <Text style={[styles.secondaryText, { color: colors.muted }]}>
              Voice
            </Text>
          </Pressable>
          <Pressable
            disabled={working || !input.trim()}
            onPress={ask}
            style={[
              styles.send,
              { backgroundColor: accent },
              (working || !input.trim()) && styles.disabled,
            ]}
          >
            <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  reply: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  aiIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  replyText: { flex: 1, fontSize: 10, lineHeight: 16, fontWeight: "700" },
  estimate: { gap: 6 },
  estimateTitle: { fontSize: 12, fontWeight: "900" },
  value: { fontSize: 22, fontWeight: "900" },
  meta: { fontSize: 9, fontWeight: "700" },
  primary: {
    minHeight: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 5,
  },
  primaryText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
  composer: { gap: 9 },
  input: {
    minHeight: 100,
    borderWidth: 1,
    borderRadius: 14,
    padding: 11,
    fontSize: 11,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", alignItems: "center", gap: 6 },
  secondary: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  secondaryText: { fontSize: 8, fontWeight: "900" },
  send: {
    marginLeft: "auto",
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.45 },
});
