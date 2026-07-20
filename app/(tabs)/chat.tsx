import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ExpandableImage } from "@/src/components/ExpandableImage";
import { Avatar } from "@/src/components/ui";
import { memberDisplayName } from "@/src/domain/members";
import {
  directConversationId,
  MessageCategory,
  randomMessage,
} from "@/src/domain/social";
import { useApp } from "@/src/state/AppProvider";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";

export default function ChatScreen() {
  const { state, sendMessage, updateSettings } = useApp();
  const accent = useGroupAccent();
  const colors=useAppColors();
  const [draft, setDraft] = useState("");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const messageScroll = useRef<ScrollView>(null);
  const recipient = recipientId
    ? state.group.members.find((member) => member.id === recipientId)
    : undefined;
  const groupConversationId = `group:${state.group.id}`;
  const conversationId = recipientId
    ? directConversationId(state.currentUserId, recipientId)
    : groupConversationId;
  const notifications=state.settings.notifications;const muted=recipientId?(notifications.mutedConversationIds??[]).includes(conversationId):(notifications.mutedGroupIds??[]).includes(state.group.id);
  function toggleMute(){updateSettings({notifications:{...notifications,...(recipientId?{mutedConversationIds:muted?(notifications.mutedConversationIds??[]).filter((id)=>id!==conversationId):[...(notifications.mutedConversationIds??[]),conversationId]}:{mutedGroupIds:muted?(notifications.mutedGroupIds??[]).filter((id)=>id!==state.group.id):[...(notifications.mutedGroupIds??[]),state.group.id]})}});}
  const messages = useMemo(
    () =>
      state.messages.filter((message) => {
        const id = message.conversationId ?? "group";
        if (!recipientId && state.group.id === "weekend-warriors")
          return id === conversationId || id === "group";
        return id === conversationId;
      }),
    [conversationId, recipientId, state.group.id, state.messages],
  );
  useEffect(() => {
    const timer = setTimeout(
      () => messageScroll.current?.scrollToEnd({ animated: false }),
      0,
    );
    return () => clearTimeout(timer);
  }, [conversationId]);
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => setKeyboardOpen(true));
    const hidden = Keyboard.addListener("keyboardDidHide", () => setKeyboardOpen(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  function submit() {
    if (!draft.trim() && !imageUri) return;
    sendMessage(
      draft,
      conversationId,
      recipientId ?? undefined,
      imageUri ?? undefined,
    );
    setDraft("");
    setImageUri(null);
  }
  function suggest(kind: MessageCategory) {
    setDraft(randomMessage(kind, state.settings.banterTone));
  }
  async function chooseImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: Platform.OS === "web",
    });
    if (!result.canceled) {
      const asset = result.assets[0];
      setImageUri(
        asset.base64
          ? `data:${asset.mimeType ?? "image/jpeg"};base64,${asset.base64}`
          : asset.uri,
      );
    }
  }

  return (
    <SafeAreaView style={[styles.safe,{backgroundColor:colors.canvas}]} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.flex}>
          <View
            style={{
              height: 3,
              backgroundColor: accent,
              borderRadius: 2,
              marginBottom: 4,
            }}
          />
          {!keyboardOpen ? <View style={[styles.chatPicker]}>
            <Text style={styles.sidebarTitle}>CHATS</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.sidebar, styles.sidebarTop]}
            >
              <ConversationButton
                label="Group"
                icon="people"
                selected={!recipientId}
                onPress={() => setRecipientId(null)}
              />
              {state.group.members
                .filter((member) => member.id !== state.currentUserId)
                .map((member) => (
                  <Pressable
                    key={member.id}
                    accessibilityLabel={`Message ${memberDisplayName(state, member)}`}
                    onPress={() => setRecipientId(member.id)}
                    style={[
                      styles.personButton,
                      recipientId === member.id &&
                        styles.personButtonSelected,
                    ]}
                  >
                    <Avatar
                      initials={member.initials}
                      color={member.color}
                      uri={member.avatarUri}
                      size={34}
                    />
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.personName,
                        recipientId === member.id &&
                          styles.personNameSelected,
                        recipientId === member.id && { color: accent },
                      ]}
                    >
                      {memberDisplayName(state, member)}
                    </Text>
                  </Pressable>
                ))}
            </ScrollView>
          </View> : null}

          <View style={[styles.threadHeader,{borderBottomColor:colors.border}]}>
            {recipient ? (
              <Pressable
                onPress={() =>
                  router.push(`/member/${recipient.id}` as never)
                }
              >
                <Avatar
                  initials={recipient.initials}
                  color={recipient.color}
                  uri={recipient.avatarUri}
                  size={39}
                />
              </Pressable>
            ) : (
              <View style={[styles.groupAvatar, { backgroundColor: accent }]}>
                <Ionicons name="people" size={20} color={palette.white} />
              </View>
            )}
            <Pressable
              disabled={!recipient}
              onPress={() =>
                recipient && router.push(`/member/${recipient.id}` as never)
              }
              style={styles.threadCopy}
            >
                <Text style={[styles.threadTitle,{color:colors.ink}]}>
                {recipient
                  ? memberDisplayName(state, recipient)
                  : state.group.name}
              </Text>
                <Text style={[styles.threadSub,{color:colors.muted}]}>
                {recipient
                  ? "Tap to view profile · private conversation"
                  : "Shared group conversation"}
              </Text>
            </Pressable>
            <Pressable accessibilityLabel={muted?'Unmute chat':'Mute chat'} onPress={toggleMute} style={styles.profileButton}><Ionicons name={muted?'notifications-off-outline':'notifications-outline'} size={18} color={accent}/></Pressable>
            {recipient ? (
              <Pressable
                accessibilityLabel="View friend profile"
                onPress={() =>
                  router.push(`/member/${recipient.id}` as never)
                }
                style={styles.profileButton}
              >
                <Ionicons
                  name="person-outline"
                  size={18}
                  color={accent}
                />
              </Pressable>
            ) : (
              <Ionicons
                name="people-outline"
                size={17}
                color={palette.faint}
              />
            )}
          </View>
          <ScrollView
            ref={messageScroll}
            style={styles.messageScroller}
            contentContainerStyle={styles.messages}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() =>
              messageScroll.current?.scrollToEnd({ animated: false })
            }
          >
            {messages.length ? (
              messages.map((message) => {
                if (message.senderId === "system")
                  return (
                    <View
                      key={message.id}
                      style={[
                        styles.systemMessage,
                        message.kind === "achievement" &&
                          styles.achievement,
                      ]}
                    >
                      <Ionicons
                        name={
                          message.kind === "achievement"
                            ? "trophy"
                            : "sparkles"
                        }
                        size={14}
                        color={
                          message.kind === "achievement"
                            ? palette.amber
                            : accent
                        }
                      />
                      <Text style={styles.systemText}>{message.text}</Text>
                    </View>
                  );
                const sender = state.group.members.find(
                  (candidate) => candidate.id === message.senderId,
                );
                const mine = message.senderId === state.currentUserId;
                return (
                  <View
                    key={message.id}
                    style={[
                      styles.messageRow,
                      mine && styles.messageRowMine,
                    ]}
                  >
                    {!mine && sender ? (
                      <Pressable
                        onPress={() =>
                          router.push(`/member/${sender.id}` as never)
                        }
                      >
                        <Avatar
                          initials={sender.initials}
                          color={sender.color}
                          uri={sender.avatarUri}
                          size={28}
                        />
                      </Pressable>
                    ) : null}
                    <View style={styles.messageBlock}>
                      {!mine ? (
                        <Pressable
                          disabled={!sender}
                          onPress={() =>
                            sender &&
                            router.push(`/member/${sender.id}` as never)
                          }
                        >
                          <Text style={styles.sender}>
                            {sender
                              ? memberDisplayName(state, sender)
                              : "Member"}
                          </Text>
                        </Pressable>
                      ) : null}
                      <View
                        style={[styles.bubble,{backgroundColor:colors.card,borderColor:colors.border}, mine && styles.bubbleMine, mine && { backgroundColor: accent, borderColor: accent }]}
                      >
                        {message.imageUri ? (
                          <ExpandableImage
                            uri={message.imageUri}
                            thumbnailStyle={styles.messageImage}
                          />
                        ) : null}
                        {message.text ? (
                          <Text
                            style={[
                              styles.messageText,
                              {color:colors.ink},mine && styles.messageTextMine,
                            ]}
                          >
                            {message.text}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </View>
                );
              })
            ) : (
              <View style={styles.empty}>
                <Ionicons
                  name="chatbubble-ellipses-outline"
                  size={27}
                  color={accent}
                />
                <Text style={styles.emptyTitle}>
                  Start the conversation
                </Text>
                <Text style={styles.emptyText}>
                  Messages and images in this thread stay separate from
                  other chats.
                </Text>
              </View>
            )}
          </ScrollView>

          {imageUri ? (
            <View style={styles.attachmentPreview}>
              <ExpandableImage
                uri={imageUri}
                thumbnailStyle={styles.previewImage}
              />
              <Pressable
                onPress={() => setImageUri(null)}
                style={styles.removeImage}
              >
                <Ionicons name="close" size={16} color={palette.white} />
              </Pressable>
            </View>
          ) : null}
          {!keyboardOpen ? <View style={styles.quickRow}>
            <Quick
              label="Cheer"
              icon="sparkles-outline"
              onPress={() => suggest("cheer")}
            />
            <Quick
              label="Taunt"
              icon="flash-outline"
              onPress={() => suggest("taunt")}
            />
            <Quick
              label="Remind"
              icon="notifications-outline"
              onPress={() => suggest("reminder")}
            />
          </View> : null}
          {!keyboardOpen ? <Text style={styles.libraryNote}>
            A random built-in suggestion is placed in the box first. Edit
            it, then send when ready.
          </Text> : null}
          <View style={[styles.composer,{backgroundColor:colors.card,borderColor:colors.border}]}>
            <Pressable
              accessibilityLabel="Attach image"
              onPress={chooseImage}
              style={styles.attach}
            >
              <Ionicons
                name="image-outline"
                size={20}
                color={accent}
              />
            </Pressable>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onFocus={() =>
                setTimeout(
                  () =>
                    messageScroll.current?.scrollToEnd({ animated: true }),
                  250,
                )
              }
              onSubmitEditing={submit}
              placeholder={
                recipient
                  ? `Message ${recipient.name}…`
                  : "Message the group…"
              }
              placeholderTextColor={palette.faint}
            style={[styles.input,{color:colors.ink}]}
              returnKeyType="send"
              multiline
            />
            <Pressable
              disabled={!draft.trim() && !imageUri}
              onPress={submit}
              style={({ pressed }) => [
                styles.send,
                { backgroundColor: accent },
                !draft.trim() && !imageUri && styles.sendDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="arrow-up" size={18} color={palette.white} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ConversationButton({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  onPress: () => void;
}) {
  const accent = useGroupAccent();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.conversationButton,
        selected && styles.conversationButtonSelected,
      ]}
    >
      <View
        style={[
          styles.conversationIcon,
          selected && styles.conversationIconSelected,
          selected && { backgroundColor: accent },
        ]}
      >
        <Ionicons
          name={icon}
          size={18}
          color={selected ? palette.white : accent}
        />
      </View>
      <Text
        style={[
          styles.conversationLabel,
          selected && styles.personNameSelected,
          selected && { color: accent },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
function Quick({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  const accent = useGroupAccent();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.quick, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={14} color={accent} />
      <Text style={[styles.quickText, { color: accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.canvas },
  flex: { flex: 1 },
  messageScroller: { flex: 1 },
  screen: { paddingBottom: 24 },
  sidebar: {
    width: 104,
    backgroundColor: "#EEF3ED",
    borderRightWidth: 1,
    borderRightColor: palette.border,
    paddingVertical: 14,
    paddingHorizontal: 7,
  },
  sidebarTitle: {
    color: palette.faint,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.2,
    marginHorizontal: 6,
    marginBottom: 10,
  },
  conversationButton: {
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 13,
    gap: 4,
  },
  conversationButtonSelected: { backgroundColor: palette.card },
  conversationIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.canvas,
  },
  conversationIconSelected: { backgroundColor: palette.primary },
  conversationLabel: { color: palette.muted, fontSize: 9, fontWeight: "800" },
  sidebarRule: {
    height: 1,
    backgroundColor: palette.border,
    marginVertical: 8,
  },
  personButton: {
    alignItems: "center",
    paddingVertical: 7,
    borderRadius: 13,
    gap: 3,
  },
  personButtonSelected: { backgroundColor: palette.card },
  personName: {
    color: palette.muted,
    fontSize: 9,
    fontWeight: "700",
    maxWidth: 82,
  },
  personNameSelected: { color: palette.primary, fontWeight: "900" },
  thread: { flex: 1, minWidth: 0, padding: 12 },
  threadHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingBottom: 11,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  groupAvatar: {
    width: 39,
    height: 39,
    borderRadius: 14,
    backgroundColor: palette.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  threadCopy: { flex: 1 },
  threadTitle: { color: palette.ink, fontSize: 14, fontWeight: "900" },
  threadSub: { color: palette.muted, fontSize: 8, marginTop: 2 },
  profileButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: palette.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  messages: { flexGrow: 1, justifyContent: "flex-end", gap: 13, paddingVertical: 15, paddingHorizontal: 14 },
  systemMessage: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: palette.canvas,
    borderRadius: 13,
    paddingVertical: 7,
    paddingHorizontal: 9,
    maxWidth: "94%",
  },
  achievement: { backgroundColor: "#FFF6E7" },
  systemText: {
    flexShrink: 1,
    color: palette.muted,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    alignSelf: "flex-start",
    maxWidth: "92%",
  },
  messageRowMine: { alignSelf: "flex-end" },
  messageBlock: { flexShrink: 1 },
  sender: {
    color: palette.muted,
    fontSize: 8,
    fontWeight: "800",
    marginLeft: 4,
    marginBottom: 3,
  },
  bubble: {
    backgroundColor: palette.canvas,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    borderBottomLeftRadius: 5,
    padding: 6,
    overflow: "hidden",
  },
  bubbleMine: {
    backgroundColor: palette.primary,
    borderColor: palette.primary,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 5,
  },
  messageText: {
    color: palette.ink,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  messageTextMine: { color: palette.white },
  messageImage: {
    width: 180,
    maxWidth: "100%",
    aspectRatio: 1.3,
    borderRadius: 10,
    marginBottom: 3,
  },
  empty: { alignItems: "center", paddingVertical: 45 },
  emptyTitle: {
    color: palette.ink,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 8,
  },
  emptyText: {
    color: palette.muted,
    fontSize: 9,
    lineHeight: 14,
    textAlign: "center",
    maxWidth: 210,
    marginTop: 3,
  },
  attachmentPreview: {
    width: 76,
    height: 76,
    position: "relative",
    marginBottom: 8,
  },
  previewImage: { width: 76, height: 76, borderRadius: 12 },
  removeImage: {
    position: "absolute",
    right: -5,
    top: -5,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, paddingHorizontal: 14 },
  quick: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: palette.canvas,
    borderRadius: 13,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  quickText: { color: palette.primary, fontSize: 9, fontWeight: "800" },
  libraryNote: {
    color: palette.muted,
    fontSize: 8,
    lineHeight: 12,
    marginTop: 5,
    marginBottom: 7,
    paddingHorizontal: 14,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    padding: 6,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.canvas,
    marginHorizontal: 14,
    marginBottom: 8,
  },
  attach: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: palette.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    minHeight: 34,
    maxHeight: 90,
    color: palette.ink,
    fontSize: 12,
    paddingVertical: 8,
  },
  send: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: palette.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
  chatPicker: {
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    paddingHorizontal: 14,
  },
  sidebarTop: {
    width: "auto",
    flexDirection: "row",
    gap: 7,
    backgroundColor: "transparent",
    borderRightWidth: 0,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
});
