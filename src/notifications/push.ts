import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/src/lib/supabase';
import { localeForLanguage, translateUiText } from '@/src/i18n';
import { AppLanguage, AppState, NotificationSettings } from '@/src/types';
import {
  localizeExerciseName,
  localizeMetricName,
  localizeMetricUnit,
} from '@/src/i18n/domain';
import { cycleForecast } from '@/src/domain/cycle';
import { dateKey, dateWithOffsetFrom } from '@/src/domain/date';
import {
  effectiveGoalTarget,
  isMetricTrackedOnDate,
  metricApplicableOnDate,
  metricVisualProgress,
  safeMetricValue,
  scheduledGoalReached,
} from '@/src/domain/metrics';
import { defaultProgressReminderPercentages } from '@/src/domain/reminders';
import {
  averageGymRestSeconds,
  completedGymSets,
  estimatedOneRepMax,
  exerciseHistory,
  exerciseIdentity,
  trainingVolumeKg,
} from '@/src/domain/gym';
import {
  scheduleAppliesOnDate,
  todoAppearsOnDate,
} from '@/src/domain/schedule';
import type { ScreenTimeReport } from '@/src/screenTime';
import { readScreenTimeAppLimits } from '@/src/screenTime/appLimits';

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const isChat = notification.request.content.data?.route === '/chat';
    // Foreground chat uses the themed in-app banner, while the OS notification
    // remains in Notification Center. Background/closed delivery is unaffected.
    return { shouldShowBanner: !isChat, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
  },
});

async function ensureNotificationChannel(language: AppLanguage = "en") {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('paceboard', {
    name: translateUiText(language, 'HabHub messages and updates'),
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 200, 120, 200],
    sound: 'default',
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

function storedPreferences(preferences: NotificationSettings, language: AppLanguage) {
  return {
    ...preferences,
    language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  };
}

let pushRegistrationQueue: Promise<void> = Promise.resolve();
const EXPO_TOKEN_CACHE_PREFIX = 'habhub-expo-push-token-v1:';

function tokenCacheKey(projectId: string) {
  return `${EXPO_TOKEN_CACHE_PREFIX}${projectId}`;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function fetchExpoPushToken(projectId: string) {
  let lastError: unknown;
  for (const delay of [0, 700, 1800]) {
    if (delay) await wait(delay);
    try {
      const token = (
        await Notifications.getExpoPushTokenAsync({ projectId })
      ).data;
      await AsyncStorage.setItem(tokenCacheKey(projectId), token);
      return token;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function cachedOrFreshExpoPushToken(projectId: string) {
  const cached = await AsyncStorage.getItem(tokenCacheKey(projectId));
  if (cached) return { token: cached, cached: true };
  return {
    token: await fetchExpoPushToken(projectId),
    cached: false,
  };
}

async function registerPushToken(
  token: string,
  preferences: NotificationSettings,
  language: AppLanguage,
) {
  const client = supabase;
  if (!client) return;
  const operation = pushRegistrationQueue.catch(() => undefined).then(async () => {
    const { error } = await client.rpc('register_device_push_token', {
      p_token: token,
      p_platform: Platform.OS,
      p_preferences: storedPreferences(preferences, language),
    });
    if (error) throw error;
  });
  pushRegistrationQueue = operation;
  return operation;
}

function notificationErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    const parts = [value.message, value.details, value.hint, value.code]
      .filter((part): part is string => typeof part === 'string' && part.length > 0);
    if (parts.length) return [...new Set(parts)].join(' · ');
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown cloud registration error.';
    }
  }
  return 'Unknown cloud registration error.';
}

export async function enablePushNotifications(
  userId: string,
  preferences: NotificationSettings,
  language: AppLanguage = 'en',
) {
  if (Platform.OS === 'web') throw new Error('Push notifications are available in the installed iOS and Android app.');
  if (!Device.isDevice) throw new Error('Use a physical device to enable push notifications.');
  await ensureNotificationChannel(language);
  let permission = await Notifications.getPermissionsAsync();
  const granted = () => permission.granted || permission.status === Notifications.PermissionStatus.GRANTED;
  if (!granted()) permission = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
  if (!granted()) throw new Error('Android/iOS has not granted notification permission. Enable it in system settings and retry.');
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('This build is missing its EAS project ID.');
  let tokenResult: { token: string; cached: boolean };
  try {
    tokenResult = await cachedOrFreshExpoPushToken(projectId);
  } catch {
    throw new Error(
      'Notification permission is enabled, but Expo could not be reached. Check your connection and retry; you do not need to change phone permissions.',
    );
  }
  const token = tokenResult.token;
  if (supabase) {
    try {
      await registerPushToken(token, preferences, language);
    } catch (error) {
      throw new Error(
        `Permission is enabled, but cloud registration failed: ${notificationErrorMessage(error)}`,
      );
    }
  }
  if (tokenResult.cached) {
    // A cached project-scoped token lets account recreation recover even when
    // Expo's token endpoint is temporarily unavailable. Refresh it quietly so
    // a rotated token is registered without interrupting the user.
    void fetchExpoPushToken(projectId)
      .then((fresh) =>
        fresh === token || !supabase
          ? undefined
          : registerPushToken(fresh, preferences, language),
      )
      .catch(() => undefined);
  }
  return token;
}

export async function notificationPermissionGranted() {
  if (Platform.OS === 'web' || !Device.isDevice) return false;
  const permission = await Notifications.getPermissionsAsync();
  return (
    permission.granted ||
    permission.status === Notifications.PermissionStatus.GRANTED
  );
}

export async function updatePushPreferences(
  userId: string,
  preferences: NotificationSettings,
  language: AppLanguage = 'en',
) {
  if (!supabase || Platform.OS === 'web') return;
  await ensureNotificationChannel(language);
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return;
  try {
    const { token, cached } = await cachedOrFreshExpoPushToken(projectId);
    await registerPushToken(token, preferences, language);
    if (cached)
      void fetchExpoPushToken(projectId)
        .then((fresh) =>
          fresh === token
            ? undefined
            : registerPushToken(fresh, preferences, language),
        )
        .catch(() => undefined);
  } catch { /* The next foreground/settings visit retries registration. */ }
}

export async function disablePushNotifications(userId: string) {
  if (!supabase || Platform.OS === 'web') return;
  await supabase.from('device_push_tokens').delete().eq('user_id', userId);
}

const CYCLE_IDS = 'north-cycle-notification-ids-v1';
const GOAL_IDS = 'metric-rally-goal-reminder-ids-v1';
const GYM_IDS = 'metric-rally-gym-notification-ids-v1';
const GYM_ACHIEVEMENT = 'metric-rally-gym-achievement-v1';
const PRODUCTIVITY_IDS = 'metric-rally-productivity-notification-ids-v1';
const PROGRESS_MILESTONES = 'habhub-progress-milestones-v1';
const SCREEN_TIME_APP_MILESTONES = 'habhub-screen-time-app-milestones-v1';

function reminderTime(state: AppState, configured: string) {
  if (!state.settings.notifications.quietHoursEnabled) return configured;
  const start = state.settings.notifications.quietHoursStart;
  const end = state.settings.notifications.quietHoursEnd;
  const quiet = start <= end
    ? configured >= start && configured < end
    : configured >= start || configured < end;
  return quiet ? end : configured;
}

function localizedContent(state: AppState, title: string, body: string) {
  const language = state.settings.language ?? 'en';
  return {
    title: translateUiText(language, title),
    body: translateUiText(language, body),
  };
}

function goalReminderBody(state: AppState, metric: AppState['metrics'][number], localDate: string) {
  const locale = localeForLanguage(state.settings.language);
  const value = safeMetricValue(state, metric, state.currentUserId, localDate);
  const target = effectiveGoalTarget(state, metric, state.currentUserId, localDate);
  const remaining = Math.max(0, target - value);
  const metricName = localizeMetricName(state.settings.language, metric);
  const metricUnit = localizeMetricUnit(state.settings.language, metric);
  if (metric.id === 'sleep') {
    if (value <= 0) return 'Your wind-down reminder: an earlier bedtime makes the 7–9 hour sleep range easier to reach.';
    if (metric.goalRange && value < metric.goalRange.min) return `${(metric.goalRange.min - value).toFixed(1)} more hours would reach your sleep range.`;
    if (metric.goalRange && value > metric.goalRange.max) return `Sleep is ${(value - metric.goalRange.max).toFixed(1)} hours above your selected range.`;
    return 'Your sleep duration is inside your selected range.';
  }
  if (metric.goalRange) {
    if (value < metric.goalRange.min) return `${metricName} is ${Math.round(metric.goalRange.min - value)} ${metricUnit} below your range.`;
    if (value > metric.goalRange.max) return `${metricName} is ${Math.round(value - metric.goalRange.max)} ${metricUnit} above your range.`;
    return `${metricName} is inside your selected range.`;
  }
  if (metric.id === 'steps')
    return remaining > 0
      ? `${Math.round(remaining).toLocaleString(locale)} steps remain. A short walk can move today forward.`
      : 'Your step goal is complete.';
  if (metric.id === 'food') {
    if (value <= 0) return 'Log your meal when you are ready so today’s energy plan stays accurate.';
    const lastMeal = state.entries
      .filter((entry) => entry.userId === state.currentUserId && entry.metricId === 'food' && entry.localDate === localDate)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0]?.nutrition?.mealType;
    return value > target
      ? `You are ${Math.round(value - target)} kcal over today’s current food allowance. Activity can still improve the daily balance.`
      : `${lastMeal ? `${lastMeal[0].toUpperCase()}${lastMeal.slice(1)} logged. ` : ''}${Math.round(remaining)} kcal remain for today.`;
  }
  if (['exercise', 'workout_duration'].includes(metric.id)) {
    const deficit = state.metrics.find((item) => item.id === 'deficit');
    const needed = deficit
      ? Math.max(0, effectiveGoalTarget(state, deficit, state.currentUserId, localDate) - safeMetricValue(state, deficit, state.currentUserId, localDate))
      : remaining;
    const walkingKcalPerMinute = Math.max(3, state.settings.energyProfile.weightKg * 0.055);
    return needed > 0
      ? `About ${Math.round(needed)} active kcal—or roughly ${Math.ceil(needed / walkingKcalPerMinute)} minutes of walking—would close today’s energy gap.`
      : `You have ${Math.round(remaining)} ${metricUnit} left for this goal.`;
  }
  if (metric.goal.kind === 'at_most')
    return value > target
      ? `${metricName} is ${Math.round(value - target)} ${metricUnit} over its target.`
      : `${Math.round(target - value)} ${metricUnit} remain within today’s target.`;
  return `${Math.round(remaining)} ${metricUnit} remain to reach today’s ${metricName.toLowerCase()} goal.`;
}

function progressReminderPercent(
  state: AppState,
  metric: AppState['metrics'][number],
  localDate: string,
) {
  if (
    metric.goalEnabled === false ||
    !metricApplicableOnDate(state, metric, state.currentUserId, localDate)
  )
    return 0;
  // Journey milestones represent movement from the first reading to the
  // long-term target. Treating weight as a regular at-most value would make a
  // first reading above the target appear more than 100% complete.
  if (metric.id === 'weight' || metric.goalProgressMode === 'journey')
    return Math.max(
      0,
      metricVisualProgress(
        state,
        metric,
        state.currentUserId,
        localDate,
      ) * 100,
    );
  if (
    metric.goalRange ||
    metric.goal.kind === 'exact' ||
    metric.goal.kind === 'complete'
  )
    return scheduledGoalReached(
      state,
      metric,
      state.currentUserId,
      localDate,
    )
      ? 100
      : 0;
  if (metric.goal.kind === 'at_most') {
    const target = effectiveGoalTarget(
      state,
      metric,
      state.currentUserId,
      localDate,
    );
    const value = safeMetricValue(state, metric, state.currentUserId, localDate);
    return target > 0 ? Math.max(0, (value / target) * 100) : 0;
  }
  return Math.max(
    0,
    metricVisualProgress(
      state,
      metric,
      state.currentUserId,
      localDate,
    ) * 100,
  );
}

function isQuietNow(settings: NotificationSettings) {
  if (!settings.quietHoursEnabled) return false;
  const configured = new Date().toTimeString().slice(0, 5);
  const start = settings.quietHoursStart;
  const end = settings.quietHoursEnd;
  return start <= end
    ? configured >= start && configured < end
    : configured >= start || configured < end;
}

function translatedTemplate(
  language: AppLanguage,
  source: string,
  values: Record<string, string | number>,
) {
  let translated = translateUiText(language, source);
  Object.entries(values).forEach(([key, value]) => {
    translated = translated.replaceAll(`{${key}}`, String(value));
  });
  return translated;
}

/**
 * Notify for device-only per-app screen-time limits. Package identifiers never
 * enter AppState, notification payloads, or cloud storage.
 */
export async function notifyScreenTimeAppLimits(
  state: AppState,
  report: ScreenTimeReport,
  localDate = dateKey(),
) {
  if (Platform.OS !== 'android' || localDate !== dateKey()) return;
  const settings = state.settings.notifications;
  if (!settings.pushEnabled || !settings.reminders || isQuietNow(settings)) return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  const limits = await readScreenTimeAppLimits(state.currentUserId);
  if (!limits.length) return;
  await ensureNotificationChannel(state.settings.language);

  let stored: { date?: string; userId?: string; fired?: string[] } = {};
  try {
    stored = JSON.parse(
      (await AsyncStorage.getItem(SCREEN_TIME_APP_MILESTONES)) ?? '{}',
    ) as typeof stored;
  } catch {
    stored = {};
  }
  const fired = new Set(
    stored.date === localDate && stored.userId === state.currentUserId
      ? stored.fired ?? []
      : [],
  );
  const appsByPackage = new Map(
    report.apps.map((app) => [app.packageName, app] as const),
  );
  const thresholds = [75, 90, 100];
  for (const limit of limits) {
    const app = appsByPackage.get(limit.packageName);
    if (!app) continue;
    const minutes = app.foregroundMs / 60_000;
    const percent = Math.floor((minutes / limit.targetMinutes) * 100);
    const reached = thresholds.filter((threshold) => percent >= threshold);
    const newest = [...reached]
      .reverse()
      .find(
        (threshold) =>
          !fired.has(`${limit.packageName}:${limit.targetMinutes}:${threshold}`),
      );
    if (newest === undefined) continue;
    // A late first refresh emits one useful message rather than three.
    reached.forEach((threshold) =>
      fired.add(`${limit.packageName}:${limit.targetMinutes}:${threshold}`),
    );
    const body =
      newest >= 100
        ? translatedTemplate(
            state.settings.language,
            '{app} reached its daily screen-time limit of {minutes} min.',
            { app: limit.appName, minutes: limit.targetMinutes },
          )
        : translatedTemplate(
            state.settings.language,
            '{app} used {percent}% of its daily screen-time limit.',
            { app: limit.appName, percent: newest },
          );
    await Notifications.scheduleNotificationAsync({
      content: {
        title: translateUiText(state.settings.language, 'Screen time'),
        body,
        data: { route: '/metric-detail', metric: 'screen_time', date: localDate },
      },
      trigger: null,
    });
  }
  await AsyncStorage.setItem(
    SCREEN_TIME_APP_MILESTONES,
    JSON.stringify({
      date: localDate,
      userId: state.currentUserId,
      fired: [...fired],
    }),
  );
}

/**
 * Emit deduplicated, immediate progress milestones after a local log. This is
 * separate from clock-time reminders so custom schedules are never replaced.
 */
export async function notifyProgressMilestones(
  previousState: AppState,
  nextState: AppState,
  localDate = dateKey(),
) {
  if (Platform.OS === 'web' || localDate !== dateKey()) return;
  const settings = nextState.settings.notifications;
  if (!settings.pushEnabled || !settings.reminders || isQuietNow(settings)) return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  await ensureNotificationChannel(nextState.settings.language);
  let fired: string[] = [];
  try {
    fired = JSON.parse(
      (await AsyncStorage.getItem(PROGRESS_MILESTONES)) ?? '[]',
    ) as string[];
  } catch {
    fired = [];
  }
  const todayPrefix = `${nextState.currentUserId}:${localDate}:`;
  const retained = fired.filter((key) => key.startsWith(todayPrefix));
  const firedSet = new Set(retained);
  for (const metric of nextState.metrics) {
    if (!metric.progressRemindersEnabled || metric.goalEnabled === false) continue;
    const previousMetric =
      previousState.metrics.find((candidate) => candidate.id === metric.id) ?? metric;
    const before = progressReminderPercent(previousState, previousMetric, localDate);
    const after = progressReminderPercent(nextState, metric, localDate);
    const thresholds = [
      ...new Set(
        metric.progressReminderPercentages?.length
          ? metric.progressReminderPercentages
          : defaultProgressReminderPercentages(metric),
      ),
    ]
      .filter((value) => Number.isFinite(value) && value > 0 && value <= 300)
      .sort((left, right) => left - right);
    for (const threshold of thresholds) {
      const key = `${todayPrefix}${metric.id}:${threshold}`;
      if (before >= threshold || after < threshold || firedSet.has(key)) continue;
      const metricName = localizeMetricName(nextState.settings.language, metric);
      const isJourney =
        metric.id === 'weight' || metric.goalProgressMode === 'journey';
      const milestoneBody =
        isJourney
          ? threshold === 100
            ? `${metricName} reached its long-term target.`
            : `${metricName} reached ${threshold}% of its long-term target.`
          : metric.goal.kind === 'at_most'
          ? threshold === 100
            ? `${metricName} reached today's limit.`
            : threshold < 100
              ? `${metricName} used ${threshold}% of today's limit.`
              : `${metricName} reached ${threshold}% of today's limit.`
          : threshold === 100
            ? `${metricName} reached today's target.`
            : `${metricName} reached ${threshold}% of today's target.`;
      const content = localizedContent(
        nextState,
        `${metricName} progress`,
        milestoneBody,
      );
      await Notifications.scheduleNotificationAsync({
        content: {
          ...content,
          data: { route: '/metric-detail', metric: metric.id, date: localDate },
        },
        trigger: null,
      });
      firedSet.add(key);
    }
  }
  await AsyncStorage.setItem(PROGRESS_MILESTONES, JSON.stringify([...firedSet]));
}

export async function syncGoalNotifications(state: AppState) {
  if (Platform.OS === 'web') return;
  const previous = JSON.parse((await AsyncStorage.getItem(GOAL_IDS)) ?? '[]') as string[];
  await Promise.all(previous.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  const settings = state.settings.notifications;
  if (!settings.pushEnabled || !settings.reminders) {
    await AsyncStorage.setItem(GOAL_IDS, '[]');
    return;
  }
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  const now = new Date();
  const today = dateKey(now);
  const ids: string[] = [];
  for (let offset = 0; offset < 8 && ids.length < 64; offset += 1) {
    const localDate = dateWithOffsetFrom(today, offset);
    for (const metric of state.metrics) {
      if (
        !(metric.reminders?.some((item) => item.enabled) || metric.reminder?.enabled) ||
        metric.goalEnabled === false ||
        (!isMetricTrackedOnDate(state, metric, localDate) &&
          metric.id !== "intermittent_fasting") ||
        (offset === 0 && scheduledGoalReached(state, metric, state.currentUserId, localDate))
      ) continue;
      const configured = metric.reminders?.length ? metric.reminders : metric.reminder ? [metric.reminder] : [];
      for (const reminder of configured.filter((item) => item.enabled)) {
        if (
          reminder.schedule &&
          !scheduleAppliesOnDate(
            reminder.schedule,
            reminder.schedule.anchorDate ?? metric.activeFrom,
            localDate,
          )
        )
          continue;
        if (!/^\d{2}:\d{2}$/.test(reminder.time)) continue;
        const time = reminderTime(state, reminder.time);
        const trigger = new Date(`${localDate}T${time}:00`);
        if (trigger <= now) continue;
        const content = localizedContent(
          state,
          reminder.label ?? `${localizeMetricName(state.settings.language, metric)} reminder`,
          metric.id === "intermittent_fasting" && reminder.label
            ? reminder.label
            : goalReminderBody(state, metric, localDate),
        );
        ids.push(await Notifications.scheduleNotificationAsync({
          content: {
            ...content,
            data: reminder.durationMinutes && metric.timerEnabled
              ? {
                  route: `/timer?metric=${encodeURIComponent(metric.id)}&date=${localDate}&duration=${Math.round(reminder.durationMinutes)}`,
                }
              : { route: '/metric-detail', metric: metric.id },
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger },
        }));
        if (ids.length >= 64) break;
      }
      if (ids.length >= 64) break;
    }
  }
  await AsyncStorage.setItem(GOAL_IDS, JSON.stringify(ids));
}

export async function syncCycleNotifications(state: AppState) {
  if (Platform.OS === 'web') return;
  const previous = JSON.parse((await AsyncStorage.getItem(CYCLE_IDS)) ?? '[]') as string[];
  await Promise.all(previous.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  const settings = state.settings.notifications;
  if (!settings.pushEnabled || (settings.cyclePredictions === false && settings.cyclePhaseUpdates !== true)) {
    await AsyncStorage.setItem(CYCLE_IDS, '[]');
    return;
  }
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  const today = dateKey();
  const forecast = cycleForecast(state, state.currentUserId, today);
  if (!forecast.nextPeriodStart) return;
  const schedule: { date: string; title: string; body: string }[] = [];
  if (settings.cyclePredictions !== false) {
    schedule.push({ date: dateWithOffsetFrom(forecast.nextPeriodStart, -(settings.cycleReminderDays ?? 2)), title: 'Period estimate', body: `Your next period is estimated in ${settings.cycleReminderDays ?? 2} days. This may change as HabHub learns your cycle.` });
  }
  if (settings.cyclePhaseUpdates === true) {
    const currentStart = dateWithOffsetFrom(forecast.nextPeriodStart, -forecast.averageCycleDays);
    const future = (candidate: string) => {
      let next = candidate;
      while (next <= today) next = dateWithOffsetFrom(next, forecast.averageCycleDays);
      return next;
    };
    schedule.push(
      { date: future(currentStart), title: 'Menstrual phase estimate', body: 'Your next cycle is estimated to begin around today.' },
      { date: future(dateWithOffsetFrom(currentStart, forecast.averagePeriodDays)), title: 'Follicular phase estimate', body: 'Your follicular phase is estimated to begin around today.' },
      { date: future(dateWithOffsetFrom(currentStart, forecast.averageCycleDays - 15)), title: 'Ovulation phase estimate', body: 'Estimated ovulation phase begins around today. This is not a contraceptive prediction.' },
      { date: future(dateWithOffsetFrom(currentStart, forecast.averageCycleDays - 12)), title: 'Luteal phase estimate', body: 'Your luteal phase is estimated to begin around today.' },
    );
  }
  const ids: string[] = [];
  for (const item of schedule.filter((item) => item.date > today)) {
    const trigger = new Date(`${item.date}T09:00:00`);
    ids.push(await Notifications.scheduleNotificationAsync({
      content: {
        ...localizedContent(state, item.title, item.body),
        data: { route: '/metric-detail', metric: 'menstrual_cycle' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger },
    }));
  }
  await AsyncStorage.setItem(CYCLE_IDS, JSON.stringify(ids));
}

export async function syncProductivityNotifications(state: AppState) {
  if (Platform.OS === 'web') return;
  const previous = JSON.parse(
    (await AsyncStorage.getItem(PRODUCTIVITY_IDS)) ?? '[]',
  ) as string[];
  await Promise.all(
    previous.map((id) =>
      Notifications.cancelScheduledNotificationAsync(id).catch(
        () => undefined,
      ),
    ),
  );
  if (!state.settings.notifications.pushEnabled) {
    await AsyncStorage.setItem(PRODUCTIVITY_IDS, '[]');
    return;
  }
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  const now = new Date();
  const today = dateKey(now);
  const ids: string[] = [];
  const schedule = async (
    localDate: string,
    time: string,
    title: string,
    body: string,
    route: string,
  ) => {
    if (ids.length >= 64 || !/^\d{2}:\d{2}$/.test(time)) return;
    const trigger = new Date(
      `${localDate}T${reminderTime(state, time)}:00`,
    );
    if (trigger <= now) return;
    ids.push(
      await Notifications.scheduleNotificationAsync({
        content: { ...localizedContent(state, title, body), data: { route } },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: trigger,
        },
      }),
    );
  };
  for (let offset = 0; offset < 31 && ids.length < 64; offset += 1) {
    const localDate = dateWithOffsetFrom(today, offset);
    for (const todo of
      state.settings.notifications.todoReminders === false
        ? []
        : state.todos ?? []) {
      if (
        !todoAppearsOnDate(todo, localDate) ||
        todo.completedDates.includes(localDate) ||
        (!todo.recurrence && Boolean(todo.completedAt))
      )
        continue;
      for (const reminder of todo.reminders) {
        const dailyUntilDue =
          reminder.repeatDailyUntilDue &&
          localDate >= todo.createdAt.slice(0, 10) &&
          (!todo.dueAt || localDate <= todo.dueAt.slice(0, 10));
        if (
          !dailyUntilDue &&
          reminder.at &&
          reminder.at.slice(0, 10) !== localDate
        )
          continue;
        await schedule(
          dailyUntilDue
            ? localDate
            : (reminder.at?.slice(0, 10) ?? localDate),
          reminder.time ?? todo.dueAt?.slice(11, 16) ?? '09:00',
          todo.dueAt?.slice(0, 10) === localDate
            ? 'To-do deadline'
            : 'To-do reminder',
          todo.title,
          `/todo-editor?id=${todo.id}`,
        );
      }
    }
    for (const reminder of state.calendarReminders ?? []) {
      if (
        !reminder.enabled ||
        !scheduleAppliesOnDate(reminder.schedule, today, localDate)
      )
        continue;
      await schedule(
        localDate,
        reminder.time,
        reminder.title,
        reminder.kind === 'tracker'
          ? 'A scheduled tracker reminder is ready.'
          : reminder.kind === 'todo'
            ? 'A scheduled to-do reminder is ready.'
            : 'Scheduled reminder',
        reminder.kind === 'tracker' && reminder.metricId && reminder.durationMinutes
          ? `/timer?metric=${encodeURIComponent(reminder.metricId)}&date=${localDate}&duration=${Math.round(reminder.durationMinutes)}`
          : '/calendar',
      );
    }
  }
  await AsyncStorage.setItem(PRODUCTIVITY_IDS, JSON.stringify(ids));
}

/**
 * Keeps gym prompts private and on-device. Group activity still uses the
 * regular shared tracker entries created from a completed session.
 */
export async function syncGymNotifications(state: AppState) {
  if (Platform.OS === 'web') return;
  const settings = state.settings.notifications;
  const idsKey = `${GYM_IDS}:${state.currentUserId}`;
  const achievementKey = `${GYM_ACHIEVEMENT}:${state.currentUserId}`;
  const previous = JSON.parse((await AsyncStorage.getItem(idsKey)) ?? '[]') as string[];
  await Promise.all(previous.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  if (!settings.pushEnabled || state.settings.showGym === false) {
    await AsyncStorage.setItem(idsKey, '[]');
    return;
  }
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  const sessions = (state.gymSessions ?? [])
    .filter(
      (session) =>
        session.userId === state.currentUserId &&
        completedGymSets(session.exercises) > 0,
    )
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const latest = sessions[0];
  const ids: string[] = [];

  if (settings.gymAchievements !== false && latest) {
    const alreadyNotified = await AsyncStorage.getItem(achievementKey);
    if (alreadyNotified !== latest.id) {
      const records = latest.exercises.flatMap((exercise) => {
        const current = Math.max(
          0,
          ...exercise.sets
            .filter((set) => set.completed)
            .map((set) => estimatedOneRepMax(set.weightKg, set.reps)),
        );
        const previousHistory = exerciseHistory(
          sessions.filter((session) => session.id !== latest.id),
          state.currentUserId,
          exerciseIdentity(exercise),
        );
        const previousBest = Math.max(
          0,
          ...previousHistory.map((item) => item.estimatedOneRepMaxKg),
        );
        return current > 0 && previousBest > 0 && current >= previousBest * 1.005
          ? [exercise.name]
          : [];
      });
      const previousComparable =
        sessions
          .slice(1)
          .find(
            (session) =>
              (latest.planId && session.planId === latest.planId) ||
              session.name.trim().toLowerCase() ===
                latest.name.trim().toLowerCase(),
          ) ?? sessions[1];
      const latestRest = averageGymRestSeconds(latest.exercises);
      const priorRest = previousComparable
        ? averageGymRestSeconds(previousComparable.exercises)
        : 0;
      const restCopy =
        latestRest > 0 && priorRest > 0
          ? ` Average rest was ${Math.abs(latestRest - priorRest)}s ${latestRest > priorRest ? 'longer' : 'shorter'} than ${previousComparable.name}.`
          : '';
      ids.push(
        await Notifications.scheduleNotificationAsync({
          content: {
            ...localizedContent(
              state,
              records.length ? 'New workout best' : 'Workout saved',
              records.length
                ? `${records
                    .slice(0, 2)
                    .map((name) =>
                      localizeExerciseName(state.settings.language, {
                        exerciseKey: latest.exercises.find((item) => item.name === name)?.exerciseKey,
                        name,
                      }),
                    )
                    .join(' and ')} moved above your prior estimated best.${restCopy}`
                : `${completedGymSets(latest.exercises)} sets and ${Math.round(trainingVolumeKg(latest.exercises)).toLocaleString(localeForLanguage(state.settings.language))} kg of volume logged.${restCopy}`,
            ),
            data: { route: '/gym' },
          },
          trigger: null,
        }),
      );
      await AsyncStorage.setItem(achievementKey, latest.id);
    }
  }

  if (settings.gymReminders !== false) {
    const waitDays = Math.max(1, Math.min(14, settings.gymReminderDays ?? 3));
    const baseDate = latest?.localDate ?? dateKey();
    let reminderDate = dateWithOffsetFrom(baseDate, waitDays);
    const now = new Date();
    const time = reminderTime(state, '18:00');
    let trigger = new Date(`${reminderDate}T${time}:00`);
    if (trigger <= now) {
      reminderDate = dateWithOffsetFrom(dateKey(), 1);
      trigger = new Date(`${reminderDate}T${time}:00`);
    }
    ids.push(
      await Notifications.scheduleNotificationAsync({
        content: {
          ...localizedContent(
            state,
            'Ready for your next workout?',
            latest
              ? `It has been ${waitDays} days since ${latest.name}. Reuse it or choose another saved workout when you are ready.`
              : 'Start a workout to build your personal exercise baseline.',
          ),
          data: { route: '/gym' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: trigger,
        },
      }),
    );
  }
  await AsyncStorage.setItem(idsKey, JSON.stringify(ids));
}
