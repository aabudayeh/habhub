import { Ionicons } from "@expo/vector-icons";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import * as ImagePicker from "expo-image-picker";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { translateUiText, useLocale } from "@/src/i18n";

import { ExpandableImage } from "@/src/components/ExpandableImage";
import { TutorialTarget } from "@/src/components/TutorialSpotlight";
import { Avatar } from "@/src/components/ui";
import { memberDisplayName } from "@/src/domain/members";
import { formatClockTime } from "@/src/domain/date";
import {
  directConversationId,
  MessageCategory,
  randomMessage,
} from "@/src/domain/social";
import { useApp } from "@/src/state/AppProvider";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { useCloudSyncActions } from "@/src/cloud/CloudSyncProvider";
import { useGroupTodos } from "@/src/cloud/useGroupTodos";
import { usePageSwipeGesture } from "@/src/components/usePageSwipeGesture";
import { useSoftwareKeyboardVisibility } from "@/src/components/useSoftwareKeyboardVisibility";
import { useTodoItemVisibility } from "@/src/components/useTodoItemVisibility";

function ChatScreen() {
  const tutorialSandbox = useTutorialSandboxActive();
  const params = useLocalSearchParams<{ recipient?: string | string[] }>();
  const requestedRecipient = Array.isArray(params.recipient)
    ? params.recipient[0]
    : params.recipient;
  const { state, sendMessage, updateSettings } = useApp();
  const accent = useGroupAccent();
  const colors = useAppColors();
  const locale = useLocale();
  const cloud = useCloudSyncActions();
  const refreshMessages = cloud.refreshMessages;
  const syncMessagesNow = cloud.syncMessagesNow;
  const refreshMessagesRef = useRef(refreshMessages);
  const syncMessagesNowRef = useRef(syncMessagesNow);
  refreshMessagesRef.current = refreshMessages;
  syncMessagesNowRef.current = syncMessagesNow;
  const [draft, setDraft] = useState("");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [attachedTodoId, setAttachedTodoId] = useState<string>();
  const [todoPickerOpen, setTodoPickerOpen] = useState(false);
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const appliedRequestedRecipient = useRef<string | null>(null);
  useEffect(() => {
    if (
      requestedRecipient &&
      appliedRequestedRecipient.current !== requestedRecipient &&
      requestedRecipient !== state.currentUserId &&
      state.group.members.some((member) => member.id === requestedRecipient)
    ) {
      appliedRequestedRecipient.current = requestedRecipient;
      setRecipientId(requestedRecipient);
    }
  }, [requestedRecipient, state.currentUserId, state.group.members]);
  const [refreshingMessages, setRefreshingMessages] = useState(false);
  const tabBarHeight = useBottomTabBarHeight();
  const keyboardVisible = useSoftwareKeyboardVisibility();
  const messageScroll = useRef<ScrollView>(null);
  const pendingScrollFrame = useRef<number | null>(null);
  const pendingAnimatedScroll = useRef(false);
  const settledScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const threadViewportHeight = useRef<number | null>(null);
  const keyboardTransitionEventAt = useRef(0);
  const userScrolledAwayFromBottom = useRef(false);
  const userDragInProgress = useRef(false);
  const userDragStartDistanceFromBottom = useRef<number | null>(null);
  const followOutgoingMessageLayout = useRef(false);
  const renderedConversationKey = useRef<string | null>(null);
  const recipient = recipientId
    ? state.group.members.find((member) => member.id === recipientId)
    : undefined;
  const groupTodosVisible =
    state.settings.showGroupTodosByGroup?.[state.group.id] === true;
  const groupTodosAvailable =
    state.group.groupTodosEnabled === true && groupTodosVisible;
  const groupTodos = useGroupTodos(
    state.group.id,
    groupTodosAvailable &&
      (todoPickerOpen || Boolean(attachedTodoId)),
  );
  const groupTodoItemVisibility = useTodoItemVisibility(
    `group:${state.currentUserId}:${state.group.id}`,
  );
  const attachableGroupTodos = groupTodos.todos.filter((todo) =>
    groupTodoItemVisibility.isVisible(todo.id),
  );
  const attachedTodo = attachableGroupTodos.find(
    (todo) => todo.id === attachedTodoId,
  );
  useEffect(() => {
    if (
      attachedTodoId &&
      (!groupTodosAvailable ||
        (!groupTodos.loading && !attachedTodo))
    )
      setAttachedTodoId(undefined);
  }, [attachedTodo, attachedTodoId, groupTodos.loading, groupTodosAvailable]);
  const groupConversationId = `group:${state.group.id}`;
  const conversationMemberIds = useMemo(
    () =>
      state.group.members
        .filter((member) => member.id !== state.currentUserId)
        .map((member) => member.id),
    [state.currentUserId, state.group.members],
  );
  const switchConversation = useCallback(
    (direction: -1 | 1) => {
      const ordered: (string | null)[] = [null, ...conversationMemberIds];
      if (ordered.length <= 1) return;
      const currentIndex = Math.max(0, ordered.indexOf(recipientId));
      const nextIndex =
        (currentIndex + direction + ordered.length) % ordered.length;
      setRecipientId(ordered[nextIndex]);
    },
    [conversationMemberIds, recipientId],
  );
  const conversationSwipe = usePageSwipeGesture({
    enabled: !userDragInProgress.current,
    onPrevious: () => switchConversation(-1),
    onNext: () => switchConversation(1),
  });
  const conversationId = recipientId
    ? directConversationId(state.currentUserId, recipientId)
    : groupConversationId;
  const conversationReadKey = `${state.group.id}:${conversationId}`;
  const notifications = state.settings.notifications;
  const readAt = useMemo(
    () => notifications.chatReadAtByConversation ?? {},
    [notifications.chatReadAtByConversation],
  );
  const conversationUnread = useCallback(
    (id: string) =>
      state.messages.some(
        (message) =>
          (!message.groupId || message.groupId === state.group.id) &&
          (message.conversationId ?? "group") === id &&
          message.senderId !== state.currentUserId &&
          message.createdAt >
            (readAt[`${state.group.id}:${id}`] ?? readAt[id] ?? ""),
      ),
    [readAt, state.currentUserId, state.group.id, state.messages],
  );
  const muted = recipientId
    ? (notifications.mutedConversationIds ?? []).includes(conversationId)
    : (notifications.mutedGroupIds ?? []).includes(state.group.id);
  function toggleMute() {
    updateSettings({
      notifications: {
        ...notifications,
        ...(recipientId
          ? {
              mutedConversationIds: muted
                ? (notifications.mutedConversationIds ?? []).filter(
                    (id) => id !== conversationId,
                  )
                : [
                    ...(notifications.mutedConversationIds ?? []),
                    conversationId,
                  ],
            }
          : {
              mutedGroupIds: muted
                ? (notifications.mutedGroupIds ?? []).filter(
                    (id) => id !== state.group.id,
                  )
                : [...(notifications.mutedGroupIds ?? []), state.group.id],
            }),
      },
    });
  }
  const messages = useMemo(
    () =>
      state.messages
        .filter((message) => {
          const id = message.conversationId ?? "group";
          if (message.groupId && message.groupId !== state.group.id) return false;
          if (
            !message.groupId &&
            id.startsWith("group:") &&
            id !== groupConversationId
          )
            return false;
          if (!recipientId && state.group.id === "weekend-warriors")
            return id === conversationId || id === "group";
          return id === conversationId;
        })
        .sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        ),
    [
      conversationId,
      groupConversationId,
      recipientId,
      state.group.id,
      state.messages,
    ],
  );
  const latestMessage = messages[messages.length - 1];
  const latestMessageKey = latestMessage
    ? `${messages.length}:${latestMessage.id}:${latestMessage.createdAt}:${latestMessage.text}:${latestMessage.imageUri ?? ""}:${latestMessage.todoAttachment?.groupTodoId ?? ""}`
    : `${conversationId}:empty`;
  const scrollToNewest = useCallback((animated = false) => {
    // Coalesce callers into one frame. In particular, do not repeatedly force
    // the offset while Android is resizing the viewport around the keyboard.
    userScrolledAwayFromBottom.current = false;
    pendingAnimatedScroll.current ||= animated;
    if (pendingScrollFrame.current !== null) return;
    pendingScrollFrame.current = requestAnimationFrame(() => {
      pendingScrollFrame.current = null;
      const shouldAnimate = pendingAnimatedScroll.current;
      pendingAnimatedScroll.current = false;
      messageScroll.current?.scrollToEnd({ animated: shouldAnimate });
    });
  }, []);
  const cancelPendingNewestScroll = useCallback(() => {
    if (pendingScrollFrame.current !== null) {
      cancelAnimationFrame(pendingScrollFrame.current);
      pendingScrollFrame.current = null;
    }
    pendingAnimatedScroll.current = false;
  }, []);
  const cancelSettledNewestScroll = useCallback(() => {
    if (settledScrollTimer.current !== null) {
      clearTimeout(settledScrollTimer.current);
      settledScrollTimer.current = null;
    }
  }, []);
  const scrollToNewestAfterLayout = useCallback(
    (delay = 48, onlyIfFollowing = false) => {
      cancelSettledNewestScroll();
      if (
        onlyIfFollowing &&
        (userScrolledAwayFromBottom.current || userDragInProgress.current)
      )
        return;
      settledScrollTimer.current = setTimeout(() => {
        settledScrollTimer.current = null;
        if (
          onlyIfFollowing &&
          (userScrolledAwayFromBottom.current || userDragInProgress.current)
        )
          return;
        scrollToNewest(false);
      }, delay);
    },
    [cancelSettledNewestScroll, scrollToNewest],
  );
  const handleThreadLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      const previousHeight = threadViewportHeight.current;
      threadViewportHeight.current = height;
      const heightChange =
        previousHeight === null ? 0 : Math.abs(previousHeight - height);
      const followsKeyboardEvent =
        Date.now() - keyboardTransitionEventAt.current < 500;
      if (
        previousHeight !== null &&
        (heightChange >= 120 ||
          (followsKeyboardEvent && heightChange >= 24))
      )
        // Keyboard viewport and footer-inset changes can commit in adjacent
        // layout passes. Debounce to one final alignment after both settle.
        scrollToNewestAfterLayout(
          followsKeyboardEvent ? 64 : 320,
          true,
        );
    },
    [scrollToNewestAfterLayout],
  );
  const handleThreadContentSizeChange = useCallback(() => {
    if (
      userDragInProgress.current ||
      (userScrolledAwayFromBottom.current &&
        !followOutgoingMessageLayout.current)
    )
      return;
    // iOS Web can commit the outgoing bubble, the cleared composer, and the
    // keyboard viewport in separate layouts. Follow the content-size commit
    // itself so the scroll target is the new bottom rather than the previous
    // message's bottom.
    followOutgoingMessageLayout.current = false;
    scrollToNewest(false);
    scrollToNewestAfterLayout(64, true);
  }, [scrollToNewest, scrollToNewestAfterLayout]);
  const bottomDistance = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      return Math.max(
        0,
        contentSize.height - layoutMeasurement.height - contentOffset.y,
      );
    },
    [],
  );
  const handleUserScrollStart = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      // A real drag always wins over queued focus, sync, or message scrolling.
      userDragInProgress.current = true;
      userDragStartDistanceFromBottom.current = bottomDistance(event);
      cancelPendingNewestScroll();
    },
    [bottomDistance, cancelPendingNewestScroll],
  );
  const handleThreadScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const dragStart = userDragStartDistanceFromBottom.current;
      if (dragStart === null) return;
      // Once a drag moves into older history, suppress automatic following for
      // the rest of this Chat visit, even after only a few pixels of movement.
      if (bottomDistance(event) > dragStart + 2) {
        userScrolledAwayFromBottom.current = true;
      }
    },
    [bottomDistance],
  );
  const handleUserScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      handleThreadScroll(event);
      userDragInProgress.current = false;
      userDragStartDistanceFromBottom.current = null;
    },
    [handleThreadScroll],
  );
  const handleComposerFocus = useCallback(() => {
    if (
      userScrolledAwayFromBottom.current ||
      userDragInProgress.current
    )
      return;
    // Align immediately, then keep a delayed fallback for Android versions
    // where adjustResize can suppress the keyboardDidShow notification.
    scrollToNewest(false);
    scrollToNewestAfterLayout(360, true);
  }, [scrollToNewest, scrollToNewestAfterLayout]);
  useEffect(
    () => () => {
      cancelPendingNewestScroll();
      cancelSettledNewestScroll();
    },
    [cancelPendingNewestScroll, cancelSettledNewestScroll],
  );
  useEffect(() => {
    // Match the tab navigator's own visibility events so the footer inset and
    // overlaid bar swap in the same render, instead of briefly overlapping.
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const shown = Keyboard.addListener(showEvent, () => {
      keyboardTransitionEventAt.current = Date.now();
      cancelPendingNewestScroll();
      scrollToNewestAfterLayout(48, true);
    });
    const hidden = Keyboard.addListener(hideEvent, () => {
      // Wait for the restored Android viewport to settle before aligning so
      // the close transition does not visibly fight the ScrollView.
      keyboardTransitionEventAt.current = Date.now();
      cancelPendingNewestScroll();
      scrollToNewestAfterLayout(64, true);
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [cancelPendingNewestScroll, scrollToNewestAfterLayout]);
  // CloudSyncProvider owns the immediate, idempotent message outbox globally.
  // Do not start a second three-timer retry loop from this screen: it raced the
  // provider and could upsert/invoke push twice for the same newly-sent row.
  useFocusEffect(
    useCallback(() => {
      // Every visit to Chat starts at the newest message. Only a drag made
      // after this point opts out of keyboard/new-message following.
      userScrolledAwayFromBottom.current = false;
      userDragInProgress.current = false;
      userDragStartDistanceFromBottom.current = null;
      scrollToNewest(false);
      scrollToNewestAfterLayout(80);
      let active = true;
      syncMessagesNowRef.current()
        .catch(() => undefined)
        .finally(() =>
          refreshMessagesRef.current()
            .catch(() => undefined)
            .finally(() => {
              if (
                active &&
                !userScrolledAwayFromBottom.current &&
                !userDragInProgress.current
              )
                scrollToNewest(false);
            }),
        );
      // Realtime remains primary; this inexpensive chat-only poll covers
      // suspended sockets without reloading leaderboard or health data.
      const timer = setInterval(
        () => refreshMessagesRef.current().catch(() => undefined),
        25000,
      );
      return () => {
        active = false;
        clearInterval(timer);
        cancelPendingNewestScroll();
        cancelSettledNewestScroll();
      };
    }, [
      cancelPendingNewestScroll,
      cancelSettledNewestScroll,
      scrollToNewest,
      scrollToNewestAfterLayout,
    ]),
  );
  useEffect(() => {
    const conversationChanged =
      renderedConversationKey.current !== conversationReadKey;
    renderedConversationKey.current = conversationReadKey;
    if (conversationChanged) {
      userScrolledAwayFromBottom.current = false;
      userDragInProgress.current = false;
      userDragStartDistanceFromBottom.current = null;
      scrollToNewest(false);
      scrollToNewestAfterLayout(80);
      return;
    }
    if (
      !userScrolledAwayFromBottom.current &&
      !userDragInProgress.current
    )
      scrollToNewest(false);
  }, [
    conversationReadKey,
    latestMessageKey,
    scrollToNewest,
    scrollToNewestAfterLayout,
  ]);
  useEffect(() => {
    const latestIncoming = messages
      .filter((message) => message.senderId !== state.currentUserId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.createdAt;
    if (
      !latestIncoming ||
      latestIncoming <=
        (readAt[conversationReadKey] ?? readAt[conversationId] ?? "")
    )
      return;
    updateSettings({
      notifications: {
        ...notifications,
        chatReadAtByConversation: {
          ...readAt,
          [conversationReadKey]: latestIncoming,
        },
      },
    });
  }, [
    conversationId,
    conversationReadKey,
    messages,
    notifications,
    readAt,
    state.currentUserId,
    updateSettings,
  ]);
  function submit() {
    if (!draft.trim() && !imageUri && !attachedTodo) return;
    followOutgoingMessageLayout.current = true;
    userScrolledAwayFromBottom.current = false;
    userDragInProgress.current = false;
    userDragStartDistanceFromBottom.current = null;
    sendMessage(
      draft,
      conversationId,
      recipientId ?? undefined,
      imageUri ?? undefined,
      attachedTodo
        ? {
            groupTodoId: attachedTodo.id,
            groupId: attachedTodo.groupId,
            title: attachedTodo.title,
            completionMode: attachedTodo.completionMode,
          }
        : undefined,
    );
    setDraft("");
    setImageUri(null);
    setAttachedTodoId(undefined);
    setTodoPickerOpen(false);
    scrollToNewest(false);
    scrollToNewestAfterLayout(96, true);
  }
  function suggest(kind: MessageCategory) {
    setDraft(
      randomMessage(
        kind,
        state.settings.banterTone,
        undefined,
        state.settings.language,
      ),
    );
  }
  async function chooseImage() {
    if (tutorialSandbox) return;
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
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.canvas }]}
      // The tab bar already owns the bottom safe area. Applying it here too
      // leaves the composer floating above the navigation bar.
      edges={["top"]}
    >
      <GestureDetector gesture={conversationSwipe}>
      <KeyboardAvoidingView
        style={styles.flex}
        // `adjustResize` normally moves this scene on Android, but some
        // navigator/OEM combinations leave the tab scene full-height. Once the
        // IME has finished opening, KAV supplies only the overlap that remains:
        // zero for a resized scene, or the uncovered IME inset as a fallback.
        // Disabling it immediately on close guarantees that no stale keyboard
        // measurement can strand the composer above its normal tab-bar edge.
        enabled={
          Platform.OS === "ios" ||
          (Platform.OS === "android" && keyboardVisible)
        }
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        <View style={styles.flex}>
          <TutorialTarget id="chat-header">
          <View
            style={[styles.pageHeader, { borderBottomColor: colors.border }]}
          >
            <Text style={[styles.pageTitle, { color: colors.ink }]}>Chat</Text>
            <View style={styles.chatPicker}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={[styles.sidebar, styles.sidebarTop]}
              >
                <ConversationButton
                  label="Group"
                  icon="people"
                  selected={!recipientId}
                  unread={conversationUnread(groupConversationId)}
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
                      {conversationUnread(
                        directConversationId(state.currentUserId, member.id),
                      ) ? (
                        <View style={styles.unreadDot} />
                      ) : null}
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
            </View>
          </View>
          </TutorialTarget>

          <View
            style={[styles.threadHeader, { borderBottomColor: colors.border }]}
          >
            {recipient ? (
              <Pressable
                onPress={() => router.push(`/member/${recipient.id}` as never)}
              >
                <Avatar
                  initials={recipient.initials}
                  color={recipient.color}
                  uri={recipient.avatarUri}
                  size={39}
                />
              </Pressable>
            ) : (
              <Pressable
                onPress={() => router.push("/group-settings" as never)}
                style={[styles.groupAvatar, { backgroundColor: accent }]}
              >
                <Ionicons name="people" size={20} color={palette.white} />
              </Pressable>
            )}
            <Pressable
              disabled={!recipient}
              onPress={() =>
                recipient && router.push(`/member/${recipient.id}` as never)
              }
              style={styles.threadCopy}
            >
              <Text style={[styles.threadTitle, { color: colors.ink }]}>
                {recipient
                  ? memberDisplayName(state, recipient)
                  : state.group.name}
              </Text>
              <Text style={[styles.threadSub, { color: colors.muted }]}>
                {recipient
                  ? "Tap to view profile · private conversation"
                  : "Shared group conversation"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel={muted ? "Unmute chat" : "Mute chat"}
              onPress={toggleMute}
              style={styles.profileButton}
            >
              <Ionicons
                name={
                  muted ? "notifications-off-outline" : "notifications-outline"
                }
                size={18}
                color={accent}
              />
            </Pressable>
            {recipient ? (
              <Pressable
                accessibilityLabel="View friend profile"
                onPress={() => router.push(`/member/${recipient.id}` as never)}
                style={styles.profileButton}
              >
                <Ionicons name="person-outline" size={18} color={accent} />
              </Pressable>
            ) : (
              <Pressable
                accessibilityLabel="Open group settings"
                onPress={() => router.push("/group-settings" as never)}
                style={[styles.profileButton, { backgroundColor: colors.card }]}
              >
                <Ionicons name="people-outline" size={18} color={accent} />
              </Pressable>
            )}
          </View>
          <ScrollView
            ref={messageScroll}
            style={styles.messageScroller}
            contentContainerStyle={styles.messages}
            keyboardShouldPersistTaps="always"
            onLayout={handleThreadLayout}
            onContentSizeChange={handleThreadContentSizeChange}
            onScroll={handleThreadScroll}
            onScrollBeginDrag={handleUserScrollStart}
            onScrollEndDrag={handleUserScrollEnd}
            onMomentumScrollEnd={handleUserScrollEnd}
            scrollEventThrottle={16}
            refreshControl={
              <RefreshControl
                refreshing={refreshingMessages}
                onRefresh={async () => {
                  setRefreshingMessages(true);
                  try {
                    await syncMessagesNow().catch(() => undefined);
                    await refreshMessages().catch(() => undefined);
                  } finally {
                    setRefreshingMessages(false);
                  }
                }}
                tintColor={accent}
              />
            }
          >
            {messages.length ? (
              messages.map((message, index) => {
                const timestamp = new Date(message.createdAt);
                const showDate =
                  index === 0 ||
                  new Date(messages[index - 1].createdAt).toDateString() !==
                    timestamp.toDateString();
                if (message.senderId === "system")
                  return (
                    <React.Fragment key={message.id}>
                      {showDate ? (
                        <Text
                          style={[
                            styles.dateStamp,
                            {
                              color: colors.muted,
                              backgroundColor: colors.card,
                            },
                          ]}
                        >
                          {timestamp.toLocaleDateString(locale, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}
                        </Text>
                      ) : null}
                      <View
                        style={[
                          styles.systemMessage,
                          {
                            backgroundColor:
                              message.kind === "achievement" && !colors.isDark
                                ? "#FFF6E7"
                                : message.kind === "achievement"
                                  ? colors.card
                                  : colors.primarySoft,
                            borderColor: colors.border,
                          },
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
                        <Text style={[styles.systemText, { color: colors.muted }]}>
                          {translateUiText(
                            state.settings.language,
                            message.text,
                          )} ·{" "}
                          {formatClockTime(
                            timestamp,
                            state.settings.timeFormat,
                            locale,
                          )}
                        </Text>
                      </View>
                    </React.Fragment>
                  );
                const sender = state.group.members.find(
                  (candidate) => candidate.id === message.senderId,
                );
                const mine = message.senderId === state.currentUserId;
                return (
                  <React.Fragment key={message.id}>
                    {showDate ? (
                      <Text
                        style={[
                          styles.dateStamp,
                          { color: colors.muted, backgroundColor: colors.card },
                        ]}
                      >
                        {timestamp.toLocaleDateString(locale, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                      </Text>
                    ) : null}
                    <View
                      style={[styles.messageRow, mine && styles.messageRowMine]}
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
                            <Text translate={false} style={styles.sender}>
                              {sender
                                ? memberDisplayName(state, sender)
                                : "Member"}
                            </Text>
                          </Pressable>
                        ) : null}
                        <View
                          style={[
                            styles.bubble,
                            {
                              backgroundColor: colors.card,
                              borderColor: colors.border,
                            },
                            mine && styles.bubbleMine,
                            mine && {
                              backgroundColor: accent,
                              borderColor: accent,
                            },
                          ]}
                        >
                          {message.imageUri ? (
                            <ExpandableImage
                              uri={message.imageUri}
                              thumbnailStyle={styles.messageImage}
                            />
                          ) : null}
                          {message.todoAttachment ? (
                            <Pressable
                              accessibilityLabel={`Open group to-do ${message.todoAttachment.title}`}
                              onPress={() => {
                                updateSettings({
                                  showGroupTodosByGroup: {
                                    ...(state.settings.showGroupTodosByGroup ?? {}),
                                    [state.group.id]: true,
                                  },
                                });
                                router.navigate({
                                  pathname: "/(tabs)/group",
                                  params: {
                                    focusGroupTodo: message.todoAttachment?.groupTodoId,
                                    todoFocusAt: Date.now().toString(),
                                  },
                                } as never);
                              }}
                              style={[
                                styles.todoAttachment,
                                {
                                  backgroundColor: mine
                                    ? "rgba(255,255,255,.14)"
                                    : colors.canvas,
                                  borderColor: mine
                                    ? "rgba(255,255,255,.3)"
                                    : colors.border,
                                },
                              ]}
                            >
                              <Ionicons name="checkbox-outline" size={16} color={mine ? palette.white : accent} />
                              <View style={styles.todoAttachmentCopy}>
                                <Text translate={false} numberOfLines={2} preserveColor={mine} style={[styles.todoAttachmentTitle, { color: mine ? palette.white : colors.ink }]}>{message.todoAttachment.title}</Text>
                                <Text preserveColor={mine} style={[styles.todoAttachmentMeta, { color: mine ? "rgba(255,255,255,.72)" : colors.muted }]}>
                                  {message.todoAttachment.completionMode === "shared" ? "Shared completion" : "Everyone completes it"}
                                </Text>
                              </View>
                              <Ionicons name="chevron-forward" size={14} color={mine ? palette.white : colors.faint} />
                            </Pressable>
                          ) : null}
                          {message.text ? (
                            <Text
                              translate={false}
                              selectable
                              preserveColor={mine}
                              style={[
                                styles.messageText,
                                { color: mine ? palette.white : colors.ink },
                              ]}
                            >
                              {message.text}
                            </Text>
                          ) : null}
                          <Text
                            style={[
                              styles.messageTime,
                              {
                                color: mine
                                  ? "rgba(255,255,255,.72)"
                                  : colors.faint,
                              },
                            ]}
                          >
                            {formatClockTime(
                              timestamp,
                              state.settings.timeFormat,
                              locale,
                            )}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </React.Fragment>
                );
              })
            ) : (
              <View style={styles.empty}>
                <Ionicons
                  name="chatbubble-ellipses-outline"
                  size={27}
                  color={accent}
                />
                <Text style={styles.emptyTitle}>Start the conversation</Text>
                <Text style={styles.emptyText}>
                  Messages and images in this thread stay separate from other
                  chats.
                </Text>
              </View>
            )}
          </ScrollView>

          <View
            style={[
              styles.composerDock,
              {
                // Android keeps the tab bar in normal navigator layout, so the
                // scene always ends at the exact usable bottom: above the bar
                // when closed, and above the resized IME viewport when open.
                // Web/iOS retain their overlaid bar and reserve its height here.
                paddingBottom:
                  Platform.OS === "android"
                    ? 0
                    : keyboardVisible
                      ? 0
                      : tabBarHeight,
              },
            ]}
          >
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
            {attachedTodo ? (
              <View style={[styles.todoPreview, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="checkbox-outline" size={16} color={accent} />
                <View style={styles.todoAttachmentCopy}>
                  <Text translate={false} numberOfLines={1} style={[styles.todoAttachmentTitle, { color: colors.ink }]}>{attachedTodo.title}</Text>
                  <Text style={[styles.todoAttachmentMeta, { color: colors.muted }]}>Attached group to-do</Text>
                </View>
                <Pressable accessibilityLabel="Remove attached to-do" onPress={() => setAttachedTodoId(undefined)} hitSlop={8}>
                  <Ionicons name="close" size={17} color={colors.muted} />
                </Pressable>
              </View>
            ) : null}
            {todoPickerOpen && groupTodosAvailable ? (
              <View style={[styles.todoPicker, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.todoPickerHeading}>
                  <Text style={[styles.todoPickerTitle, { color: colors.ink }]}>Attach a group to-do</Text>
                  <Pressable onPress={() => router.navigate("/group-todo-editor" as never)}>
                    <Text style={[styles.todoPickerNew, { color: accent }]}>+ New</Text>
                  </Pressable>
                </View>
                <ScrollView nestedScrollEnabled style={styles.todoPickerList} keyboardShouldPersistTaps="handled">
                  {attachableGroupTodos.slice(0, 40).map((todo) => (
                    <Pressable
                      key={todo.id}
                      onPress={() => {
                        setAttachedTodoId(todo.id);
                        setTodoPickerOpen(false);
                      }}
                      style={[styles.todoPickerRow, { borderTopColor: colors.border }]}
                    >
                      <Ionicons name="ellipse-outline" size={15} color={accent} />
                      <Text translate={false} numberOfLines={1} style={[styles.todoPickerRowText, { color: colors.ink }]}>{todo.title}</Text>
                    </Pressable>
                  ))}
                  {!attachableGroupTodos.length ? (
                    <Text style={[styles.todoPickerEmpty, { color: colors.muted }]}>No group to-dos yet.</Text>
                  ) : null}
                </ScrollView>
              </View>
            ) : null}
            <View style={styles.quickRow}>
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
              {groupTodosAvailable ? (
                <Quick
                  label="To-Do"
                  icon="checkbox-outline"
                  onPress={() => setTodoPickerOpen((open) => !open)}
                />
              ) : null}
            </View>
            <TutorialTarget id="chat-composer">
            <View
              style={[
                styles.composer,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Pressable
                accessibilityLabel="Attach image"
                onPress={chooseImage}
                style={styles.attach}
              >
                <Ionicons name="image-outline" size={20} color={accent} />
              </Pressable>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onFocus={handleComposerFocus}
                preventWebFocusZoom
                onKeyPress={(event) => {
                  if (Platform.OS !== "web") return;
                  const key = event.nativeEvent as typeof event.nativeEvent & {
                    isComposing?: boolean;
                    shiftKey?: boolean;
                  };
                  if (
                    key.key !== "Enter" ||
                    key.shiftKey ||
                    key.isComposing
                  )
                    return;
                  event.preventDefault();
                  submit();
                }}
                onSubmitEditing={submit}
                placeholder={
                  recipient
                    ? `Message ${memberDisplayName(state, recipient)}…`
                    : "Message the group…"
                }
                placeholderTextColor={palette.faint}
                style={[styles.input, { color: colors.ink }]}
                returnKeyType="send"
                multiline
                submitBehavior={Platform.OS === "web" ? "newline" : "submit"}
              />
              <Pressable
                disabled={!draft.trim() && !imageUri && !attachedTodo}
                onPress={submit}
                style={({ pressed }) => [
                  styles.send,
                  { backgroundColor: accent },
                  !draft.trim() && !imageUri && !attachedTodo && styles.sendDisabled,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons name="arrow-up" size={18} color={palette.white} />
              </Pressable>
            </View>
            </TutorialTarget>
          </View>
        </View>
      </KeyboardAvoidingView>
      </GestureDetector>
    </SafeAreaView>
  );
}

export default ChatScreen;

function ConversationButton({
  label,
  icon,
  selected,
  unread,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  unread?: boolean;
  onPress: () => void;
}) {
  const accent = useGroupAccent();
  const colors = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.conversationButton,
        selected && styles.conversationButtonSelected,
        selected && { backgroundColor: colors.card },
      ]}
    >
      {unread ? <View style={styles.unreadDot} /> : null}
      <View
        style={[
          styles.conversationIcon,
          selected && styles.conversationIconSelected,
          { backgroundColor: selected ? accent : colors.card },
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
          { color: selected ? accent : colors.muted },
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
  const colors = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.quick,
        { backgroundColor: colors.card },
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={14} color={accent} />
      <Text style={[styles.quickText, { color: accent }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.canvas },
  flex: { flex: 1 },
  pageHeader: {
    minHeight: 56,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    gap: 12,
  },
  pageTitle: { fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
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
    position: "relative",
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
    position: "relative",
    alignItems: "center",
    paddingVertical: 7,
    borderRadius: 13,
    gap: 3,
  },
  personButtonSelected: { backgroundColor: palette.card },
  unreadDot: {
    position: "absolute",
    right: 5,
    top: 4,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#F06A45",
    borderWidth: 1.5,
    borderColor: palette.white,
    zIndex: 2,
  },
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
  messages: {
    flexGrow: 1,
    justifyContent: "flex-end",
    gap: 13,
    paddingVertical: 15,
    paddingHorizontal: 14,
  },
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
  todoAttachment: {
    minWidth: 180,
    maxWidth: 240,
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 9,
    paddingVertical: 7,
    marginBottom: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  todoAttachmentCopy: { flex: 1, minWidth: 0 },
  todoAttachmentTitle: { fontSize: 9, lineHeight: 13, fontWeight: "900" },
  todoAttachmentMeta: { fontSize: 7, lineHeight: 10, fontWeight: "700", marginTop: 1 },
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
  todoPreview: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    marginHorizontal: 14,
    marginBottom: 7,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  todoPicker: {
    maxHeight: 190,
    borderWidth: 1,
    borderRadius: 13,
    marginHorizontal: 14,
    marginBottom: 7,
    overflow: "hidden",
  },
  todoPickerHeading: {
    minHeight: 38,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  todoPickerTitle: { fontSize: 9, fontWeight: "900" },
  todoPickerNew: { fontSize: 8, fontWeight: "900" },
  todoPickerList: { maxHeight: 145 },
  todoPickerRow: {
    minHeight: 38,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  todoPickerRowText: { flex: 1, fontSize: 8, fontWeight: "800" },
  todoPickerEmpty: { fontSize: 8, paddingHorizontal: 10, paddingBottom: 10 },
  composerDock: { flexShrink: 0 },
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
  quickRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    paddingHorizontal: 14,
    marginBottom: 7,
  },
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
  dateStamp: {
    alignSelf: "center",
    fontSize: 8,
    fontWeight: "900",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 9,
    overflow: "hidden",
  },
  messageTime: {
    fontSize: 7,
    textAlign: "right",
    marginTop: 1,
    paddingHorizontal: 5,
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
    flex: 1,
    alignItems: "flex-end",
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
