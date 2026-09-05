import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  AppText as Text,
  AppTextInput as TextInput,
} from "@/src/components/AppText";
import { Button } from "@/src/components/ui";
import {
  SAFETY_REPORT_REASONS,
  SafetyReportReason,
} from "@/src/safety/userSafety";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";

export function SafetyReportSheet({
  visible,
  title,
  subject,
  demoMode,
  busy,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  subject: string;
  demoMode: boolean;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (reason: SafetyReportReason, details: string) => void;
}) {
  const colors = useAppColors();
  const accent = useGroupAccent();
  const [reason, setReason] = useState<SafetyReportReason>("harassment");
  const [details, setDetails] = useState("");
  useEffect(() => {
    if (!visible) return;
    setReason("harassment");
    setDetails("");
  }, [visible, subject]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={busy ? undefined : onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close report"
          disabled={busy}
          onPress={onClose}
          style={styles.backdrop}
        />
        <SafeAreaView
          accessibilityViewIsModal
          edges={["bottom"]}
          style={[styles.sheet, { backgroundColor: colors.card }]}
        >
          <View style={styles.handle} />
          <View style={styles.heading}>
            <View style={[styles.headingIcon, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name="flag-outline" size={20} color={accent} />
            </View>
            <View style={styles.copy}>
              <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
              <Text
                translate={false}
                numberOfLines={1}
                style={[styles.subject, { color: colors.muted }]}
              >
                {subject}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Close report"
              disabled={busy}
              onPress={onClose}
              hitSlop={10}
            >
              <Ionicons name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            <Text style={[styles.prompt, { color: colors.ink }]}>What happened?</Text>
            <View style={styles.reasons}>
              {SAFETY_REPORT_REASONS.map((item) => {
                const selected = reason === item.id;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => setReason(item.id)}
                    style={[
                      styles.reason,
                      {
                        backgroundColor: selected
                          ? colors.primarySoft
                          : colors.canvas,
                        borderColor: selected ? accent : colors.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name={selected ? "radio-button-on" : "radio-button-off"}
                      size={17}
                      color={selected ? accent : colors.faint}
                    />
                    <Text style={[styles.reasonText, { color: colors.ink }]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.prompt, { color: colors.ink }]}>Details (optional)</Text>
            <TextInput
              accessibilityLabel="Report details"
              value={details}
              onChangeText={(value) => setDetails(value.slice(0, 500))}
              multiline
              maxLength={500}
              placeholder="Share only what helps a moderator understand the issue."
              placeholderTextColor={colors.faint}
              style={[
                styles.input,
                {
                  color: colors.ink,
                  borderColor: colors.border,
                  backgroundColor: colors.canvas,
                },
              ]}
            />
            <Text style={[styles.counter, { color: colors.faint }]}>
              {details.length}/500
            </Text>
            {demoMode ? (
              <View style={[styles.demoNote, { backgroundColor: colors.primarySoft }]}>
                <Ionicons name="information-circle-outline" size={18} color={accent} />
                <Text style={[styles.demoText, { color: colors.muted }]}>
                  Demo reports stay on this device for preview only. They are not sent to HabHub or group admins.
                </Text>
              </View>
            ) : (
              <Text style={[styles.explainer, { color: colors.muted }]}>
                Your report enters a protected operator queue available only to the HabHub service operator. An eligible group moderator may also review it, but the reported person cannot review their own report. Nothing is posted to group chat.
              </Text>
            )}
            <View style={styles.actions}>
              <Button
                label="Cancel"
                variant="ghost"
                disabled={busy}
                onPress={onClose}
              />
              <Button
                label={demoMode ? "Save demo report" : "Submit report"}
                icon="flag-outline"
                loading={busy}
                onPress={() => onSubmit(reason, details)}
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10, 18, 15, .46)",
  },
  sheet: {
    maxHeight: "90%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 9,
    shadowColor: palette.ink,
    shadowOffset: { width: 0, height: -5 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 24,
  },
  handle: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 3,
    backgroundColor: palette.border,
    marginBottom: 12,
  },
  heading: { flexDirection: "row", alignItems: "center", gap: 10 },
  headingIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, fontWeight: "900" },
  subject: { marginTop: 2, fontSize: 10 },
  content: { paddingTop: 18, paddingBottom: 12 },
  prompt: { fontSize: 11, fontWeight: "900", marginBottom: 8 },
  reasons: { gap: 7, marginBottom: 17 },
  reason: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  reasonText: { flex: 1, fontSize: 10, lineHeight: 14, fontWeight: "800" },
  input: {
    minHeight: 88,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 11,
    paddingVertical: 10,
    fontSize: 11,
    lineHeight: 16,
    textAlignVertical: "top",
  },
  counter: { alignSelf: "flex-end", fontSize: 8, marginTop: 4 },
  demoNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 12,
    padding: 10,
    marginTop: 12,
  },
  demoText: { flex: 1, fontSize: 9, lineHeight: 14 },
  explainer: { fontSize: 9, lineHeight: 14, marginTop: 12 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 16 },
});
