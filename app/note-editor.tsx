import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
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
import { LocalizedAlert as Alert } from "@/src/i18n";
import { InfoPopover } from "@/src/components/InfoPopover";
import { SelectionMenu } from "@/src/components/SelectionMenu";
import {
  cleanRichNoteValue,
  RichNoteComposer,
  RichNoteComposerHandle,
  richNoteHasText,
} from "@/src/components/RichNoteComposer";
import { Card, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { useWebBeforeUnload } from "@/src/components/useWebBeforeUnload";
import { dateKey } from "@/src/domain/date";
import { trackerGroupLabel } from "@/src/domain/trackerCatalog";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";

export default function NoteEditor() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const navigation = useNavigation();
  const { state, saveJournalNote, deleteJournalNote } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const existing = (state.journalNotes ?? []).find((note) => note.id === id);
  const [title, setTitle] = useState(existing?.title ?? "");
  const initialBody = existing?.body ?? "";
  const body = useRef(initialBody);
  const [imageUri, setImageUri] = useState(existing?.imageUri);
  const [metricIds, setMetricIds] = useState(
    existing?.metricIds ?? (existing?.metricId ? [existing.metricId] : []),
  );
  const [labels, setLabels] = useState(existing?.labels ?? []);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [hashtagQuery, setHashtagQuery] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [textColorOpen, setTextColorOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("https://");
  const undo = useRef<string[]>([]);
  const redo = useRef<string[]>([]);
  const lastUndoAt = useRef(0);
  const composer = useRef<RichNoteComposerHandle>(null);
  const allowExit = useRef(false);
  const promptOpen = useRef(false);
  const initialContent = useRef({
    title,
    body: cleanRichNoteValue(initialBody),
    imageUri,
    metricIds: [...metricIds].sort(),
    labels: [...labels].sort(),
  }).current;
  const existingLabels = [
    ...new Set((state.journalNotes ?? []).flatMap((note) => note.labels ?? [])),
  ];
  const normalizedHashtagQuery = hashtagQuery?.toLocaleLowerCase() ?? "";
  const hashtagSuggestions =
    hashtagQuery === null
      ? []
      : [
          ...state.metrics
            .filter((metric) =>
              metric.name.toLocaleLowerCase().includes(normalizedHashtagQuery),
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

  const change = useCallback((next: string) => {
    if (next === body.current) return;
    const now = Date.now();
    const structuralChange =
      next.split("\n").length !== body.current.split("\n").length;
    if (
      !undo.current.length ||
      structuralChange ||
      now - lastUndoAt.current > 700
    ) {
      undo.current.push(body.current);
      if (undo.current.length > 50) undo.current.shift();
      lastUndoAt.current = now;
    }
    body.current = next;
    redo.current = [];
  }, []);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.82,
    });
    if (!result.canceled) setImageUri(result.assets[0].uri);
  };

  const hasUnsavedChanges = () => {
    const sameValues = (current: string[], initial: string[]) => {
      const normalized = [...current].sort();
      return (
        normalized.length === initial.length &&
        normalized.every((value, index) => value === initial[index])
      );
    };
    return (
      title !== initialContent.title ||
      cleanRichNoteValue(body.current) !== initialContent.body ||
      imageUri !== initialContent.imageUri ||
      !sameValues(metricIds, initialContent.metricIds) ||
      !sameValues(labels, initialContent.labels)
    );
  };
  const hasUnsavedChangesRef = useRef(hasUnsavedChanges);
  hasUnsavedChangesRef.current = hasUnsavedChanges;
  useWebBeforeUnload(
    () => !allowExit.current && hasUnsavedChangesRef.current(),
  );

  const leave = (exit: () => void) => {
    allowExit.current = true;
    promptOpen.current = false;
    exit();
    setTimeout(() => {
      allowExit.current = false;
    }, 0);
  };

  const save = (exit: () => void = () => router.back()) => {
    const cleanBody = cleanRichNoteValue(body.current);
    if (!richNoteHasText(cleanBody)) {
      promptOpen.current = false;
      Alert.alert("Write a note", "The note cannot be empty.");
      return false;
    }
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
    leave(exit);
    return true;
  };

  const requestClose = (exit: () => void = () => router.back()) => {
    if (!hasUnsavedChanges()) {
      leave(exit);
      return;
    }
    if (promptOpen.current) return;
    promptOpen.current = true;
    Alert.alert(
      "Save this note?",
      "This note has unsaved changes.",
      [
        {
          text: "Keep editing",
          style: "cancel",
          onPress: () => {
            promptOpen.current = false;
          },
        },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => leave(exit),
        },
        {
          text: "Save",
          onPress: () => {
            promptOpen.current = false;
            save(exit);
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          promptOpen.current = false;
        },
      },
    );
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  React.useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        if (allowExit.current || !hasUnsavedChangesRef.current()) return;
        event.preventDefault();
        if (promptOpen.current) return;
        requestCloseRef.current(() => navigation.dispatch(event.data.action));
      }),
    [navigation],
  );

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
            redo.current.push(body.current);
            body.current = previous;
            composer.current?.replaceValue(previous);
          }
        }}
      />
      <Tool
        icon="arrow-redo"
        onPress={() => {
          const next = redo.current.pop();
          if (next !== undefined) {
            undo.current.push(body.current);
            body.current = next;
            composer.current?.replaceValue(next);
          }
        }}
      />
      <Tool text="H1" onPress={() => composer.current?.setBlock("h1")} />
      <Tool text="H2" onPress={() => composer.current?.setBlock("h2")} />
      <Tool text="B" onPress={() => composer.current?.toggleInline("bold")} />
      <Tool text="I" onPress={() => composer.current?.toggleInline("italic")} />
      <Tool text="S" onPress={() => composer.current?.toggleInline("strike")} />
      <Tool
        icon="color-palette-outline"
        onPress={() => setTextColorOpen((open) => !open)}
      />
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
      {textColorOpen ? (
        <View
          style={[
            styles.colorMenu,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
        >
          <Pressable
            accessibilityLabel="Use default text color"
            onPress={() => {
              composer.current?.setTextColor(undefined);
              setTextColorOpen(false);
            }}
            style={[styles.colorChoice, { borderColor: colors.border }]}
          >
            <Ionicons name="text-outline" size={15} color={colors.ink} />
          </Pressable>
          {[
            accent,
            "#D64545",
            "#E87924",
            "#A36A00",
            "#178C65",
            "#2877D4",
            "#7657C8",
            "#C3488D",
          ].map((color, index) => (
            <Pressable
              key={`${color}-${index}`}
              accessibilityLabel={`Use ${color} text`}
              onPress={() => {
                composer.current?.setTextColor(color);
                setTextColorOpen(false);
              }}
              style={[
                styles.colorChoice,
                { borderColor: colors.border, backgroundColor: color },
              ]}
            />
          ))}
        </View>
      ) : null}
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
        fixedTop={keyboardVisible || composerFocused ? editorTools : undefined}
        keyboardDismissMode="none"
        contentContainerStyle={
          keyboardVisible ? styles.keyboardContent : undefined
        }
      >
        <PageHeader
          title={existing ? "Edit note" : "New note"}
          showMenu={false}
          action={
            <IconButton
              icon="close"
              label="Close"
              onPress={() => requestClose()}
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
              ...[...existingLabels].map((label) => ({
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
            style={[
              styles.title,
              { color: colors.ink, borderColor: colors.border },
            ]}
          />
          <RichNoteComposer
            ref={composer}
            value={initialBody}
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
          onPress={() => save()}
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
                    leave(() => {
                      deleteJournalNote(existing.id);
                      router.back();
                    });
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
        <Pressable
          style={styles.linkBackdrop}
          onPress={() => setLinkOpen(false)}
        >
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
              <Pressable
                onPress={() => setLinkOpen(false)}
                style={styles.linkAction}
              >
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
                <Text preserveColor style={styles.linkSaveText}>
                  Insert
                </Text>
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
  colorMenu: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 11,
    padding: 5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },
  colorChoice: {
    width: 28,
    height: 28,
    borderWidth: 1,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
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
