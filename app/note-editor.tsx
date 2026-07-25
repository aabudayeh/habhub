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
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const undo = useRef<string[]>([]);
  const redo = useRef<string[]>([]);
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
