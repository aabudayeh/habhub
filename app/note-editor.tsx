import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { Card, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { RichNoteText } from "@/src/components/RichNoteText";
import { MetricSelector } from "@/src/components/MetricSelector";
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
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const undo = useRef<string[]>([]);
  const redo = useRef<string[]>([]);
  const tagMatch = body
    .slice(0, selection.start)
    .match(/(?:^|\s)#([\p{L}\p{N}_ -]*)$/u);
  const tagMatches = tagMatch
    ? state.metrics
        .filter((metric) =>
          metric.name
            .toLocaleLowerCase()
            .includes(tagMatch[1].trim().toLocaleLowerCase()),
        )
        .slice(0, 6)
    : [];
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
  const change = (raw: string) => {
    const next = continueMarkdownList(body, raw);
    undo.current.push(body);
    if (undo.current.length > 50) undo.current.shift();
    redo.current = [];
    setBody(next);
  };
  const format = (before: string, after = before) => {
    const selected = body.slice(selection.start, selection.end);
    change(
      `${body.slice(0, selection.start)}${before}${selected || "text"}${after}${body.slice(selection.end)}`,
    );
  };
  const prefix = (value: string) => {
    const start = body.lastIndexOf("\n", Math.max(0, selection.start - 1)) + 1;
    change(`${body.slice(0, start)}${value}${body.slice(start)}`);
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
        ...new Set(
          [...body.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map(
            (match) => match[1],
          ),
        ),
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
        action={<IconButton icon="close" label="Close" onPress={() => router.back()} />}
      />
      <Card style={styles.editor}>
        {body.trim() ? (
          <View
            style={[
              styles.preview,
              { borderColor: colors.border, backgroundColor: colors.canvas },
            ]}
          >
            <Text style={[styles.previewLabel, { color: colors.muted }]}>
              NOTE PREVIEW · TAP CHECKBOXES TO COMPLETE
            </Text>
            <RichNoteText
              body={body}
              onToggleChecklist={(lineIndex) => {
                const lines = body.split("\n");
                lines[lineIndex] = lines[lineIndex].replace(
                  /^(\s*[-*]\s+\[)([ xX])(\])/,
                  (_, start, checked, end) =>
                    `${start}${checked.toLowerCase() === "x" ? " " : "x"}${end}`,
                );
                change(lines.join("\n"));
              }}
            />
          </View>
        ) : null}
        <MetricSelector
          title="Link trackers"
          items={state.metrics.map((metric) => ({
            id: metric.id,
            label: metric.name,
            icon: metric.icon as keyof typeof Ionicons.glyphMap,
            color: metric.color,
            group: metric.grouping || "Trackers",
          }))}
          selectedIds={metricIds}
          onChange={setMetricIds}
          emptyLabel="No tracker labels"
          collapsibleGroups={[
            ...new Set(
              state.metrics.map((metric) => metric.grouping || "Trackers"),
            ),
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
            <Tool icon="arrow-undo" onPress={() => {
              const previous = undo.current.pop();
              if (previous !== undefined) {
                redo.current.push(body);
                setBody(previous);
              }
            }} />
            <Tool icon="arrow-redo" onPress={() => {
              const next = redo.current.pop();
              if (next !== undefined) {
                undo.current.push(body);
                setBody(next);
              }
            }} />
            <Tool text="H1" onPress={() => prefix("# ")} />
            <Tool text="H2" onPress={() => prefix("## ")} />
            <Tool text="B" onPress={() => format("**")} />
            <Tool text="I" onPress={() => format("_")} />
            <Tool text="S" onPress={() => format("~~")} />
            <Tool icon="list" onPress={() => prefix("- ")} />
            <Tool icon="checkbox-outline" onPress={() => prefix("- [ ] ")} />
            <Tool icon="chatbox-outline" onPress={() => prefix("> ")} />
            <Tool icon="link-outline" onPress={() => format("[", "](https://)")} />
          </View>
        ) : null}
        <TextInput
          value={body}
          onChangeText={change}
          onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
          placeholder="Write anything…"
          placeholderTextColor={colors.faint}
          multiline
          textAlignVertical="top"
          style={[
            styles.body,
            { color: colors.ink, borderColor: colors.border },
          ]}
        />
        {tagMatches.length ? (
          <View style={[styles.tagMenu, { borderColor: colors.border }]}>
            {tagMatches.map((metric) => (
              <Pressable
                key={metric.id}
                onPress={() => {
                  const start = selection.start - tagMatch![0].trimStart().length;
                  const tag = `#${metric.name.replace(/\s+/g, "_")} `;
                  setBody(
                    `${body.slice(0, start)}${tag}${body.slice(selection.start)}`,
                  );
                  setMetricIds((current) =>
                    current.includes(metric.id)
                      ? current
                      : [...current, metric.id],
                  );
                }}
                style={styles.tagRow}
              >
                <Ionicons name={metric.icon as keyof typeof Ionicons.glyphMap} size={15} color={metric.color} />
                <Text style={[styles.imageText, { color: colors.ink }]}>
                  {metric.name}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {imageUri ? <Image source={imageUri} style={styles.image} /> : null}
        <Pressable onPress={pickImage} style={styles.imageButton}>
          <Ionicons name="image-outline" size={17} color={accent} />
          <Text style={[styles.imageText, { color: accent }]}>
            {imageUri ? "Change image" : "Add image"}
          </Text>
        </Pressable>
      </Card>
      <Pressable onPress={save} style={[styles.save, { backgroundColor: accent }]}>
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

function continueMarkdownList(previous: string, next: string) {
  if (next.length !== previous.length + 1) return next;
  let changedAt = 0;
  while (
    changedAt < previous.length &&
    previous[changedAt] === next[changedAt]
  )
    changedAt += 1;
  if (next[changedAt] !== "\n") return next;
  const lineStart = previous.lastIndexOf("\n", changedAt - 1) + 1;
  const previousLine = previous.slice(lineStart, changedAt);
  const match = previousLine.match(
    /^(\s*)(-\s\[[ xX]\]\s|\d+\. |[-*+] |>\s)(.*)$/,
  );
  if (!match) return next;
  if (!match[3].trim())
    return `${next.slice(0, lineStart)}${next.slice(changedAt)}`;
  const marker = /^\d+\.\s$/.test(match[2])
    ? `${Number.parseInt(match[2], 10) + 1}. `
    : /^-\s\[[ xX]\]\s$/.test(match[2])
      ? "- [ ] "
      : match[2];
  return `${next.slice(0, changedAt + 1)}${match[1]}${marker}${next.slice(
    changedAt + 1,
  )}`;
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
  body: {
    minHeight: 260,
    borderWidth: 1,
    borderRadius: 12,
    padding: 11,
    fontSize: 10,
    lineHeight: 16,
  },
  preview: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 11,
    gap: 7,
  },
  previewLabel: { fontSize: 7, fontWeight: "900", letterSpacing: 0.8 },
  tagMenu: { borderWidth: 1, borderRadius: 11, padding: 5, gap: 2 },
  tagRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 7,
  },
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
