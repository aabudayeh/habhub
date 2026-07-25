import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { Card, Chip, PageHeader, Screen } from "@/src/components/ui";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";

type JournalItem = {
  id: string;
  title: string;
  body: string;
  localDate: string;
  createdAt: string;
  metricId?: string;
  imageUri?: string;
  editable: boolean;
};

export default function JournalPage() {
  const { state } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const items = useMemo<JournalItem[]>(() => {
    const general = (state.journalNotes ?? []).map((note) => ({
      id: note.id,
      title: note.title || "General note",
      body: note.body,
      localDate: note.localDate,
      createdAt: note.createdAt,
      metricId: note.metricId,
      imageUri: note.imageUri,
      editable: true,
    }));
    const entries = state.entries
      .filter(
        (entry) =>
          entry.userId === state.currentUserId &&
          Boolean(entry.note?.trim()),
      )
      .map((entry) => {
        const metric = state.metrics.find(
          (candidate) => candidate.id === entry.metricId,
        );
        return {
          id: `entry:${entry.id}`,
          title: metric?.name ?? "Tracker note",
          body: entry.note!,
          localDate: entry.localDate,
          createdAt: entry.recordedAt,
          metricId: entry.metricId,
          imageUri: entry.imageUri,
          editable: false,
        };
      });
    const normalized = query.trim().toLocaleLowerCase();
    return [...general, ...entries]
      .filter(
        (item) =>
          (filter === "all" ||
            (filter === "general" && !item.metricId) ||
            item.metricId === filter) &&
          (!normalized ||
            `${item.title} ${item.body} ${item.localDate}`
              .toLocaleLowerCase()
              .includes(normalized)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [
    filter,
    query,
    state.entries,
    state.journalNotes,
    state.metrics,
    state.currentUserId,
  ]);
  const labels = state.metrics.filter((metric) =>
    state.entries.some(
      (entry) => entry.metricId === metric.id && Boolean(entry.note?.trim()),
    ),
  );
  return (
    <Screen>
      <PageHeader
        title="Journal"
        action={
          <Pressable
            onPress={() => router.navigate("/note-editor" as never)}
            style={[styles.add, { backgroundColor: accent }]}
          >
            <Ionicons name="add" size={18} color="#FFFFFF" />
          </Pressable>
        }
      />
      <View
        style={[
          styles.search,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Ionicons name="search-outline" size={17} color={colors.faint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search every note"
          placeholderTextColor={colors.faint}
          style={[styles.searchInput, { color: colors.ink }]}
        />
      </View>
      <View style={styles.filters}>
        <Chip label="All" selected={filter === "all"} onPress={() => setFilter("all")} />
        <Chip
          label="General"
          selected={filter === "general"}
          onPress={() => setFilter("general")}
        />
        {labels.slice(0, 5).map((metric) => (
          <Chip
            key={metric.id}
            label={metric.name}
            selected={filter === metric.id}
            onPress={() => setFilter(metric.id)}
          />
        ))}
      </View>
      <View style={styles.notes}>
        {items.map((item) => (
          <Pressable
            key={item.id}
            onPress={() =>
              item.editable
                ? router.navigate({
                    pathname: "/note-editor",
                    params: { id: item.id },
                  } as never)
                : router.navigate({
                    pathname: "/metric-detail",
                    params: { metric: item.metricId, date: item.localDate },
                  } as never)
            }
          >
            <Card style={styles.note}>
              <View style={styles.noteHeading}>
                <View style={styles.copy}>
                  <Text style={[styles.noteTitle, { color: colors.ink }]}>
                    {item.title}
                  </Text>
                  <Text style={[styles.noteDate, { color: colors.muted }]}>
                    {new Date(`${item.localDate}T12:00:00`).toLocaleDateString(
                      undefined,
                      { dateStyle: "medium" },
                    )}
                  </Text>
                </View>
                <Ionicons
                  name={item.editable ? "create-outline" : "open-outline"}
                  size={15}
                  color={accent}
                />
              </View>
              <Text
                numberOfLines={4}
                style={[styles.noteBody, { color: colors.muted }]}
              >
                {item.body}
              </Text>
              {item.imageUri ? (
                <Image source={item.imageUri} style={styles.image} />
              ) : null}
            </Card>
          </Pressable>
        ))}
        {!items.length ? (
          <Card>
            <Text style={[styles.empty, { color: colors.muted }]}>
              No matching notes yet.
            </Text>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  add: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  search: {
    minHeight: 43,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  searchInput: { flex: 1, fontSize: 10, fontWeight: "700" },
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    marginVertical: 8,
  },
  notes: { gap: 7 },
  note: { gap: 7 },
  noteHeading: { flexDirection: "row", alignItems: "center" },
  copy: { flex: 1 },
  noteTitle: { fontSize: 10, fontWeight: "900" },
  noteDate: { fontSize: 7, marginTop: 2 },
  noteBody: { fontSize: 9, lineHeight: 14 },
  image: { width: "100%", height: 120, borderRadius: 12 },
  empty: { textAlign: "center", fontSize: 9, fontWeight: "700" },
});
