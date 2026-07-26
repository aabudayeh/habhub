import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import React, { useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { InfoPopover } from "@/src/components/InfoPopover";
import { SelectionMenu } from "@/src/components/SelectionMenu";
import {
  RichNoteComposer,
  RichNoteComposerHandle,
} from "@/src/components/RichNoteComposer";
import { Card, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { dateKey } from "@/src/domain/date";
import { trackerGroupLabel } from "@/src/domain/trackerCatalog";
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
  const [composerFocused, setComposerFocused] = useState(false);
  const [hashtagQuery, setHashtagQuery] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("https://");
  const undo = useRef<string[]>([]);
  const redo = useRef<string[]>([]);
  const composer = useRef<RichNoteComposerHandle>(null);
  const existingLabels = [
    ...new Set(
      (state.journalNotes ?? []).flatMap((note) => note.labels ?? []),
    ),
  ];
  const normalizedHashtagQuery = hashtagQuery?.toLocaleLowerCase() ?? "";
  const hashtagSuggestions =
    hashtagQuery === null
      ? []
      : [
          ...state.metrics
            .filter((metric) =>
              metric.name
                .toLocaleLowerCase()
                .includes(normalizedHashtagQuery),
            )
            .map((metric) => ({
              id: `metric:${metric.id}`,
              label: metric.name,
              icon: metric.icon as keyof typeof Ionicons.glyphMap,
              color: metric.color,
              metricId: metric.id,
            })),
          ...existingLabels
            .filter(
              (label) =>
                label.toLocaleLowerCase().includes(normalizedHashtagQuery) &&
                !state.metrics.some(
                  (metric) =>
                    metric.name.replace(/\s+/g, "_").toLocaleLowerCase() ===
                    label.toLocaleLowerCase(),
                ),
            )
            .map((label) => ({
              id: `label:${label}`,
              label,
              icon: "pricetag-outline" as const,
              color: accent,
              metricId: undefined,
            })),
        ].slice(0, 6);

  React.useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardVisible(false);
      setComposerFocused(false);
    });
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
    const cleanBody = body.replaceAll("\u200B", "");
    if (!cleanBody.trim())
      return Alert.alert("Write a note", "The note cannot be empty.");
    const now = new Date().toISOString();
    saveJournalNote({
      id: existing?.id ?? `note-${Date.now().toString(36)}`,
      userId: state.currentUserId,
      title: title.trim() || undefined,
      body: cleanBody.trim(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      localDate: existing?.localDate ?? dateKey(),
      metricIds,
      labels: [
        ...new Set([
          ...labels,
          ...[...cleanBody.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map(
            (match) => match[1],
          ),
        ]),
      ],
      imageUri,
    });
    router.back();
  };

  const toolbar = (
    <View
      style={[
        styles.toolbar,
        {
          borderColor: colors.border,
          backgroundColor: colors.card,
        },
      ]}
    >
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
      <Tool text="B" onPress={() => composer.current?.toggleInline("bold")} />
      <Tool text="I" onPress={() => composer.current?.toggleInline("italic")} />
      <Tool text="S" onPress={() => composer.current?.toggleInline("strike")} />
      <Tool icon="list" onPress={() => composer.current?.setBlock("bullet")} />
      <Tool
        icon="checkbox-outline"
        onPress={() => composer.current?.setBlock("check")}
      />
      <Tool
        icon="chatbox-outline"
        onPress={() => composer.current?.setBlock("quote")}
      />
      <Tool icon="link-outline" onPress={() => setLinkOpen(true)} />
    </View>
  );
  const editorTools = (
    <View style={styles.editorTools}>
      {toolbar}
      {hashtagSuggestions.length ? (
        <View
          style={[
            styles.tagMenu,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
        >
          {hashtagSuggestions.map((suggestion) => (
            <Pressable
              key={suggestion.id}
              onPress={() => {
                composer.current?.replaceHashtag(suggestion.label);
                if (suggestion.metricId) {
                  setMetricIds((current) =>
                    current.includes(suggestion.metricId!)
                      ? current
                      : [...current, suggestion.metricId!],
                  );
                } else {
                  setLabels((current) =>
                    current.includes(suggestion.label)
                      ? current
                      : [...current, suggestion.label],
                  );
                }
              }}
              style={styles.tagRow}
            >
              <Ionicons
                name={suggestion.icon}
                size={15}
                color={suggestion.color}
              />
              <Text style={[styles.tagText, { color: colors.ink }]}>
                #{suggestion.label.replace(/\s+/g, "_")}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <>
    <Screen
      fixedTop={
        keyboardVisible || composerFocused ? editorTools : undefined
      }
      keyboardDismissMode="none"
      contentContainerStyle={keyboardVisible ? styles.keyboardContent : undefined}
    >
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
        <SelectionMenu
          title="Trackers and labels"
          items={[
            ...state.metrics.map((metric) => ({
              id: `metric:${metric.id}`,
              label: metric.name,
              icon: metric.icon as keyof typeof Ionicons.glyphMap,
              color: metric.color,
              group: trackerGroupLabel(metric),
            })),
            ...[
              ...existingLabels,
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
        />
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Title (optional)"
          placeholderTextColor={colors.faint}
          style={[styles.title, { color: colors.ink, borderColor: colors.border }]}
        />
        <RichNoteComposer
          ref={composer}
          value={body}
          onChange={change}
          onEditingChange={setComposerFocused}
          onHashtagQuery={setHashtagQuery}
        />
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
    <Modal
      transparent
      visible={linkOpen}
      animationType="fade"
      onRequestClose={() => setLinkOpen(false)}
    >
      <Pressable style={styles.linkBackdrop} onPress={() => setLinkOpen(false)}>
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={[styles.linkCard, { backgroundColor: colors.card }]}
        >
          <Text style={[styles.linkModalTitle, { color: colors.ink }]}>
            Insert hyperlink
          </Text>
          <TextInput
            value={linkText}
            onChangeText={setLinkText}
            placeholder="Text to display"
            placeholderTextColor={colors.faint}
            style={[
              styles.linkInput,
              { color: colors.ink, borderColor: colors.border },
            ]}
          />
          <TextInput
            value={linkUrl}
            onChangeText={setLinkUrl}
            autoCapitalize="none"
            keyboardType="url"
            placeholder="https://example.com"
            placeholderTextColor={colors.faint}
            style={[
              styles.linkInput,
              { color: colors.ink, borderColor: colors.border },
            ]}
          />
          <View style={styles.linkActions}>
            <Pressable onPress={() => setLinkOpen(false)} style={styles.linkAction}>
              <Text style={[styles.linkActionText, { color: colors.muted }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                const text = linkText.trim();
                const rawUrl = linkUrl.trim();
                if (!text || !rawUrl) return;
                const url = /^[a-z][a-z0-9+.-]*:/i.test(rawUrl)
                  ? rawUrl
                  : `https://${rawUrl}`;
                composer.current?.insertLink(text, url);
                setLinkText("");
                setLinkUrl("https://");
                setLinkOpen(false);
              }}
              style={[styles.linkAction, { backgroundColor: accent }]}
            >
              <Text preserveColor style={styles.linkSaveText}>Insert</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
    </>
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
  keyboardContent: { paddingBottom: 64 },
  editor: { gap: 8 },
  editorTools: { gap: 5 },
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
    shadowColor: "#000000",
    shadowOpacity: 0.16,
    shadowRadius: 8,
    elevation: 10,
  },
  tagMenu: {
    borderWidth: 1,
    borderRadius: 11,
    padding: 4,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 3,
  },
  tagRow: {
    minHeight: 30,
    maxWidth: "100%",
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 7,
  },
  tagText: { fontSize: 9, fontWeight: "800" },
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
  linkBackdrop: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,.48)",
    padding: 18,
  },
  linkCard: { borderRadius: 18, padding: 15, gap: 9 },
  linkModalTitle: { fontSize: 13, fontWeight: "900" },
  linkInput: {
    minHeight: 43,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    fontSize: 10,
  },
  linkActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 7,
    marginTop: 2,
  },
  linkAction: {
    minWidth: 76,
    minHeight: 39,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  linkActionText: { fontSize: 9, fontWeight: "900" },
  linkSaveText: { color: "#FFFFFF", fontSize: 9, fontWeight: "900" },
});
