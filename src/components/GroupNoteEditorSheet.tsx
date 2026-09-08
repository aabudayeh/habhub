import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import React, { useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";

import type { SaveGroupNoteInput } from "@/src/cloud/groupHubContent";
import { AppText as Text, AppTextInput as TextInput } from "@/src/components/AppText";
import { InfoPopover } from "@/src/components/InfoPopover";
import { RichNoteComposer, type RichNoteComposerHandle, cleanRichNoteValue, richNoteHasText } from "@/src/components/RichNoteComposer";
import { RichNoteFormattingToolbar } from "@/src/components/RichNoteFormattingToolbar";
import { HeaderIconButton } from "@/src/components/ui";
import { useWebBeforeUnload, useWebBackNavigationGuard } from "@/src/components/useWebBeforeUnload";
import { safeRichNoteLink } from "@/src/domain/richNoteValue";
import { LocalizedAlert as Alert, useTranslation } from "@/src/i18n";
import { useAppColors, useGroupAccent } from "@/src/theme";
import type { GroupNote } from "@/src/types";

export function GroupNoteEditorSheet({ note, groupId, tutorialSandbox, onClose, onSave }: {
  note: GroupNote | null;
  groupId: string;
  tutorialSandbox: boolean;
  onClose: () => void;
  onSave: (input: SaveGroupNoteInput) => Promise<unknown>;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const t = useTranslation();
  const composer = useRef<RichNoteComposerHandle>(null);
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [imageUri, setImageUri] = useState(note?.imageUri);
  const [imageStoragePath, setImageStoragePath] = useState(note?.imageStoragePath);
  const [imageUploadUri, setImageUploadUri] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("https://");
  const promptOpen = useRef(false);
  const operationActive = useRef(false);
  const busy = saving || picking;
  const dirty = title !== (note?.title ?? "") || cleanRichNoteValue(body) !== cleanRichNoteValue(note?.body ?? "")
    || imageStoragePath !== note?.imageStoragePath || imageUri !== note?.imageUri || Boolean(imageUploadUri);
  useWebBeforeUnload(!tutorialSandbox && dirty);
  useWebBackNavigationGuard(dirty || busy, () => requestClose());

  async function save() {
    if (busy || operationActive.current) return;
    const cleanBody = cleanRichNoteValue(composer.current?.getValue() ?? body).trim();
    if (!richNoteHasText(cleanBody) && !imageStoragePath && !imageUploadUri && !imageUri)
      return Alert.alert("Write a note", "Add some text or an image to this note.");
    if ([...cleanBody].length > 12000)
      return Alert.alert("Note is too long", "Keep this note under 12,000 characters, including formatting.");
    operationActive.current = true;
    setSaving(true);
    try {
      await onSave({ id: note?.id, groupId, title, body: cleanBody, expectedRevision: note?.revision,
        imageStoragePath, imageUploadUri, imagePreviewUri: imageUri });
      onClose();
    } catch (reason) {
      Alert.alert("Note not saved", reason instanceof Error ? reason.message : "Refresh and try again.");
    } finally { operationActive.current = false; setSaving(false); }
  }

  function requestClose() {
    if (busy || operationActive.current || promptOpen.current) return;
    if (!dirty || tutorialSandbox) return onClose();
    promptOpen.current = true;
    Alert.alert("Save this note?", "This note has unsaved changes.", [
      { text: "Keep editing", style: "cancel", onPress: () => { promptOpen.current = false; } },
      { text: "Discard", style: "destructive", onPress: () => { promptOpen.current = false; onClose(); } },
      { text: "Save", onPress: () => { promptOpen.current = false; void save(); } },
    ], { onDismiss: () => { promptOpen.current = false; } });
  }

  async function pickImage() {
    if (busy || operationActive.current || tutorialSandbox) return;
    operationActive.current = true;
    setPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.82 });
      const asset = !result.canceled ? result.assets[0] : undefined;
      if (!asset) return;
      if (asset.fileSize && asset.fileSize > 8 * 1024 * 1024)
        return Alert.alert("Image is too large", "Choose an image smaller than 8 MB.");
      setImageUri(asset.uri); setImageUploadUri(asset.uri); setImageStoragePath(undefined);
    } catch (reason) {
      Alert.alert("Image not selected", reason instanceof Error ? reason.message : "Try a different image.");
    } finally { operationActive.current = false; setPicking(false); }
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={requestClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.header}>
            <Text style={[styles.heading, { color: colors.ink }]}>{note ? "Edit group note" : "New group note"}</Text>
            <HeaderIconButton icon="close" label="Close editor" disabled={busy} onPress={requestClose} />
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.meta, { color: colors.muted }]}>Shared with this group</Text>
            <InfoPopover label="About shared notes" message="Group members can read and discuss this note. Its creator and group administrators can edit it. Images are shared only with authorized members; removing an image stops new shared access." />
          </View>
          <RichNoteFormattingToolbar composer={composer} disabled={busy} onColor={() => setColorOpen((value) => !value)} onLink={() => setLinkOpen((value) => !value)} />
          {colorOpen ? <View style={styles.palette}>
            <Pressable accessibilityRole="button" accessibilityLabel={t("Use default text color")} onPress={() => composer.current?.setTextColor(undefined)} style={[styles.swatch, { borderColor: colors.border }]}><Ionicons name="text-outline" size={17} color={colors.ink} /></Pressable>
            {[accent, "#D64545", "#E87924", "#A36A00", "#178C65", "#2877D4", "#7657C8", "#C3488D"].map((color, index) => <Pressable key={`${color}-${index}`} accessibilityRole="button" accessibilityLabel={t("Text color") + ` ${index + 1}`} onPress={() => composer.current?.setTextColor(color)} style={[styles.swatch, { backgroundColor: color, borderColor: colors.border }]} />)}
          </View> : null}
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="none" contentContainerStyle={styles.content}>
            {linkOpen ? <View style={[styles.linkPanel, { borderColor: colors.border }]}>
              <TextInput value={linkText} onChangeText={setLinkText} placeholder="Text to display" style={[styles.input, { color: colors.ink, borderColor: colors.border }]} />
              <TextInput value={linkUrl} onChangeText={setLinkUrl} autoCapitalize="none" keyboardType="url" placeholder="https://example.com" style={[styles.input, { color: colors.ink, borderColor: colors.border }]} />
              <View style={styles.buttons}>
                <Pressable onPress={() => setLinkOpen(false)} style={[styles.button, { borderColor: colors.border }]}><Text style={[styles.buttonText, { color: colors.muted }]}>Cancel</Text></Pressable>
                <Pressable onPress={() => { const url = safeRichNoteLink(linkUrl, true); if (!url || !linkText.trim()) return Alert.alert("Check the link", "Add display text and a complete http or https website address."); composer.current?.insertLink(linkText.trim(), url); setLinkOpen(false); setLinkText(""); setLinkUrl("https://"); }} style={[styles.button, { backgroundColor: accent }]}><Text preserveColor style={[styles.buttonText, styles.white]}>Insert</Text></Pressable>
              </View>
            </View> : null}
            <TextInput value={title} onChangeText={setTitle} editable={!busy} maxLength={160} placeholder="Title (optional)" placeholderTextColor={colors.faint} style={[styles.input, styles.titleInput, { color: colors.ink, borderColor: colors.border }]} />
            <View pointerEvents={busy ? "none" : "auto"}>
              <RichNoteComposer ref={composer} value={note?.body ?? ""} onChange={setBody} />
            </View>
            {imageUri ? <Image source={imageUri} contentFit="contain" accessibilityLabel={t("Note image")} style={[styles.image, { backgroundColor: colors.canvas }]} /> : imageStoragePath ? <Text style={[styles.meta, { color: colors.muted }]}>The attached image is unavailable. You can keep, replace, or remove it.</Text> : null}
            <View style={styles.buttons}>
              <Pressable accessibilityRole="button" disabled={busy || tutorialSandbox} onPress={() => void pickImage()} style={[styles.button, { borderColor: colors.border, opacity: busy || tutorialSandbox ? 0.5 : 1 }]}>
                <Ionicons name="image-outline" size={18} color={accent} /><Text style={[styles.buttonText, { color: accent }]}>{picking ? "Opening…" : imageUri || imageStoragePath ? "Change image" : "Add image"}</Text>
              </Pressable>
              {imageUri || imageStoragePath ? <Pressable accessibilityRole="button" accessibilityLabel={t("Remove image")} disabled={busy} onPress={() => { setImageUri(undefined); setImageUploadUri(undefined); setImageStoragePath(undefined); }} style={[styles.removeButton, { borderColor: colors.border }]}><Ionicons name="trash-outline" size={18} color={colors.muted} /></Pressable> : null}
            </View>
            <Text translate={false} style={[styles.counter, { color: [...body].length > 12000 ? "#C44949" : colors.muted }]}>{[...body].length.toLocaleString()} / 12,000</Text>
          </ScrollView>
          <View style={styles.buttons}>
            <Pressable disabled={busy} onPress={requestClose} style={[styles.button, { borderColor: colors.border }]}><Text style={[styles.buttonText, { color: colors.muted }]}>Cancel</Text></Pressable>
            <Pressable disabled={busy} onPress={() => void save()} style={[styles.button, { backgroundColor: accent, opacity: busy ? 0.6 : 1 }]}><Text preserveColor style={[styles.buttonText, styles.white]}>{saving ? "Saving…" : "Save note"}</Text></Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(5,14,36,.62)", alignItems: "center", justifyContent: "center", padding: 12 },
  sheet: { width: "100%", maxWidth: 720, maxHeight: "94%", borderWidth: 1, borderRadius: 20, padding: 12, gap: 8, flexShrink: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  heading: { flex: 1, fontSize: 18, lineHeight: 24, fontWeight: "800" },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  meta: { flexShrink: 1, fontSize: 11, lineHeight: 16 },
  content: { gap: 10, paddingBottom: 6 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, fontSize: 13 },
  titleInput: { fontWeight: "700" },
  palette: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  swatch: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  linkPanel: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
  image: { width: "100%", height: 230, borderRadius: 12 },
  buttons: { flexDirection: "row", gap: 8 },
  button: { flex: 1, minWidth: 0, minHeight: 44, borderWidth: 1, borderColor: "transparent", borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, paddingHorizontal: 8 },
  buttonText: { fontSize: 12, fontWeight: "700", flexShrink: 1 },
  removeButton: { minWidth: 44, minHeight: 44, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  white: { color: "#FFFFFF" },
  counter: { fontSize: 10, textAlign: "right" },
});
