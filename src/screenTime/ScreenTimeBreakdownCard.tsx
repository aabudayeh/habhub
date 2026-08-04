import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "@/src/components/AppText";
import { Button, Card } from "@/src/components/ui";
import { dateKey } from "@/src/domain/date";
import { useLocalization } from "@/src/i18n";
import { translateDomainText } from "@/src/i18n/domain";
import { notifyScreenTimeAppLimits } from "@/src/notifications/push";
import {
  hasScreenTimeAccess,
  isScreenTimeSupported,
  queryScreenTime,
  requestScreenTimeAccess,
  ScreenTimeAppUsage,
  ScreenTimeReport,
} from "@/src/screenTime";
import {
  readScreenTimeAppLimits,
  removeScreenTimeAppLimit,
  saveScreenTimeAppLimit,
  ScreenTimeAppLimit,
} from "@/src/screenTime/appLimits";
import { cacheScreenTimeReport, readCachedScreenTimeReport } from "@/src/screenTime/cache";
import { useApp } from "@/src/state/AppProvider";
import { useAppColors, useGroupAccent } from "@/src/theme";

type LoadState = "loading" | "ready" | "permission" | "empty";
const dayStart = (value: string) => new Date(`${value}T00:00:00`).getTime();
const dayEnd = (value: string) => new Date(`${value}T23:59:59.999`).getTime();

function durationLabel(milliseconds: number, language: Parameters<typeof translateDomainText>[0]) {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  const minuteUnit = translateDomainText(language, "min");
  if (minutes < 60) return `${minutes} ${minuteUnit}`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const hourUnit = translateDomainText(language, "hr");
  return remainder ? `${hours} ${hourUnit} ${remainder} ${minuteUnit}` : `${hours} ${hourUnit}`;
}

/** Device-only per-app usage and limits; package-level data is never uploaded. */
export function ScreenTimeBreakdownCard({ dates }: { dates: string[] }) {
  const { state } = useApp();
  const colors = useAppColors();
  const accent = useGroupAccent();
  const { language, t } = useLocalization();
  const [report, setReport] = useState<ScreenTimeReport | null>(null);
  const [limits, setLimits] = useState<ScreenTimeAppLimit[]>([]);
  const [editingPackage, setEditingPackage] = useState<string | null>(null);
  const [draftMinutes, setDraftMinutes] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const rangeKey = dates.join("|");
  const isToday = dates.length === 1 && dates[0] === dateKey();

  const format = (source: string, values: Record<string, string | number>) => {
    let output = t(source);
    Object.entries(values).forEach(([key, value]) => {
      output = output.replaceAll(`{${key}}`, String(value));
    });
    return output;
  };

  useEffect(() => {
    let cancelled = false;
    void readScreenTimeAppLimits(state.currentUserId).then((next) => {
      if (!cancelled) setLimits(next);
    });
    return () => { cancelled = true; };
  }, [state.currentUserId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (Platform.OS !== "android" || !isScreenTimeSupported()) {
        if (!cancelled) setLoadState("empty");
        return;
      }
      setLoadState("loading");
      const first = dates[0];
      const last = dates[dates.length - 1];
      if (!first || !last) {
        if (!cancelled) setLoadState("empty");
        return;
      }
      if (dates.length === 1) {
        const cached = await readCachedScreenTimeReport(first);
        if (cached && !cancelled) {
          setReport(cached);
          setLoadState(cached.apps.length ? "ready" : "empty");
        }
        if (cached && first !== dateKey()) return;
      }
      if (!(await hasScreenTimeAccess())) {
        if (!cancelled) setLoadState("permission");
        return;
      }
      const from = dayStart(first);
      const to = Math.min(Date.now(), dayEnd(last));
      if (from >= to) {
        if (!cancelled) setLoadState("empty");
        return;
      }
      const next = await queryScreenTime(from, to, 100);
      if (dates.length === 1) await cacheScreenTimeReport(first, next);
      if (!cancelled) {
        setReport(next);
        setLoadState(next.apps.length ? "ready" : "empty");
      }
    }
    void load().catch(() => { if (!cancelled) setLoadState("empty"); });
    return () => { cancelled = true; };
    // rangeKey represents the date array without retriggering on an unstable array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  const visibleApps = useMemo(() => {
    const apps = report?.apps ?? [];
    const top = apps.slice(0, 6);
    const limited = new Set(limits.map((item) => item.packageName));
    return [...top, ...apps.filter((app) => limited.has(app.packageName) && !top.some((item) => item.packageName === app.packageName))];
  }, [limits, report]);
  const maximum = visibleApps[0]?.foregroundMs ?? 1;
  const validDraft = Number.isInteger(Number(draftMinutes)) && Number(draftMinutes) >= 1 && Number(draftMinutes) <= 1_440;

  function beginEditing(app: ScreenTimeAppUsage) {
    const limit = limits.find((item) => item.packageName === app.packageName);
    setEditingPackage(app.packageName);
    setDraftMinutes(limit ? String(limit.targetMinutes) : "");
  }

  async function saveLimit(app: ScreenTimeAppUsage) {
    if (!validDraft || saving) return;
    setSaving(true);
    try {
      setLimits(await saveScreenTimeAppLimit(state.currentUserId, {
        packageName: app.packageName,
        appName: app.appName,
        targetMinutes: Number(draftMinutes),
      }));
      setEditingPackage(null);
      if (report) await notifyScreenTimeAppLimits(state, report).catch(() => undefined);
    } finally { setSaving(false); }
  }

  async function removeLimit(packageName: string) {
    if (saving) return;
    setSaving(true);
    try {
      setLimits(await removeScreenTimeAppLimit(state.currentUserId, packageName));
      setEditingPackage(null);
    } finally { setSaving(false); }
  }

  if (Platform.OS !== "android") return null;
  return (
    <Card style={styles.card}>
      <View style={styles.heading}>
        <View style={styles.titleRow}>
          <Ionicons name="apps-outline" size={17} color={accent} />
          <Text style={[styles.title, { color: colors.ink }]}>App usage</Text>
        </View>
        {report ? <Text translate={false} style={[styles.total, { color: accent }]}>{durationLabel(report.screenTimeMs, language)}</Text> : null}
      </View>
      {loadState === "permission" ? (
        <Pressable accessibilityRole="button" onPress={() => void requestScreenTimeAccess()} style={[styles.permission, { borderColor: colors.border }]}>
          <Text style={[styles.message, { color: colors.muted }]}>Enable Android Usage Access to see the private app breakdown.</Text>
          <Text style={[styles.enable, { color: accent }]}>Enable</Text>
        </Pressable>
      ) : loadState === "loading" && !report ? (
        <Text style={[styles.message, { color: colors.muted }]}>Loading app usage…</Text>
      ) : !visibleApps.length ? (
        <Text style={[styles.message, { color: colors.muted }]}>No app usage recorded.</Text>
      ) : (
        <>
          <Text translate={false} style={[styles.mostUsed, { color: colors.muted }]}>{t("Most used")}: {visibleApps[0].appName}</Text>
          <View style={styles.list}>
            {visibleApps.map((app) => {
              const limit = limits.find((item) => item.packageName === app.packageName);
              const targetProgress = limit ? app.foregroundMs / 60_000 / limit.targetMinutes : null;
              const fillColor = targetProgress !== null && targetProgress >= 1 ? "#EF4444" : targetProgress !== null && targetProgress >= 0.9 ? "#F59E0B" : accent;
              return (
                <View key={app.packageName} style={styles.appBlock}>
                  <View style={styles.row}>
                    <Text translate={false} numberOfLines={1} style={[styles.app, { color: colors.ink }]}>{app.appName}</Text>
                    <View style={[styles.track, { backgroundColor: colors.canvas }]}>
                      <View style={[styles.fill, { backgroundColor: fillColor, width: `${Math.max(3, Math.min(100, (targetProgress ?? app.foregroundMs / maximum) * 100))}%` }]} />
                    </View>
                    <Text translate={false} style={[styles.duration, { color: colors.muted }]}>{durationLabel(app.foregroundMs, language)}</Text>
                    {isToday ? (
                      <Pressable accessibilityLabel={format("Daily limit for {app}", { app: app.appName })} accessibilityRole="button" onPress={() => beginEditing(app)} hitSlop={8} style={styles.limitIcon}>
                        <Ionicons name={limit ? "notifications" : "notifications-outline"} size={15} color={limit ? accent : colors.faint} />
                      </Pressable>
                    ) : null}
                  </View>
                  {limit ? <Text translate={false} style={[styles.limitLabel, { color: colors.muted }]}>{format("{minutes} min daily limit", { minutes: limit.targetMinutes })}</Text> : null}
                  {editingPackage === app.packageName ? (
                    <View style={styles.editor}>
                      <TextInput accessibilityLabel="Minutes" keyboardType="number-pad" maxLength={4} onChangeText={setDraftMinutes} placeholder="Minutes" selectTextOnFocus value={draftMinutes} style={[styles.input, { backgroundColor: colors.canvas, borderColor: colors.border, color: colors.ink }]} />
                      <Button label="Save" onPress={() => void saveLimit(app)} size="small" disabled={!validDraft} loading={saving} />
                      {limit ? <Button label="Remove" onPress={() => void removeLimit(app.packageName)} size="small" variant="danger" disabled={saving} /> : null}
                      <Button label="Cancel" onPress={() => setEditingPackage(null)} size="small" variant="ghost" disabled={saving} />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
          <Text style={[styles.privacy, { color: colors.faint }]}>Approximate Android foreground time · stored only on this device</Text>
          {isToday ? <Text style={[styles.privacy, { color: colors.faint }]}>App limits stay on this device.</Text> : null}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 9 },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  title: { fontSize: 14, fontWeight: "900" },
  total: { fontSize: 13, fontWeight: "900" },
  mostUsed: { fontSize: 11, fontWeight: "700" },
  list: { gap: 7 },
  appBlock: { gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 7 },
  app: { width: 82, fontSize: 11, fontWeight: "700" },
  track: { flex: 1, height: 5, borderRadius: 999, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 999 },
  duration: { width: 49, textAlign: "right", fontSize: 10, fontWeight: "700" },
  limitIcon: { width: 20, height: 24, alignItems: "center", justifyContent: "center" },
  limitLabel: { marginLeft: 89, fontSize: 9, fontWeight: "700" },
  editor: { flexDirection: "row", alignItems: "center", gap: 5, marginLeft: 89, flexWrap: "wrap" },
  input: { width: 66, minHeight: 34, borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, fontSize: 11, fontWeight: "700" },
  privacy: { fontSize: 9, lineHeight: 13 },
  message: { flex: 1, fontSize: 11, lineHeight: 16 },
  permission: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 10 },
  enable: { fontSize: 11, fontWeight: "900" },
});
