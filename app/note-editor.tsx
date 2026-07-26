import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState } from "react";
import { Alert, Keyboard, Pressable, StyleSheet, View } from "react-native";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { InfoPopover } from "@/src/components/InfoPopover";
import { MetricSelector } from "@/src/components/MetricSelector";
import {
  RichNoteComposer,
  RichNoteComposerHandle,
} from "@/src/components/RichNoteComposer";
import { Card, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { dateKey } from "@/src/domain/date";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";

export default function NoteEditor() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { state, saveJournalNote, deleteJournalNote } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const existing = (state.journalNotes ?? []).find((note) => note.id === id);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [imageUri, setImageUri] = useState(existing?.imageUri);
  const [metricIds, setMetricIds] = useState(
    existing?.metricIds ?? (existing?.metricId ? [existing.metricId] : []),
  );
  const [labels, setLabels] = useState(existing?.labels ?? []);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const undo = useRef<string[]>([]);
  const redo = useRef<string[]>([]);
  const composer = useRef<RichNoteComposerHandle>(null);

  React.useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const change = (next: string) => {
    if (next === body) return;
    undo.current.push(body);
    if (undo.current.length > 50) undo.current.shift();
    redo.current = [];
    setBody(next);
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.82,
    });
    if (!result.canceled) setImageUri(result.assets[0].uri);
  };

  const save = () => {
    if (!body.trim())
      return Alert.alert("Write a note", "The note cannot be empty.");
    const now = new Date().toISOString();
    saveJournalNote({
      id: existing?.id ?? `note-${Date.now().toString(36)}`,
      userId: state.currentUserId,
      title: title.trim() || undefined,
      body: body.trim(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      localDate: existing?.localDate ?? dateKey(),
      metricIds,
      labels: [
        ...new Set([
          ...labels,
          ...[...body.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map(
            (match) => match[1],
          ),
        ]),
      ],
      imageUri,
    });
    router.back();
  };

  return (
    <Screen>
      <PageHeader
        title={existing ? "Edit note" : "New note"}
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => router.back()}
          />
        }
      />
      <Card style={styles.editor}>
        <View style={styles.linkHeading}>
          <Text style={[styles.linkTitle, { color: colors.ink }]}>
            Organize this note
          </Text>
          <InfoPopover
            label="How hashtags work"
            message="Type # followed by a word to create a searchable Journal label. Linking a tracker also groups this note with that tracker."
          />
        </View>
        <MetricSelector
          title="Trackers and labels"
          items={[
            ...state.metrics.map((metric) => ({
              id: `metric:${metric.id}`,
              label: metric.name,
              icon: metric.icon as keyof typeof Ionicons.glyphMap,
              color: metric.color,
              group: metric.grouping || "Trackers",
            })),
            ...[
              ...new Set(
                (state.journalNotes ?? []).flatMap((note) => note.labels ?? []),
              ),
            ].map((label) => ({
              id: `label:${label}`,
              label: `#${label}`,
              icon: "pricetag-outline" as const,
              group: "Labels",
            })),
          ]}
          selectedIds={[
            ...metricIds.map((metricId) => `metric:${metricId}`),
            ...labels.map((label) => `label:${label}`),
          ]}
          onChange={(ids) => {
            setMetricIds(
              ids
                .filter((item) => item.startsWith("metric:"))
                .map((item) => item.slice("metric:".length)),
            );
            setLabels(
              ids
                .filter((item) => item.startsWith("label:"))
                .map((item) => item.slice("label:".length)),
            );
          }}
          emptyLabel="No links"
          collapsibleGroups={[
            ...new Set(
              state.metrics.map((metric) => metric.grouping || "Trackers"),
            ),
            "Labels",
          ]}
        />
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Title (optional)"
          placeholderTextColor={colors.faint}
          style={[styles.title, { color: colors.ink, borderColor: colors.border }]}
        />
        {keyboardVisible ? (
          <View style={[styles.toolbar, { borderColor: colors.border }]}>
            <Tool
              icon="arrow-undo"
              onPress={() => {
                const previous = undo.current.pop();
                if (previous !== undefined) {
                  redo.current.push(body);
                  setBody(previous);
                }
              }}
            />
            <Tool
              icon="arrow-redo"
              onPress={() => {
                const next = redo.current.pop();
                if (next !== undefined) {
                  undo.current.push(body);
                  setBody(next);
                }
              }}
            />
            <Tool text="H1" onPress={() => composer.current?.setBlock("h1")} />
            <Tool text="H2" onPress={() => composer.current?.setBlock("h2")} />
            <Tool
              text="B"
              onPress={() => composer.current?.toggleInline("bold")}
            />
            <Tool
              text="I"
              onPress={() => composer.current?.toggleInline("italic")}
            />
            <Tool
              text="S"
              onPress={() => composer.current?.toggleInline("strike")}
            />
            <Tool
              icon="list"
              onPress={() => composer.current?.setBlock("bullet")}
            />
            <Tool
              icon="checkbox-outline"
              onPress={() => composer.current?.setBlock("check")}
            />
            <Tool
              icon="chatbox-outline"
              onPress={() => composer.current?.setBlock("quote")}
            />
            <Tool
              icon="link-outline"
              onPress={() => composer.current?.toggleInline("link")}
            />
          </View>
        ) : null}
        <RichNoteComposer ref={composer} value={body} onChange={change} />
        {imageUri ? <Image source={imageUri} style={styles.image} /> : null}
        <Pressable onPress={pickImage} style={styles.imageButton}>
          <Ionicons name="image-outline" size={17} color={accent} />
          <Text style={[styles.imageText, { color: accent }]}>
            {imageUri ? "Change image" : "Add image"}
          </Text>
        </Pressable>
      </Card>
      <Pressable
        onPress={save}
        style={[styles.save, { backgroundColor: accent }]}
      >
        <Text style={styles.saveText}>Save note</Text>
      </Pressable>
      {existing ? (
        <Pressable
          onPress={() =>
            Alert.alert("Delete note?", undefined, [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => {
                  deleteJournalNote(existing.id);
                  router.back();
                },
              },
            ])
          }
          style={styles.delete}
        >
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

function Tool({
  icon,
  text,
  onPress,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  text?: string;
  onPress: () => void;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tool, { backgroundColor: colors.canvas }]}
    >
      {icon ? (
        <Ionicons name={icon} size={14} color={colors.ink} />
      ) : (
        <Text style={[styles.toolText, { color: colors.ink }]}>{text}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  editor: { gap: 8 },
  linkHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  linkTitle: { fontSize: 10, fontWeight: "900" },
  title: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    fontSize: 12,
    fontWeight: "900",
  },
  toolbar: {
    minHeight: 37,
    borderWidth: 1,
    borderRadius: 11,
    padding: 4,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  tool: {
    minWidth: 29,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  toolText: { fontSize: 8, fontWeight: "900" },
  image: { width: "100%", height: 190, borderRadius: 12 },
  imageButton: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  imageText: { fontSize: 9, fontWeight: "900" },
  save: {
    minHeight: 46,
    marginTop: 8,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  delete: { minHeight: 42, alignItems: "center", justifyContent: "center" },
  deleteText: { color: "#C44949", fontSize: 9, fontWeight: "900" },
});
