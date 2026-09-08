import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from "react-native";

import { useGroupNotes } from "@/src/cloud/useGroupHubContent";
import { useCloudSyncActions } from "@/src/cloud/CloudSyncProvider";
import type { GroupSocialComment } from "@/src/cloud/groupSocial";
import { useGroupSocialEngagement } from "@/src/cloud/useGroupSocialEngagement";
import { AppText as Text, AppTextInput as TextInput } from "@/src/components/AppText";
import { GroupSocialActionBar } from "@/src/components/GroupSocialActionBar";
import { SafetyReportSheet } from "@/src/components/SafetyReportSheet";
import { Card, IconButton, PageHeader, Screen } from "@/src/components/ui";
import { relativeTime } from "@/src/domain/date";
import { memberDisplayName } from "@/src/domain/members";
import { LocalizedAlert as Alert } from "@/src/i18n";
import { shareText } from "@/src/lib/shareText";
import { useUserSafety } from "@/src/safety/userSafety";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";
import type { GroupNote } from "@/src/types";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";

export default function GroupNotesScreen() {
  const { state } = useApp();
  const cloud = useCloudSyncActions();
  const tutorialSandbox = useTutorialSandboxActive();
  const safety = useUserSafety(state.currentUserId, tutorialSandbox);
  const params = useLocalSearchParams<{
    groupId?: string | string[];
    noteId?: string | string[];
    noteFocusAt?: string | string[];
  }>();
  const requestedGroupId = Array.isArray(params.groupId)
    ? params.groupId[0]
    : params.groupId;
  const focusedNoteId = Array.isArray(params.noteId)
    ? params.noteId[0]
    : params.noteId;
  const attemptedGroupSwitch = useRef<string | undefined>(undefined);
  const [groupSwitchError, setGroupSwitchError] = useState<string>();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const notes = useGroupNotes(state.group.id);
  const targets = useMemo(
    () => notes.notes.map((note) => ({ type: "group_note" as const, id: note.id })),
    [notes.notes],
  );
  const social = useGroupSocialEngagement(state.group.id, targets, "group_notes");
  const [editing, setEditing] = useState<GroupNote | null>();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [commentReport, setCommentReport] = useState<{
    comment: GroupSocialComment;
    displayName: string;
  }>();
  const [commentReportBusy, setCommentReportBusy] = useState(false);
  const currentMember = state.group.members.find((member) => member.id === state.currentUserId);
  const canManageAll = currentMember?.role === "owner" || currentMember?.role === "admin";
  const orderedNotes = useMemo(
    () =>
      [...notes.notes].sort((left, right) => {
        if (left.id === focusedNoteId) return -1;
        if (right.id === focusedNoteId) return 1;
        return right.updatedAt.localeCompare(left.updatedAt);
      }),
    [focusedNoteId, notes.notes],
  );

  useEffect(() => {
    const groupId = requestedGroupId;
    if (
      !groupId ||
      groupId === state.group.id ||
      attemptedGroupSwitch.current === groupId ||
      !state.groups.some((group) => group.id === groupId)
    )
      return;
    attemptedGroupSwitch.current = groupId;
    setGroupSwitchError(undefined);
    void cloud.switchGroup(groupId).catch((reason) =>
      setGroupSwitchError(
        reason instanceof Error ? reason.message : "That group is not available.",
      ),
    );
  }, [cloud, requestedGroupId, state.group.id, state.groups]);

  if (requestedGroupId && requestedGroupId !== state.group.id) {
    const known = state.groups.some((group) => group.id === requestedGroupId);
    return (
      <Screen>
        <PageHeader
          title="Opening Group Notes"
          showMenu={false}
          action={<IconButton icon="close" label="Close" onPress={() => router.back()} />}
        />
        <Card style={styles.switchCard}>
          {!groupSwitchError && known ? <ActivityIndicator color={accent} /> : null}
          <Text style={[styles.emptyTitle, { color: colors.ink }]}>
            {groupSwitchError || (known ? "Switching to the linked group…" : "This group is no longer available.")}
          </Text>
          {groupSwitchError && known ? (
            <Pressable
              onPress={() => {
                attemptedGroupSwitch.current = undefined;
                setGroupSwitchError(undefined);
                void cloud.switchGroup(requestedGroupId).catch((reason) =>
                  setGroupSwitchError(reason instanceof Error ? reason.message : "Try again."),
                );
              }}
              style={[styles.retryButton, { borderColor: accent }]}
            >
              <Text style={[styles.buttonText, { color: accent }]}>Try again</Text>
            </Pressable>
          ) : null}
        </Card>
      </Screen>
    );
  }

  function openEditor(note?: GroupNote) {
    setEditing(note ?? null);
    setTitle(note?.title ?? "");
    setBody(note?.body ?? "");
  }

  async function save() {
    if (!body.trim()) return Alert.alert("Write a note", "A group note needs some text.");
    setSaving(true);
    try {
      await notes.save({
        id: editing?.id,
        groupId: state.group.id,
        title,
        body,
        expectedRevision: editing?.revision,
      });
      setEditing(undefined);
    } catch (reason) {
      Alert.alert("Note not saved", reason instanceof Error ? reason.message : "Refresh and try again.");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(note: GroupNote) {
    Alert.alert("Delete group note?", "The note and its discussion will be removed for everyone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void notes.remove(note).catch((reason) => Alert.alert("Note not deleted", reason instanceof Error ? reason.message : "Refresh and try again.")) },
    ]);
  }

  return (
    <Screen>
      <PageHeader
        eyebrow={state.group.name}
        translateEyebrow={false}
        title="Group Notes"
        subtitle="Shared ideas with one linked conversation."
        showMenu={false}
        action={<View style={styles.headerActions}><IconButton icon="add" label="Add group note" onPress={() => openEditor()} /><IconButton icon="close" label="Close" onPress={() => router.back()} /></View>}
      />
      {notes.error || social.error ? (
        <Pressable onPress={() => void Promise.all([notes.refresh(), social.refresh()])} style={[styles.notice, { borderColor: colors.border }]}>
          <Ionicons name="cloud-offline-outline" size={16} color={colors.muted} />
          <Text style={[styles.noticeText, { color: colors.muted }]}>Group notes did not fully refresh · Tap to retry</Text>
        </Pressable>
      ) : null}
      <View style={styles.list}>
        {orderedNotes.map((note) => {
          const target = { type: "group_note" as const, id: note.id };
          const key = social.targetKey(target);
          const author = state.group.members.find((member) => member.id === note.creatorId);
          const editable = note.creatorId === state.currentUserId || canManageAll;
          const focused = note.id === focusedNoteId;
          return (
            <Card
              key={note.id}
              style={[
                styles.card,
                focused && { borderColor: accent, borderWidth: 2 },
              ]}
            >
              <View style={styles.noteHeader}>
                <View style={styles.copy}>
                  <Text translate={false} style={[styles.title, { color: colors.ink }]}>{note.title || "Shared note"}</Text>
                  <Text translate={false} style={[styles.meta, { color: colors.muted }]}>{author ? memberDisplayName(state, author) : "Member"} · updated {relativeTime(note.updatedAt)}</Text>
                  {focused ? <Text style={[styles.focusedLabel, { color: accent }]}>Opened from your updates</Text> : null}
                </View>
                {editable ? <View style={styles.noteActions}><IconButton icon="create-outline" label="Edit note" onPress={() => openEditor(note)} /><IconButton icon="trash-outline" label="Delete note" onPress={() => confirmDelete(note)} /></View> : null}
              </View>
              <Text translate={false} selectable style={[styles.body, { color: colors.muted }]}>{note.body}</Text>
              <GroupSocialActionBar
                currentUserId={state.currentUserId}
                members={state.group.members}
                state={state}
                reactions={social.reactionsByTarget.get(key) ?? []}
                summary={social.summariesByTarget.get(key)}
                comments={social.commentsByTarget.get(key) ?? []}
                commentPage={social.commentPages.get(key)}
                onLoadCommentPage={(older) => void social.loadCommentPage(target, older)}
                onReact={(reaction) =>
                  void social.react(target, reaction).catch((reason) =>
                    Alert.alert(
                      "Reaction not saved",
                      reason instanceof Error
                        ? reason.message
                        : "Reconnect and try again.",
                    ),
                  )
                }
                onComment={(content) => social.comment(target, content)}
                onDeleteComment={social.removeComment}
                onReportComment={(comment) => {
                  const commentAuthor = state.group.members.find(
                    (member) => member.id === comment.userId,
                  );
                  setCommentReport({
                    comment,
                    displayName: commentAuthor
                      ? memberDisplayName(state, commentAuthor)
                      : "Member",
                  });
                }}
                onShare={() => void shareText(`${note.title || "Group note"}\n\n${note.body}`)}
              />
            </Card>
          );
        })}
        {!notes.loading && !notes.notes.length ? (
          <Pressable onPress={() => openEditor()} style={[styles.empty, { borderColor: colors.border }]}>
            <Ionicons name="document-text-outline" size={24} color={accent} />
            <Text style={[styles.emptyTitle, { color: colors.ink }]}>Start a shared note</Text>
            <Text style={[styles.emptyCopy, { color: colors.muted }]}>Plans, recipes, check-ins, and ideas stay easy to find and discuss.</Text>
          </Pressable>
        ) : null}
      </View>
      <Modal transparent animationType="fade" visible={editing !== undefined} onRequestClose={() => !saving && setEditing(undefined)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.sheetHeader}><Text style={[styles.sheetTitle, { color: colors.ink }]}>{editing ? "Edit group note" : "New group note"}</Text><IconButton icon="close" label="Close editor" onPress={() => setEditing(undefined)} /></View>
            <TextInput value={title} onChangeText={setTitle} maxLength={160} placeholder="Title (optional)" placeholderTextColor={colors.faint} style={[styles.input, { color: colors.ink, borderColor: colors.border, backgroundColor: colors.canvas }]} />
            <TextInput value={body} onChangeText={setBody} maxLength={8000} multiline autoFocus placeholder="Write something useful for the group…" placeholderTextColor={colors.faint} style={[styles.input, styles.bodyInput, { color: colors.ink, borderColor: colors.border, backgroundColor: colors.canvas }]} />
            <View style={styles.sheetButtons}><Pressable disabled={saving} onPress={() => setEditing(undefined)} style={[styles.button, { borderColor: colors.border }]}><Text style={[styles.buttonText, { color: colors.muted }]}>Cancel</Text></Pressable><Pressable disabled={saving} onPress={() => void save()} style={[styles.button, { backgroundColor: accent }]}><Text style={[styles.buttonText, { color: "#FFFFFF" }]}>{saving ? "Saving…" : "Save"}</Text></Pressable></View>
          </View>
        </View>
      </Modal>
      <SafetyReportSheet
        visible={Boolean(commentReport)}
        title="Report comment"
        subject={commentReport?.displayName ?? "Member"}
        demoMode={safety.mode === "demo"}
        busy={commentReportBusy}
        onClose={() => {
          if (!commentReportBusy) setCommentReport(undefined);
        }}
        onSubmit={(reason, details) => {
          const selected = commentReport;
          if (!selected) return;
          setCommentReportBusy(true);
          void safety
            .reportComment({
              groupId: state.group.id,
              commentId: selected.comment.id,
              authorId: selected.comment.userId,
              reportedDisplayName: selected.displayName,
              reason,
              details,
            })
            .then(() => {
              setCommentReport(undefined);
              Alert.alert(
                safety.mode === "demo"
                  ? "Demo report saved"
                  : "Report submitted",
                safety.mode === "demo"
                  ? "This preview report stays on this device."
                  : "Your report is in HabHub's protected operator queue. An eligible group moderator may also review it, but the reported person cannot review their own report.",
              );
            })
            .catch((error) =>
              Alert.alert(
                "Report not submitted",
                error instanceof Error ? error.message : "Try again.",
              ),
            )
            .finally(() => setCommentReportBusy(false));
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  list: { gap: 9 },
  card: { padding: 12 },
  noteHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 13, lineHeight: 17, fontWeight: "900" },
  meta: { fontSize: 8, lineHeight: 11, fontWeight: "700", marginTop: 2 },
  focusedLabel: { fontSize: 8, lineHeight: 11, fontWeight: "900", marginTop: 3 },
  body: { fontSize: 10, lineHeight: 16, marginTop: 10 },
  noteActions: { flexDirection: "row", alignItems: "center" },
  notice: { minHeight: 44, borderWidth: 1, borderRadius: 14, paddingHorizontal: 11, marginBottom: 9, flexDirection: "row", alignItems: "center", gap: 7 },
  noticeText: { flex: 1, fontSize: 8, fontWeight: "700" },
  empty: { minHeight: 150, borderWidth: 1, borderStyle: "dashed", borderRadius: 18, alignItems: "center", justifyContent: "center", padding: 22, gap: 5 },
  emptyTitle: { fontSize: 13, fontWeight: "900" },
  emptyCopy: { maxWidth: 280, fontSize: 9, lineHeight: 14, textAlign: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(5,14,36,.62)", alignItems: "center", justifyContent: "center", padding: 18 },
  sheet: { width: "100%", maxWidth: 520, borderWidth: 1, borderRadius: 22, padding: 16, gap: 9 },
  sheetHeader: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 16, fontWeight: "900" },
  input: { minHeight: 44, borderWidth: 1, borderRadius: 13, paddingHorizontal: 11, fontSize: 11 },
  bodyInput: { minHeight: 180, paddingVertical: 11, textAlignVertical: "top" },
  sheetButtons: { flexDirection: "row", gap: 8, marginTop: 3 },
  button: { flex: 1, minHeight: 43, borderWidth: 1, borderColor: "transparent", borderRadius: 13, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 10, fontWeight: "900" },
  switchCard: { minHeight: 140, alignItems: "center", justifyContent: "center", gap: 10, padding: 18 },
  retryButton: { minHeight: 40, paddingHorizontal: 18, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
