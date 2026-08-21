import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { AppText as Text } from "@/src/components/AppText";
import { LocalizedAlert as Alert, useLocale } from "@/src/i18n";

import { useAuth } from "@/src/auth/AuthProvider";
import { useCloudSync } from "@/src/cloud/CloudSyncProvider";
import {
  Button,
  Card,
  Chip,
  IconButton,
  PageHeader,
  Screen,
  SectionHeader,
} from "@/src/components/ui";
import { friendlyHealthOrigin } from "@/src/domain/health";
import { useHealthSync } from "@/src/health/HealthSyncProvider";
import {
  healthSyncSchedule,
  normalizeHealthSyncMode,
} from "@/src/health/schedule";
import { useApp } from "@/src/state/AppProvider";
import { ScreenTimeAccessCard } from "@/src/screenTime/ScreenTimeAccessCard";
import { palette, useAppColors, useGroupAccent } from "@/src/theme";
import { HealthDataType, SyncMode } from "@/src/types";
import { TutorialTarget } from "@/src/components/TutorialSpotlight";
import { GoogleHealthWebCard } from "@/src/components/GoogleHealthWebCard";
import { useTutorialSandboxActive } from "@/src/tutorial/TutorialSandboxContext";

const syncModes: {
  id: SyncMode;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  kind: "foreground" | "background";
}[] = [
  {
    id: "manual",
    title: "Manual refresh",
    subtitle: "Foreground only - Sync now or pull to refresh",
    icon: "hand-left-outline",
    kind: "foreground",
  },
  {
    id: "battery",
    title: "Battery saver",
    subtitle: "Background, including while HabHub is closed - ~12-hour minimum",
    icon: "battery-half-outline",
    kind: "background",
  },
  {
    id: "balanced",
    title: "Balanced",
    subtitle: "Background, including while HabHub is closed - ~6-hour minimum",
    icon: "sync-outline",
    kind: "background",
  },
  {
    id: "frequent",
    title: "Frequent",
    subtitle: "Background, including while HabHub is closed - ~1-hour minimum",
    icon: "flash-outline",
    kind: "background",
  },
];

const healthDataTypes: {
  id: HealthDataType;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  platforms?: readonly ("android" | "ios")[];
}[] = [
  {
    id: "steps",
    title: "Steps",
    subtitle: "Phone, watch, and connected activity apps",
    icon: "footsteps-outline",
  },
  {
    id: "active_energy",
    title: "Active energy",
    subtitle: "Calories burned through activity",
    icon: "flash-outline",
  },
  {
    id: "nutrition",
    title: "Food & nutrients",
    subtitle: "Calories, protein, fat, carbs, fiber, and sodium when supplied",
    icon: "restaurant-outline",
  },
  {
    id: "weight",
    title: "Weight",
    subtitle: "Body-weight measurements",
    icon: "scale-outline",
  },
  {
    id: "water",
    title: "Water",
    subtitle: "Hydration entries",
    icon: "water-outline",
  },
  {
    id: "workouts",
    title: "Workouts",
    subtitle: "Completed exercise sessions",
    icon: "barbell-outline",
  },
  {
    id: "body_fat",
    title: "Body fat",
    subtitle: "Body-fat percentage measurements",
    icon: "body-outline",
  },
  {
    id: "lean_body_mass",
    title: "Lean body mass",
    subtitle: "Lean-mass measurements in kilograms",
    icon: "fitness-outline",
  },
  {
    id: "body_water_mass",
    title: "Body water mass",
    subtitle: "Body-water measurements in kilograms from Health Connect",
    icon: "water-outline",
    platforms: ["android"],
  },
  {
    id: "bone_mass",
    title: "Bone mass",
    subtitle: "Bone-mass measurements in kilograms from Health Connect",
    icon: "accessibility-outline",
    platforms: ["android"],
  },
  {
    id: "blood_pressure",
    title: "Blood pressure",
    subtitle: "Systolic and diastolic readings",
    icon: "heart-outline",
  },
  {
    id: "heart_rate",
    title: "Pulse",
    subtitle: "Resting heart-rate readings",
    icon: "pulse-outline",
  },
  {
    id: "sleep",
    title: "Sleep",
    subtitle: "Sleep sessions and duration",
    icon: "moon-outline",
  },
  {
    id: "blood_glucose",
    title: "Blood glucose",
    subtitle: "Glucose readings",
    icon: "water-outline",
  },
  {
    id: "menstruation",
    title: "Cycle",
    subtitle: "Menstrual cycle entries",
    icon: "flower-outline",
  },
];

const supportedHealthDataTypes = healthDataTypes.filter(
  (item) =>
    !item.platforms ||
    ((Platform.OS === "android" || Platform.OS === "ios") &&
      item.platforms.includes(Platform.OS)),
);

const statusCopy = {
  disabled: ["Device only", "cloud-offline-outline"],
  initializing: ["Connecting…", "cloud-outline"],
  syncing: ["Syncing…", "sync-outline"],
  synced: ["Up to date", "cloud-done-outline"],
  offline: ["Offline · changes safe", "cloud-offline-outline"],
  conflict: ["Merged device changes", "git-merge-outline"],
  error: ["Needs attention", "warning-outline"],
} as const;

export default function SettingsScreen() {
  const tutorialSandbox = useTutorialSandboxActive();
  const { state, updateSettings, resetDemo } = useApp();
  const auth = useAuth();
  const cloud = useCloudSync();
  const health = useHealthSync();
  const accent = useGroupAccent();
  const colors = useAppColors();
  const locale = useLocale();
  const [busy, setBusy] = useState<
    "sync" | "pull" | "health" | "history" | "signout" | "delete" | null
  >(null);
  const [showDevices, setShowDevices] = useState(false);
  const [showHealthTypes, setShowHealthTypes] = useState(false);
  const [showHealthSources, setShowHealthSources] = useState(false);
  const [sourceBusy, setSourceBusy] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const isWebHealthBridge = Platform.OS === "web";
  const hasSyncedPhoneHealth = React.useMemo(
    () =>
      state.entries.some(
        (entry) =>
          entry.userId === state.currentUserId && Boolean(entry.sourceProvider),
      ),
    [state.currentUserId, state.entries],
  );
  const selectedSyncMode = normalizeHealthSyncMode(state.settings.syncMode);
  const selectedHealthSchedule = healthSyncSchedule(selectedSyncMode);

  async function run(
    kind: typeof busy,
    action: () => Promise<void>,
    failure: string,
  ) {
    setBusy(kind);
    try {
      await action();
    } catch (error) {
      Alert.alert(
        failure,
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setBusy(null);
    }
  }
  const syncLabel = statusCopy[cloud.status];
  const lastSync = cloud.lastSyncedAt
    ? new Date(cloud.lastSyncedAt).toLocaleString(locale)
    : "Not synced yet";
  const healthLastSync = health.lastSyncedAt
    ? new Date(health.lastSyncedAt).toLocaleString(locale)
    : "Not synced yet";
  const healthScheduleStatus = !selectedHealthSchedule.requestsBackground
    ? "Foreground only: use Sync now or pull to refresh."
    : !state.settings.healthSync.enabled
      ? "Connect health data to activate app-open checks and background requests."
      : !state.settings.healthSync.backgroundAccess
        ? "Background access is not available. HabHub will still check after the app opens when the selected interval has elapsed."
        : health.backgroundRegistration === "registered"
          ? "Background request registered, including while HabHub is closed. The phone decides the actual run time."
          : health.backgroundRegistration === "configuring"
            ? "Registering the background request on this device..."
            : "Background scheduling is unavailable right now. App-open checks and Sync now still work.";
  async function exportData() {
    if (tutorialSandbox) {
      return;
    }
    const portable = {
      ...state,
      groups: state.groups.map((group) => ({
        ...group,
        members: group.members.map((member) =>
          member.avatarStoragePath
            ? { ...member, avatarUri: undefined }
            : member,
        ),
      })),
      entries: state.entries.map((entry) =>
        entry.imageStoragePath ? { ...entry, imageUri: undefined } : entry,
      ),
      photos: state.photos.map((photo) =>
        photo.storagePath ? { ...photo, uri: undefined } : photo,
      ),
      messages: state.messages.map((message) =>
        message.imageStoragePath
          ? { ...message, imageUri: undefined }
          : message,
      ),
    };
    const json = JSON.stringify(portable, null, 2);
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const url = URL.createObjectURL(
        new Blob([json], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `habhub-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }
    await Share.share({ title: "HabHub data export", message: json });
  }

  return (
    <Screen>
      <PageHeader
        tutorialId="settings-header"
        eyebrow="HabHub"
        title="Cloud & health sync"
        subtitle="Account, device, backup, and health import preferences."
        showMenu={false}
        action={
          <IconButton
            icon="close"
            label="Close"
            onPress={() => router.back()}
          />
        }
      />
      <TutorialTarget id="settings-cloud-account">
        <SectionHeader title="Cloud account" />
      </TutorialTarget>
      {auth.status === "signedIn" ? (
        <Card>
          <View style={styles.heading}>
            <View style={styles.icon}>
              <Ionicons
                name={syncLabel[1]}
                size={23}
                color={cloud.status === "error" ? palette.red : accent}
              />
            </View>
            <View style={styles.copy}>
              <Text style={[styles.title, { color: colors.ink }]}>
                {auth.user?.email}
              </Text>
              <Text style={styles.meta}>
                {syncLabel[0]} · {lastSync}
              </Text>
            </View>
            <Chip
              label={cloud.pendingChanges ? "Saved locally" : "Cloud on"}
              selected={!cloud.pendingChanges}
              icon={
                cloud.pendingChanges ? "save-outline" : "cloud-done-outline"
              }
            />
          </View>
          <Text style={[styles.text, { color: colors.muted }]}>
            Logs, settings, chats, and private photos save on this device first,
            then sync automatically through your protected account.
          </Text>
          {cloud.errorMessage ? (
            <View
              style={[
                styles.notice,
                cloud.status === "error" && styles.errorNotice,
              ]}
            >
              <Ionicons
                name={
                  cloud.status === "error"
                    ? "warning-outline"
                    : "information-circle-outline"
                }
                size={17}
                color={cloud.status === "error" ? palette.red : accent}
              />
              <Text style={styles.noticeText}>{cloud.errorMessage}</Text>
            </View>
          ) : null}
          <View style={styles.buttons}>
            <View style={styles.grow}>
              <Button
                label="Sync now"
                icon="sync-outline"
                loading={busy === "sync" || cloud.status === "syncing"}
                onPress={() => run("sync", cloud.syncNow, "Sync failed")}
              />
            </View>
            <View style={styles.grow}>
              <Button
                label="Get latest"
                variant="ghost"
                icon="cloud-download-outline"
                loading={busy === "pull"}
                onPress={() =>
                  run("pull", cloud.pullLatest, "Could not refresh")
                }
              />
            </View>
          </View>
          <Pressable
            onPress={() => {
              setShowDevices((value) => !value);
              if (!showDevices) cloud.refreshDevices().catch(() => undefined);
            }}
            style={styles.disclosure}
          >
            <Ionicons name="phone-portrait-outline" size={17} color={accent} />
            <Text style={styles.disclosureText}>Signed-in devices</Text>
            <Ionicons
              name={showDevices ? "chevron-up" : "chevron-down"}
              size={16}
              color={colors.muted}
            />
          </Pressable>
          {showDevices ? (
            <View style={styles.deviceList}>
              {cloud.devices.length ? (
                cloud.devices.map((device) => (
                  <View key={device.deviceId} style={styles.device}>
                    <View style={styles.deviceIcon}>
                      <Ionicons
                        name={
                          device.platform === "web"
                            ? "globe-outline"
                            : device.platform === "android"
                              ? "logo-android"
                              : "phone-portrait-outline"
                        }
                        size={17}
                        color={accent}
                      />
                    </View>
                    <View style={styles.copy}>
                      <Text style={styles.deviceName}>
                        {device.label ||
                          `${device.platform[0]?.toUpperCase()}${device.platform.slice(1)} device`}
                        {device.isThisDevice ? " · This device" : ""}
                      </Text>
                      <Text style={styles.meta}>
                        Last seen {new Date(device.lastSeenAt).toLocaleString(locale)}
                      </Text>
                    </View>
                    {!device.isThisDevice ? (
                      <Pressable
                        accessibilityLabel="Forget device"
                        onPress={() =>
                          run(
                            null,
                            () => cloud.forgetDevice(device.deviceId),
                            "Could not forget device",
                          )
                        }
                      >
                        <Ionicons
                          name="close-circle-outline"
                          size={20}
                          color={colors.muted}
                        />
                      </Pressable>
                    ) : null}
                  </View>
                ))
              ) : (
                <Text style={styles.empty}>
                  This device will appear after its first successful sync.
                </Text>
              )}
            </View>
          ) : null}
          <Pressable
            onPress={() => run("signout", auth.signOut, "Could not sign out")}
            style={styles.signOut}
          >
            <Text style={styles.signOutText}>
              {busy === "signout" ? "Signing out…" : "Sign out"}
            </Text>
          </Pressable>
        </Card>
      ) : (
        <Card style={styles.heading}>
          <View style={styles.icon}>
            <Ionicons
              name={auth.configured ? "cloud-outline" : "code-slash-outline"}
              size={22}
              color={accent}
            />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.title, { color: colors.ink }]}>
              {auth.configured
                ? "Using device-only demo"
                : "Demo mode is ready"}
            </Text>
            <Text style={styles.meta}>
              {auth.configured
                ? "Sign in when you want automatic backup and multi-device sync."
                : "Add the two public Supabase values from .env.example to enable accounts."}
            </Text>
          </View>
          {auth.configured ? (
            <Button
              label="Sign in"
              variant="ghost"
              onPress={() =>
                auth
                  .useCloudAccount()
                  .then(() => router.replace("/sign-in" as never))
              }
            />
          ) : null}
        </Card>
      )}

      <TutorialTarget id="settings-health">
        <SectionHeader title="Connected health data" />
      </TutorialTarget>
      {isWebHealthBridge ? <GoogleHealthWebCard /> : <Card>
        <View style={styles.heading}>
          <View style={styles.icon}>
            <Ionicons
              name={
                Platform.OS === "android"
                  ? "fitness-outline"
                  : Platform.OS === "ios"
                    ? "heart-outline"
                    : "phone-portrait-outline"
              }
              size={23}
              color={health.status === "error" ? palette.red : accent}
            />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.title, { color: colors.ink }]}>
              {health.availability?.title ?? "Checking health service…"}
            </Text>
            <Text style={styles.meta}>
              {isWebHealthBridge
                ? hasSyncedPhoneHealth
                  ? "Synced health items"
                  : "Not connected"
                : state.settings.healthSync.enabled
                  ? "Connected"
                  : "Not connected"}{" "}
              {!isWebHealthBridge ? `· ${healthLastSync}` : null}
            </Text>
          </View>
          <Chip
            label={
              health.status === "syncing"
                ? "Syncing"
                : isWebHealthBridge
                  ? hasSyncedPhoneHealth
                    ? "Synced"
                    : "Off"
                  : state.settings.healthSync.enabled
                  ? "Connected"
                  : "Off"
            }
            selected={
              isWebHealthBridge
                ? hasSyncedPhoneHealth
                : state.settings.healthSync.enabled
            }
          />
        </View>
        <Text style={[styles.text, { color: colors.muted }]}>
          {health.availability?.detail ?? "Checking what this device supports."}
        </Text>
        {health.errorMessage ? (
          <View style={[styles.notice, styles.errorNotice]}>
            <Ionicons name="warning-outline" size={17} color={palette.red} />
            <Text style={styles.noticeText}>{health.errorMessage}</Text>
          </View>
        ) : null}
        {!isWebHealthBridge ? (
          <View style={styles.buttons}>
            <View style={styles.grow}>
              <Button
                label={
                  state.settings.healthSync.enabled
                    ? "Update access & sync"
                    : "Connect health data"
                }
                icon="heart-outline"
                loading={
                  busy === "health" ||
                  health.status === "requesting" ||
                  health.status === "syncing"
                }
                disabled={!health.availability?.available}
                onPress={() =>
                  run("health", health.connect, "Health connection failed")
                }
              />
            </View>
            {state.settings.healthSync.enabled ? (
              <View style={styles.grow}>
                <Button
                  label="Sync now"
                  variant="ghost"
                  icon="refresh-outline"
                  onPress={() =>
                    run(
                      "health",
                      () => health.syncNow("manual"),
                      "Health sync failed",
                    )
                  }
                />
              </View>
            ) : null}
          </View>
        ) : null}
        {!isWebHealthBridge && state.settings.healthSync.enabled ? (
          <>
            <View style={styles.healthLinks}>
              <Pressable
                onPress={() =>
                  health
                    .openSettings()
                    .catch((error) =>
                      Alert.alert(
                        "Could not open settings",
                        error instanceof Error ? error.message : "Try again.",
                      ),
                    )
                }
              >
                <Text style={[styles.healthLink, { color: accent }]}>
                  Open system health settings
                </Text>
              </Pressable>
              <Pressable onPress={() => health.disconnect()}>
                <Text style={[styles.healthLink, { color: palette.red }]}>
                  Disconnect
                </Text>
              </Pressable>
            </View>
            <Pressable
              disabled={busy === "history" || health.status === "syncing"}
              onPress={() =>
                Alert.alert(
                  "Repair health history?",
                  `This rechecks ${state.settings.healthHistoryDays ?? 90} days in small batches. Normal syncing only checks recent changes.`,
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Repair history",
                      onPress: () =>
                        run(
                          "history",
                          health.syncHistory,
                          "History repair failed",
                        ),
                    },
                  ],
                )
              }
              style={[
                styles.historyRepair,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.canvas,
                },
              ]}
            >
              <Ionicons name="time-outline" size={18} color={accent} />
              <View style={styles.copy}>
                <Text style={[styles.modeTitle, { color: colors.ink }]}>
                  {busy === "history"
                    ? "Repairing history…"
                    : "Repair health history"}
                </Text>
                <Text style={[styles.meta, { color: colors.muted }]}>
                  Re-import missing or edited history in 30-day batches.
                </Text>
              </View>
            </Pressable>
            <View style={styles.originChips}>
              {([30, 90, 365, 730] as const).map((days) => (
                <Chip
                  key={days}
                  label={
                    days === 30
                      ? "30 days"
                      : days === 90
                        ? "90 days"
                        : days === 365
                          ? "1 year"
                          : "2 years"
                  }
                  selected={(state.settings.healthHistoryDays ?? 90) === days}
                  onPress={() => updateSettings({ healthHistoryDays: days })}
                />
              ))}
            </View>
          </>
        ) : null}
        {!isWebHealthBridge && health.sourceOptions.length ? (
          <View style={styles.origins}>
            <Pressable
              onPress={() => setShowHealthSources((value) => !value)}
              style={styles.collapseRow}
            >
              <View style={styles.modeIcon}>
                <Ionicons name="apps-outline" size={19} color={accent} />
              </View>
              <View style={styles.copy}>
                <Text style={[styles.modeTitle, { color: colors.ink }]}>
                  Data sources
                </Text>
                <Text style={[styles.meta, { color: colors.muted }]}>
                  Choose which apps can contribute imported health data.
                </Text>
              </View>
              <Ionicons
                name={showHealthSources ? "chevron-up" : "chevron-down"}
                size={18}
                color={accent}
              />
            </Pressable>
            {showHealthSources ? (
              <>
                {health.sourceOptions.map((source, index) => (
                  <View
                    key={source.id}
                    style={[
                      styles.healthType,
                      index < health.sourceOptions.length - 1 && styles.border,
                    ]}
                  >
                    <View style={styles.modeIcon}>
                      <Ionicons name="phone-portrait-outline" size={19} color={accent} />
                    </View>
                    <View style={styles.copy}>
                      <Text style={[styles.modeTitle, { color: colors.ink }]}>
                        {friendlyHealthOrigin(source.origin)}
                      </Text>
                    </View>
                    <Switch
                      disabled={sourceBusy === source.id || health.status === "syncing"}
                      value={source.enabled}
                      onValueChange={(enabled) => {
                        setSourceBusy(source.id);
                        void health
                          .setSourceEnabled(source.id, enabled)
                          .catch((error) =>
                            Alert.alert(
                              "Could not update data source",
                              error instanceof Error
                                ? error.message
                                : "Please try again.",
                            ),
                          )
                          .finally(() => setSourceBusy(null));
                      }}
                      trackColor={{ false: palette.border, true: `${accent}88` }}
                      thumbColor={source.enabled ? accent : "#F4F5F4"}
                    />
                  </View>
                ))}
                <Text style={[styles.meta, styles.sourceNote, { color: colors.muted }]}>
                  New sources stay enabled until you turn them off. Re-enabling a source restores the selected history in the background.
                </Text>
              </>
            ) : null}
          </View>
        ) : null}
        {!isWebHealthBridge ? (
          <>
            <View style={styles.localDivider} />
            <Pressable
          onPress={() => setShowHealthTypes((value) => !value)}
          style={styles.collapseRow}
        >
          <Text style={[styles.modeTitle, { color: colors.ink }]}>
            Synced health items
          </Text>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {
              supportedHealthDataTypes.filter(
                (item) => state.settings.healthSync.dataTypes[item.id],
              ).length
            }{" "}
            enabled
          </Text>
          <Ionicons
            name={showHealthTypes ? "chevron-up" : "chevron-down"}
            size={18}
            color={accent}
          />
            </Pressable>
            {showHealthTypes
              ? supportedHealthDataTypes.map((item, index) => (
              <View
                key={item.id}
                style={[
                  styles.healthType,
                  index < supportedHealthDataTypes.length - 1 && styles.border,
                ]}
              >
                <View style={styles.modeIcon}>
                  <Ionicons name={item.icon} size={19} color={accent} />
                </View>
                <View style={styles.copy}>
                  <Text style={[styles.modeTitle, { color: colors.ink }]}>
                    {item.title}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {item.subtitle}
                  </Text>
                </View>
                <Switch
                  value={state.settings.healthSync.dataTypes[item.id]}
                  onValueChange={(value) =>
                    updateSettings({
                      healthSync: {
                        ...state.settings.healthSync,
                        dataTypes: {
                          ...state.settings.healthSync.dataTypes,
                          [item.id]: value,
                        },
                      },
                    })
                  }
                  trackColor={{ false: palette.border, true: `${accent}88` }}
                  thumbColor={
                    state.settings.healthSync.dataTypes[item.id]
                      ? accent
                      : "#F4F5F4"
                  }
                />
              </View>
                ))
              : null}
          </>
        ) : null}
      </Card>}
      <Text style={styles.disclaimer}>
        {isWebHealthBridge
          ? "Google Health imports follow each tracker's current configured visibility. Group, status, or leaderboard sharing follows that setting. You can change it in the tracker's settings."
          : "Imported values are group-visible by default, retain their source app, and can still be made private. MyFitnessPal, Samsung Health, and Google Fit data arrive through Apple Health or Health Connect when those apps share it."}
      </Text>

      {!isWebHealthBridge ? (
        <>
          <SectionHeader
        title="Health sync schedule"
        action={
          <Pressable onPress={() => setShowSchedule((value) => !value)}>
            <Text style={[styles.healthLink, { color: accent }]}>
              {showSchedule
                ? "Hide"
                : (syncModes.find((mode) => mode.id === selectedSyncMode)
                    ?.title ?? "Show")}
            </Text>
          </Pressable>
        }
          />
          {showSchedule ? (
            <Card style={styles.list}>
          {syncModes.map((mode, index) => (
            <React.Fragment key={mode.id}>
              {index === 0 || syncModes[index - 1]?.kind !== mode.kind ? (
                <View style={styles.scheduleGroup}>
                  <Text style={[styles.originLabel, { color: colors.faint }]}>
                    {mode.kind === "foreground"
                      ? "FOREGROUND ONLY"
                      : "BACKGROUND + APP OPEN"}
                  </Text>
                </View>
              ) : null}
              <Pressable
                onPress={() =>
                  void run(
                    "health",
                    () => health.setSyncMode(mode.id),
                    "Health schedule not changed",
                  )
                }
                style={[
                  styles.mode,
                  index < syncModes.length - 1 && styles.border,
                ]}
              >
                <View
                  style={[
                    styles.modeIcon,
                    selectedSyncMode === mode.id && styles.modeActive,
                  ]}
                >
                  <Ionicons
                    name={mode.icon}
                    size={20}
                    color={
                      selectedSyncMode === mode.id ? accent : palette.muted
                    }
                  />
                </View>
                <View style={styles.copy}>
                  <Text style={[styles.modeTitle, { color: colors.ink }]}>
                    {mode.title}
                  </Text>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {mode.subtitle}
                  </Text>
                </View>
                <Ionicons
                  name={
                    selectedSyncMode === mode.id
                      ? "radio-button-on"
                      : "radio-button-off"
                  }
                  size={20}
                  color={
                    selectedSyncMode === mode.id ? accent : palette.faint
                  }
                />
              </Pressable>
            </React.Fragment>
          ))}
            </Card>
          ) : null}
          <View
        style={[
          styles.notice,
          styles.scheduleNotice,
          { backgroundColor: colors.canvas },
        ]}
          >
        <Ionicons
          name={
            !selectedHealthSchedule.requestsBackground
              ? "phone-portrait-outline"
              : health.backgroundRegistration === "registered"
                ? "checkmark-circle-outline"
                : "information-circle-outline"
          }
          size={17}
          color={accent}
        />
        <Text style={[styles.noticeText, { color: colors.muted }]}>
          {healthScheduleStatus}
        </Text>
          </View>
          <Text style={styles.disclaimer}>
            Background intervals are minimum requests, not exact timers. iOS or
            Android may run them later or skip a run based on system conditions.
            Sync now is immediate; automatic app-open checks run only when the
            selected interval is due. On Android, Force stop pauses background
            work until HabHub is opened again. Account cloud sync remains
            separate.
          </Text>
        </>
      ) : null}

      <ScreenTimeAccessCard />

      <SectionHeader title="Data controls" />
      <Card>
        <Text style={[styles.title, { color: colors.ink }]}>
          Your portable data
        </Text>
        <Text style={[styles.text, { color: colors.muted }]}>
          Export logs and configuration as JSON. Private-bucket paths are
          included; temporary access links are not.
        </Text>
        <Button
          label="Export my data"
          variant="ghost"
          icon="download-outline"
          onPress={() =>
            exportData().catch((error) =>
              Alert.alert(
                "Export failed",
                error instanceof Error ? error.message : "Try again.",
              ),
            )
          }
        />
        <View style={styles.localDivider} />
        <Text style={[styles.title, { color: colors.ink }]}>
          Local demo data
        </Text>
        <Text style={[styles.text, { color: colors.muted }]}>
          Restore the built-in group, metrics, history, scoring, and chat on
          this device.
        </Text>
        <Button
          label="Reset local demo"
          variant="danger"
          icon="refresh-outline"
          onPress={() =>
            Alert.alert(
              "Reset the demo?",
              "This clears local edits. If signed in, the reset will also become your next cloud version.",
              [
                { text: "Cancel", style: "cancel" },
                { text: "Reset", style: "destructive", onPress: resetDemo },
              ],
            )
          }
        />
        {auth.status === "signedIn" ? (
          <Pressable
            onPress={() =>
              Alert.alert(
                "Permanently delete account?",
                "This removes the account, cloud snapshot, and uploaded media. This cannot be undone.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete account",
                    style: "destructive",
                    onPress: () =>
                      run(
                        "delete",
                        cloud.deleteAccount,
                        "Account deletion failed",
                      ),
                  },
                ],
              )
            }
            style={styles.deleteAccount}
          >
            <Ionicons name="trash-outline" size={17} color={palette.red} />
            <Text style={styles.deleteText}>
              {busy === "delete"
                ? "Deleting…"
                : "Delete cloud account and data"}
            </Text>
          </Pressable>
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { flexDirection: "row", alignItems: "center", gap: 11 },
  copy: { flex: 1 },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: palette.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: palette.ink, fontSize: 14, fontWeight: "900" },
  meta: { color: palette.muted, fontSize: 10, lineHeight: 15, marginTop: 2 },
  text: {
    color: palette.muted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 12,
    marginBottom: 13,
  },
  buttons: { flexDirection: "row", gap: 8, marginTop: 13 },
  grow: { flex: 1 },
  notice: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    backgroundColor: palette.canvas,
    borderRadius: 12,
    padding: 10,
  },
  errorNotice: { backgroundColor: "#FCECEB" },
  noticeText: { flex: 1, color: palette.muted, fontSize: 9, lineHeight: 14 },
  disclosure: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    marginTop: 15,
    paddingTop: 13,
  },
  disclosureText: {
    flex: 1,
    color: palette.ink,
    fontSize: 11,
    fontWeight: "900",
  },
  deviceList: { marginTop: 9, gap: 7 },
  device: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: palette.canvas,
    borderRadius: 12,
    padding: 9,
  },
  deviceIcon: {
    width: 31,
    height: 31,
    borderRadius: 10,
    backgroundColor: palette.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  deviceName: { color: palette.ink, fontSize: 10, fontWeight: "900" },
  empty: { color: palette.muted, fontSize: 9, padding: 8 },
  signOut: { alignSelf: "center", padding: 11, marginTop: 3 },
  signOutText: { color: palette.muted, fontSize: 11, fontWeight: "900" },
  list: { paddingHorizontal: 13, paddingVertical: 2 },
  scheduleGroup: { paddingTop: 11, paddingBottom: 2 },
  scheduleNotice: { marginTop: 8 },
  mode: { minHeight: 65, flexDirection: "row", alignItems: "center", gap: 10 },
  border: { borderBottomWidth: 1, borderBottomColor: palette.border },
  modeIcon: {
    width: 39,
    height: 39,
    borderRadius: 13,
    backgroundColor: palette.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  modeActive: { backgroundColor: palette.canvas },
  modeTitle: { color: palette.ink, fontSize: 12, fontWeight: "900" },
  disclaimer: {
    color: palette.muted,
    fontSize: 9,
    lineHeight: 14,
    paddingHorizontal: 7,
    marginTop: 7,
  },
  localDivider: {
    height: 1,
    backgroundColor: palette.border,
    marginVertical: 15,
  },
  collapseRow: {
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  deleteAccount: {
    marginTop: 12,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  deleteText: { fontSize: 10, fontWeight: "900", color: palette.red },
  healthLinks: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 13,
  },
  historyRepair: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    marginTop: 10,
  },
  healthLink: { color: palette.primary, fontSize: 10, fontWeight: "900" },
  healthType: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  origins: { marginTop: 16 },
  originLabel: {
    color: palette.faint,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
  },
  originChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  sourceNote: { marginTop: 8, lineHeight: 16 },
});
