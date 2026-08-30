import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { router, usePathname } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "@/src/components/AppText";
import { memberDisplayName } from "@/src/domain/members";
import { chatSharePreview } from "@/src/domain/social";
import { useApp } from "@/src/state/AppProvider";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";
import { useAppColors, useGroupAccent } from "@/src/theme";

type Banner = {
  id: string;
  title: string;
  body: string;
  senderId?: string;
  direct: boolean;
};

const RECENT_MESSAGE_MS = 2 * 60 * 1000;

export function InAppChatBanner() {
  const { state, hydrated } = useApp();
  const tutorialSandbox = useTutorialSandboxActive();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const [banner, setBanner] = useState<Banner | null>(null);
  const stateRef = useRef(state);
  const seenRef = useRef(new Set<string>());
  const initializedForRef = useRef<string | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const motion = useRef(new Animated.Value(0)).current;
  stateRef.current = state;

  const show = useCallback(
    (next: Banner) => {
      if (seenRef.current.has(next.id)) return;
      seenRef.current.add(next.id);
      if (pathname === "/chat") return;
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setBanner(next);
      motion.stopAnimation();
      motion.setValue(0);
      Animated.spring(motion, {
        toValue: 1,
        damping: 18,
        stiffness: 220,
        mass: 0.75,
        useNativeDriver: true,
      }).start();
      hideTimerRef.current = setTimeout(() => {
        Animated.timing(motion, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }).start(({ finished }) => finished && setBanner(null));
      }, 4200);
    },
    [motion, pathname],
  );

  useEffect(() => {
    if (!hydrated) return;
    const scope = `${state.currentUserId}:${state.group.id}`;
    if (initializedForRef.current !== scope) {
      initializedForRef.current = scope;
      seenRef.current = new Set(state.messages.map((message) => message.id));
      return;
    }
    const now = Date.now();
    const incoming = state.messages
      .filter((message) => {
        const createdAt = new Date(message.createdAt).getTime();
        return (
          message.kind === "message" &&
          message.senderId !== state.currentUserId &&
          !seenRef.current.has(message.id) &&
          Number.isFinite(createdAt) &&
          now - createdAt <= RECENT_MESSAGE_MS
        );
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    // A reconnect can hydrate several rows; announce only the newest rather
    // than stacking historical banners.
    incoming.slice(0, -1).forEach((message) => seenRef.current.add(message.id));
    const message = incoming.at(-1);
    if (!message) return;
    const sender = state.group.members.find((item) => item.id === message.senderId);
    const senderName = sender
      ? memberDisplayName(stateRef.current, sender)
      : "A group member";
    const sharedMessage = chatSharePreview(message.text);
    const hasAttachment = Boolean(
      sharedMessage.hasAttachment || message.todoAttachment,
    );
    const preview = sharedMessage.text
      ? `${sharedMessage.text}${hasAttachment ? " · Attachment" : ""}`
      : hasAttachment
        ? "Sent an attachment"
        : message.imageUri
          ? "Sent an image"
          : "Sent a message";
    show({
      id: message.id,
      title: message.recipientId
        ? `Direct message from ${senderName}`
        : `Group message in ${state.group.name}`,
      body: message.recipientId ? preview : `${senderName}: ${preview}`,
      senderId: message.senderId,
      direct: Boolean(message.recipientId),
    });
  }, [hydrated, show, state.currentUserId, state.group, state.messages]);

  useEffect(() => {
    if (tutorialSandbox || Platform.OS === "web") return;
    const subscription = Notifications.addNotificationReceivedListener(
      (notification) => {
        const content = notification.request.content;
        const data = content.data;
        if (data?.route !== "/chat") return;
        show({
          id:
            typeof data.messageId === "string"
              ? data.messageId
              : notification.request.identifier,
          title: content.title ?? "New message",
          body: content.body ?? "Open chat to read it.",
          senderId:
            typeof data.senderId === "string" ? data.senderId : undefined,
          direct: String(content.title ?? "").startsWith("Direct message"),
        });
      },
    );
    return () => subscription.remove();
  }, [show, tutorialSandbox]);

  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    [],
  );

  if (!banner) return null;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          styles.position,
          {
            top: insets.top + 8,
            opacity: motion,
            transform: [
              {
                translateY: motion.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-22, 0],
                }),
              },
            ],
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${banner.title}. ${banner.body}`}
          onPress={() => {
            setBanner(null);
            router.push(
              banner.direct && banner.senderId
                ? ({ pathname: "/chat", params: { recipient: banner.senderId } } as never)
                : ("/chat" as never),
            );
          }}
          style={[
            styles.banner,
            {
              backgroundColor: colors.card,
              borderColor: accent,
            },
          ]}
        >
          <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="chatbubble-ellipses" size={18} color={accent} />
          </View>
          <View style={styles.copy}>
            <Text translate={false} numberOfLines={1} style={[styles.title, { color: colors.ink }]}>
              {banner.title}
            </Text>
            <Text translate={false} numberOfLines={2} style={[styles.body, { color: colors.muted }]}>
              {banner.body}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  position: { position: "absolute", left: 12, right: 12, zIndex: 1000, elevation: 20 },
  banner: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: "800" },
  body: { marginTop: 2, fontSize: 13, lineHeight: 17 },
});
