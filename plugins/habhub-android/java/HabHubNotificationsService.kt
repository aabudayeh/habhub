package __ANDROID_PACKAGE__

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import expo.modules.notifications.notifications.model.Notification as ExpoNotification
import expo.modules.notifications.notifications.model.NotificationAction
import expo.modules.notifications.notifications.model.NotificationContent
import expo.modules.notifications.notifications.model.NotificationRequest
import expo.modules.notifications.notifications.model.NotificationResponse
import expo.modules.notifications.service.NotificationsService
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Handles workout actions immediately on Android's broadcast thread, then
 * delegates to Expo so its listener/routing behavior stays intact. Expo's
 * background TaskManager job may be delayed while the device is locked; the
 * native path keeps the visible phase, exercise name, and chronometer current
 * without waiting for that job.
 */
class HabHubNotificationsService : NotificationsService() {
  override fun onReceiveNotificationResponse(context: Context, intent: Intent) {
    val workoutActionHandled = runCatching {
      val response = getNotificationResponseFromBroadcastIntent(intent)
      val contentData = response.notification.notificationRequest.content.body
      HabHubWorkoutNotificationStore.applyAction(
        context,
        response.notification.notificationRequest.identifier,
        response.action.identifier,
        System.currentTimeMillis(),
        contentData?.optString("workoutOwnerId")?.takeIf(String::isNotBlank),
        contentData?.optString("workoutGeneration")?.takeIf(String::isNotBlank),
      )
    }.getOrDefault(false)
    super.onReceiveNotificationResponse(context, intent)
    if (workoutActionHandled) {
      // Expo still needs the response for routing, TaskManager, and Wear OS.
      // Reconcile once that delivery has run as well: some Android builds
      // rewrite the row after the receiver returns, which otherwise removes
      // the chronometer that applyAction installed synchronously.
      HabHubWorkoutNotificationStore.reconcileAsync(context.applicationContext)
    }
  }
}

/**
 * A user-dismissed workout row is restored while its private native flow is
 * still active. This is an explicit broadcast, not a foreground service: the
 * system chronometer keeps displaying elapsed time and the receiver performs
 * one bounded, backoff-controlled local repost.
 */
class HabHubWorkoutNotificationPersistenceReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != HabHubWorkoutNotificationStore.DISMISSED_ACTION) return
    val ownerId = intent.getStringExtra(HabHubWorkoutNotificationStore.OWNER_EXTRA)
    val generation = intent.getStringExtra(HabHubWorkoutNotificationStore.GENERATION_EXTRA)
    if (ownerId.isNullOrBlank() || generation.isNullOrBlank()) return
    val pendingResult = goAsync()
    HabHubWorkoutNotificationStore.restoreAfterUserDismissal(
      context.applicationContext,
      ownerId,
      generation,
    ) { pendingResult.finish() }
  }
}

internal object HabHubWorkoutNotificationStore {
  const val NOTIFICATION_ID = "metricrally-workout-timer-live"
  const val NEXT_ACTION = "workout-next"
  const val PAUSE_ACTION = "workout-pause"
  const val FINISH_ACTION = "workout-finish"
  const val DISMISSED_ACTION = "app.paceboard.mobile.WORKOUT_NOTIFICATION_DISMISSED"
  const val OWNER_EXTRA = "workoutOwnerId"
  const val GENERATION_EXTRA = "workoutGeneration"

  private const val PREFS = "habhub-workout-notification-v1"
  private const val FLOW_KEY = "flow"
  private const val ACTIONS_KEY = "actions"
  private const val ACTIVE_OWNER_KEY = "active-owner"
  private const val GENERATION_KEY = "generation"
  private const val DISABLED_KEY = "disabled"
  private const val PRESENTATION_ENABLED_KEY = "presentation-enabled"
  private const val REPOST_TOKEN_KEY = "repost-token"
  private const val LAST_DISMISS_AT_KEY = "last-dismiss-at"
  private const val DISMISS_STREAK_KEY = "dismiss-streak"
  private const val SYSTEM_NOTIFICATION_ID_KEY = "system-notification-id"
  private const val SMALL_ICON_KEY = "small-icon"
  private const val WORKOUT_CHANNEL_ID = "workout-timer"
  private const val DISMISS_STREAK_WINDOW_MS = 30_000L
  private const val MAX_ACTIONS = 30
  private val repostDelaysMs = longArrayOf(900L, 1_500L, 2_500L, 4_000L, 5_000L)
  private val reconciliationRunning = AtomicBoolean(false)
  private val reconciliationRequested = AtomicBoolean(false)
  private val stabilizationDelaysMs = longArrayOf(75L, 150L, 300L, 600L, 1_200L)

  private data class Step(
    val title: String,
    val body: String,
    val phase: String,
  )

  private data class Flow(
    val ownerId: String,
    val generation: String,
    val steps: List<Step>,
    var index: Int,
    var paused: Boolean,
    var phaseStartedAt: Long,
    var phaseElapsedMs: Long,
    var finished: Boolean = false,
  )

  @Synchronized
  fun sync(context: Context, raw: String): Boolean {
    val incoming = parseFlow(raw) ?: return false
    val existing = readFlow(context)
    val hasQueuedNativeActions = runCatching {
      JSONArray(preferences(context).getString(ACTIONS_KEY, null) ?: "[]").length() > 0
    }.getOrDefault(false)
    val next = when {
      existing == null -> incoming
      existing.ownerId != incoming.ownerId ||
        existing.generation != incoming.generation -> incoming
      // A foreground transition always receives a fresh phase origin. Keep a
      // newer native transition when a delayed React render arrives after a
      // lock-screen/Wear action; otherwise in-app Next/Pause must replace the
      // stored phase so the following native action starts from what is shown.
      incoming.phaseStartedAt > existing.phaseStartedAt -> incoming
      incoming.phaseStartedAt < existing.phaseStartedAt -> existing
      sameSteps(existing.steps, incoming.steps) -> existing
      // Editing the remaining workout can change its steps without starting a
      // new phase. At an equal phase timestamp that edit is authoritative only
      // after any native actions have been consumed; otherwise it may be an
      // intermediate React replay of a further-advanced lock-screen flow.
      hasQueuedNativeActions -> existing
      else -> incoming
    }
    return preferences(context).edit()
      .putBoolean(DISABLED_KEY, false)
      .putBoolean(PRESENTATION_ENABLED_KEY, true)
      .putLong(REPOST_TOKEN_KEY, preferences(context).getLong(REPOST_TOKEN_KEY, 0L) + 1L)
      .putString(ACTIVE_OWNER_KEY, incoming.ownerId)
      .putString(GENERATION_KEY, incoming.generation)
      .putString(FLOW_KEY, encodeFlow(next))
      .commit()
  }

  @Synchronized
  fun clear(context: Context) {
    // A committed tombstone is the native privacy fence. A response broadcast
    // already delivered by Android but waiting for this object's lock observes
    // disabled=true and cannot recreate actions after account/master cleanup.
    preferences(context).edit()
      .putBoolean(DISABLED_KEY, true)
      .putBoolean(PRESENTATION_ENABLED_KEY, false)
      .putLong(REPOST_TOKEN_KEY, preferences(context).getLong(REPOST_TOKEN_KEY, 0L) + 1L)
      .remove(ACTIVE_OWNER_KEY)
      .remove(GENERATION_KEY)
      .remove(FLOW_KEY)
      .remove(ACTIONS_KEY)
      .remove(LAST_DISMISS_AT_KEY)
      .remove(DISMISS_STREAK_KEY)
      .commit()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val manager =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.activeNotifications
        .filter { it.tag == NOTIFICATION_ID }
        .forEach { manager.cancel(it.tag, it.id) }
    }
  }

  @Synchronized
  fun suspendPersistence(context: Context) {
    val prefs = preferences(context)
    prefs.edit()
      .putBoolean(PRESENTATION_ENABLED_KEY, false)
      .putLong(REPOST_TOKEN_KEY, prefs.getLong(REPOST_TOKEN_KEY, 0L) + 1L)
      .remove(LAST_DISMISS_AT_KEY)
      .remove(DISMISS_STREAK_KEY)
      .commit()
  }

  /**
   * Coalesce duplicate OEM/delete broadcasts and add a short bounded backoff
   * when a user repeatedly swipes the same active workout row. The generation
   * token is checked again under the store lock before posting, so foreground,
   * master-off, finish, and account cleanup always win the race.
   */
  fun restoreAfterUserDismissal(
    context: Context,
    ownerId: String,
    generation: String,
    finish: () -> Unit,
  ) {
    val plan = synchronized(this) {
      val prefs = preferences(context)
      val flow = readFlow(context)
      if (
        flow == null ||
        flow.finished ||
        flow.ownerId != ownerId ||
        flow.generation != generation ||
        !prefs.getBoolean(PRESENTATION_ENABLED_KEY, false)
      ) null
      else {
        val now = System.currentTimeMillis()
        val previousDismiss = prefs.getLong(LAST_DISMISS_AT_KEY, 0L)
        val previousStreak = prefs.getInt(DISMISS_STREAK_KEY, 0)
        val streak = if (now - previousDismiss <= DISMISS_STREAK_WINDOW_MS) {
          previousStreak + 1
        } else {
          1
        }
        val token = prefs.getLong(REPOST_TOKEN_KEY, 0L) + 1L
        prefs.edit()
          .putLong(REPOST_TOKEN_KEY, token)
          .putLong(LAST_DISMISS_AT_KEY, now)
          .putInt(DISMISS_STREAK_KEY, streak)
          .commit()
        Pair(token, repostDelaysMs[(streak - 1).coerceIn(0, repostDelaysMs.lastIndex)])
      }
    }
    if (plan == null) {
      finish()
      return
    }
    runCatching {
      thread(name = "habhub-workout-notification-restore") {
        try {
          Thread.sleep(plan.second)
          runCatching {
            repostIfStillActive(context, ownerId, generation, plan.first)
          }
        } catch (_: InterruptedException) {
          Thread.currentThread().interrupt()
        } finally {
          finish()
        }
      }
    }.onFailure { finish() }
  }

  @Synchronized
  fun consumeActions(
    context: Context,
    ownerId: String,
    generation: String,
  ): String {
    val prefs = preferences(context)
    if (prefs.getBoolean(DISABLED_KEY, true)) {
      prefs.edit().remove(ACTIONS_KEY).commit()
      return "[]"
    }
    if (
      prefs.getString(ACTIVE_OWNER_KEY, null) != ownerId ||
      prefs.getString(GENERATION_KEY, null) != generation
    ) return "[]"
    val stored = runCatching {
      JSONArray(prefs.getString(ACTIONS_KEY, null) ?: "[]")
    }.getOrElse { JSONArray() }
    val actions = JSONArray()
    for (index in 0 until stored.length()) {
      val item = stored.optJSONObject(index) ?: continue
      if (
        item.optString("ownerId") == ownerId &&
        item.optString("generation") == generation
      ) actions.put(item)
    }
    // Preserve the native flow until React has replayed every queued action.
    // Its monotonic timestamp guard then rejects intermediate/stale renders
    // and accepts subsequent genuine foreground transitions.
    prefs.edit().remove(ACTIONS_KEY).commit()
    return actions.toString()
  }

  @Synchronized
  fun applyAction(
    context: Context,
    notificationId: String,
    action: String,
    occurredAt: Long,
    ownerId: String?,
    generation: String?,
  ): Boolean {
    if (
      notificationId != NOTIFICATION_ID ||
      action !in setOf(NEXT_ACTION, PAUSE_ACTION, FINISH_ACTION)
    ) return false

    val prefs = preferences(context)
    if (
      prefs.getBoolean(DISABLED_KEY, true) ||
      ownerId.isNullOrBlank() ||
      generation.isNullOrBlank() ||
      prefs.getString(ACTIVE_OWNER_KEY, null) != ownerId ||
      prefs.getString(GENERATION_KEY, null) != generation
    ) return false

    val flow = readFlow(context)
    var accepted = false
    if (flow != null && !flow.finished) {
      when (action) {
        PAUSE_ACTION -> {
          if (flow.paused) {
            flow.paused = false
            flow.phaseStartedAt = occurredAt
          } else {
            flow.phaseElapsedMs +=
              (occurredAt - flow.phaseStartedAt).coerceAtLeast(0L)
            flow.paused = true
            flow.phaseStartedAt = occurredAt
          }
          accepted = true
        }
        NEXT_ACTION -> {
          // Match the in-app control: Next while paused resumes the current
          // phase rather than skipping it; a following Next advances it.
          if (flow.paused) {
            flow.paused = false
            flow.phaseStartedAt = occurredAt
          } else {
            if (flow.index < flow.steps.lastIndex) {
              flow.index += 1
              flow.phaseStartedAt = occurredAt
              flow.phaseElapsedMs = 0L
            } else {
              flow.finished = true
            }
          }
          accepted = true
        }
        FINISH_ACTION -> {
          flow.finished = true
          accepted = true
        }
      }
    } else if (flow == null) {
      // Even if process restoration races the initial native flow handoff,
      // retain the action for React to replay when the app next becomes active.
      accepted = true
    }

    if (!accepted) return false
    val editor = prefs.edit()
    if (flow != null) editor.putString(FLOW_KEY, encodeFlow(flow))
    editor.putString(
      ACTIONS_KEY,
      appendAction(
        prefs.getString(ACTIONS_KEY, null),
        action,
        occurredAt,
        ownerId,
        generation,
      ),
    )
    editor.commit()
    if (flow != null) render(context, flow)
    return true
  }

  /**
   * Rebuild the currently stored phase on the existing Expo row. This never
   * creates a second notification: recoverBuilder retains Expo's content and
   * action PendingIntents, then notify(tag, id) updates that exact row.
   */
  fun reconcile(context: Context, identifier: String = NOTIFICATION_ID): Boolean {
    if (identifier != NOTIFICATION_ID || Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
      return false
    }
    repeat(40) { attempt ->
      if (renderStoredFlow(context)) return true
      if (attempt < 39) Thread.sleep(75L)
    }
    return false
  }

  fun reconcileAsync(context: Context) {
    reconciliationRequested.set(true)
    if (!reconciliationRunning.compareAndSet(false, true)) return
    thread(name = "habhub-workout-notification-reconcile") {
      try {
        do {
          reconciliationRequested.set(false)
          stabilize(context)
        } while (reconciliationRequested.get())
      } finally {
        reconciliationRunning.set(false)
        // Close the narrow handoff race where another receiver asks for a pass
        // after the loop condition but before running becomes false.
        if (reconciliationRequested.get()) reconcileAsync(context)
      }
    }
  }

  /**
   * Watch the one existing workout row through Expo/OEM's asynchronous
   * handoff. A matching row is left untouched; only a generation that lost
   * its title, phase origin, or chronometer flag is rebuilt. This is local
   * NotificationManager work, not a recurring JS/network timer.
   */
  private fun stabilize(context: Context) {
    if (!reconcile(context)) return
    stabilizationDelaysMs.forEach { delayMs ->
      Thread.sleep(delayMs)
      ensureStoredFlowRendered(context)
    }
  }

  @Synchronized
  private fun renderStoredFlow(context: Context): Boolean {
    val flow = readFlow(context) ?: return false
    return render(context, flow)
  }

  @Synchronized
  private fun ensureStoredFlowRendered(context: Context): Boolean {
    val flow = readFlow(context) ?: return false
    return matchesRenderedFlow(context, flow) || render(context, flow)
  }

  private fun matchesRenderedFlow(context: Context, flow: Flow): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val active = manager.activeNotifications.firstOrNull { it.tag == NOTIFICATION_ID }
      ?: return false
    val step = flow.steps.getOrNull(flow.index.coerceIn(0, flow.steps.lastIndex))
      ?: return false
    val phase = if (flow.paused) "paused" else step.phase
    val expectedTitle = when {
      flow.finished -> "Workout complete"
      phase == "paused" -> "PAUSED · ${step.title}"
      phase == "work" -> "WORK · ${step.title}"
      else -> "REST · ${step.title}"
    }
    val notification = active.notification
    val extras = notification.extras
    val titleMatches = extras
      .getCharSequence(Notification.EXTRA_TITLE)
      ?.toString() == expectedTitle
    val shouldRun = !flow.finished && !flow.paused
    val chronometerMatches =
      extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER, false) == shouldRun
    val showWhenMatches =
      extras.getBoolean(Notification.EXTRA_SHOW_WHEN, false) == shouldRun
    val originMatches = !shouldRun || kotlin.math.abs(
      notification.`when` - (flow.phaseStartedAt - flow.phaseElapsedMs),
    ) <= 1_000L
    return titleMatches && chronometerMatches && showWhenMatches && originMatches
  }

  private fun render(context: Context, flow: Flow): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val active = manager.activeNotifications.firstOrNull { it.tag == NOTIFICATION_ID }
      ?: return false
    val step = flow.steps.getOrNull(flow.index.coerceIn(0, flow.steps.lastIndex))
      ?: return false
    val phase = if (flow.paused) "paused" else step.phase
    val phaseLabel = when {
      flow.finished -> "DONE"
      phase == "paused" -> "PAUSED"
      phase == "work" -> "WORK"
      else -> "REST"
    }
    val title = if (flow.finished) {
      "Workout complete"
    } else {
      "$phaseLabel · ${step.title}"
    }
    val body = when {
      flow.finished -> "Open HabHub to review your completed workout."
      flow.paused -> "Paused at ${formatElapsed(flow.phaseElapsedMs)} · ${step.body}"
      else -> step.body
    }
    val builder = Notification.Builder.recoverBuilder(context, active.notification)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_STOPWATCH)
      .setContentTitle(title)
      .setContentText(body)
      .setAutoCancel(false)
      .setOngoing(false)
      .setDeleteIntent(dismissedPendingIntent(context, flow))

    if (flow.finished || flow.paused) {
      builder
        .setUsesChronometer(false)
        .setShowWhen(false)
        .setTimeoutAfter(0L)
    } else {
      builder
        .setShowWhen(true)
        .setWhen(flow.phaseStartedAt - flow.phaseElapsedMs)
        .setUsesChronometer(true)
        .setChronometerCountDown(false)
        .setTimeoutAfter(0L)
    }

    val previousActions = active.notification.actions?.toList().orEmpty()
    // Notification controls stay single-purpose: Next resumes a paused phase,
    // advances an active phase, and becomes Finish on the final phase. The
    // in-app workout screen remains the only pause/resume surface.
    val visibleActions = if (flow.finished) {
      emptyList()
    } else {
      previousActions.take(1).map { action ->
        relabel(
          action,
          when {
            flow.paused -> "Resume"
            flow.index == flow.steps.lastIndex -> "Finish workout"
            else -> "Next"
          },
        )
      }
    }
    builder.setActions(*visibleActions.toTypedArray())
    val smallIcon = active.notification.smallIcon?.resId ?: 0
    preferences(context).edit()
      .putInt(SYSTEM_NOTIFICATION_ID_KEY, active.id)
      .putInt(SMALL_ICON_KEY, smallIcon)
      .commit()
    manager.notify(active.tag, active.id, builder.build())
    return true
  }

  @Synchronized
  private fun repostIfStillActive(
    context: Context,
    ownerId: String,
    generation: String,
    token: Long,
  ) {
    val prefs = preferences(context)
    val flow = readFlow(context) ?: return
    if (
      flow.finished ||
      flow.ownerId != ownerId ||
      flow.generation != generation ||
      !prefs.getBoolean(PRESENTATION_ENABLED_KEY, false) ||
      prefs.getLong(REPOST_TOKEN_KEY, 0L) != token
    ) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (!manager.areNotificationsEnabled()) return
    if (manager.activeNotifications.any { it.tag == NOTIFICATION_ID }) return
    ensureWorkoutChannel(manager)
    val systemId = prefs.getInt(SYSTEM_NOTIFICATION_ID_KEY, NOTIFICATION_ID.hashCode())
    val notification = buildPersistentNotification(context, flow) ?: return
    // The token/presentation state cannot change until this synchronized post
    // returns. A foreground suspend that follows immediately cancels this row.
    manager.notify(NOTIFICATION_ID, systemId, notification)
  }

  private fun buildPersistentNotification(context: Context, flow: Flow): Notification? {
    val step = flow.steps.getOrNull(flow.index.coerceIn(0, flow.steps.lastIndex))
      ?: return null
    val phase = if (flow.paused) "paused" else step.phase
    val phaseLabel = when {
      phase == "paused" -> "PAUSED"
      phase == "work" -> "WORK"
      else -> "REST"
    }
    val title = "$phaseLabel · ${step.title}"
    val body = if (flow.paused) {
      "Paused at ${formatElapsed(flow.phaseElapsedMs)} · ${step.body}"
    } else {
      step.body
    }
    val data = JSONObject().apply {
      put("route", "/gym")
      put("workoutTimer", true)
      put(OWNER_EXTRA, flow.ownerId)
      put(GENERATION_EXTRA, flow.generation)
    }
    val content = NotificationContent.Builder()
      .setTitle(title)
      .setText(body)
      .setBody(data)
      .setAutoDismiss(false)
      .setSticky(false)
      .build()
    val expoNotification = ExpoNotification(
      NotificationRequest(NOTIFICATION_ID, content, null),
    )
    val icon = preferences(context).getInt(SMALL_ICON_KEY, 0)
      .takeIf { it != 0 }
      ?: context.applicationInfo.icon
    if (icon == 0) return null
    val firstAction = if (flow.paused) {
      NotificationAction(NEXT_ACTION, "Resume", false)
    } else if (flow.index < flow.steps.lastIndex) {
      NotificationAction(NEXT_ACTION, "Next", false)
    } else {
      NotificationAction(FINISH_ACTION, "Finish workout", false)
    }
    val defaultAction = NotificationAction(
      NotificationResponse.DEFAULT_ACTION_IDENTIFIER,
      "Open workout",
      true,
    )
    val color = when (phase) {
      "work" -> Color.parseColor("#A7F432")
      "paused" -> Color.parseColor("#D95852")
      else -> Color.parseColor("#E9A23B")
    }
    val builder = Notification.Builder(context, WORKOUT_CHANNEL_ID)
      .setSmallIcon(icon)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(Notification.BigTextStyle().bigText(body))
      .setContentIntent(
        NotificationsService.createNotificationResponseIntent(
          context,
          expoNotification,
          defaultAction,
        ),
      )
      .setDeleteIntent(dismissedPendingIntent(context, flow))
      .setOnlyAlertOnce(true)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setCategory(Notification.CATEGORY_STOPWATCH)
      .setColor(color)
      .setAutoCancel(false)
      .setOngoing(false)
      .setTimeoutAfter(0L)
      .addAction(
        Notification.Action.Builder(
          icon,
          firstAction.title,
          NotificationsService.createNotificationResponseIntent(
            context,
            expoNotification,
            firstAction,
          ),
        ).build(),
      )
    if (flow.paused) {
      builder.setUsesChronometer(false).setShowWhen(false)
    } else {
      builder
        .setShowWhen(true)
        .setWhen(flow.phaseStartedAt - flow.phaseElapsedMs)
        .setUsesChronometer(true)
        .setChronometerCountDown(false)
    }
    return builder.build()
  }

  private fun dismissedPendingIntent(context: Context, flow: Flow): PendingIntent {
    val intent = Intent(context, HabHubWorkoutNotificationPersistenceReceiver::class.java)
      .setAction(DISMISSED_ACTION)
      .putExtra(OWNER_EXTRA, flow.ownerId)
      .putExtra(GENERATION_EXTRA, flow.generation)
    return PendingIntent.getBroadcast(
      context,
      "${flow.ownerId}:${flow.generation}".hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun ensureWorkoutChannel(manager: NotificationManager) {
    if (manager.getNotificationChannel(WORKOUT_CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(
        WORKOUT_CHANNEL_ID,
        "Live workout timer",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        setSound(null, null)
        enableVibration(false)
        setShowBadge(false)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      },
    )
  }

  private fun relabel(action: Notification.Action, title: String): Notification.Action {
    val builder = Notification.Action.Builder(action.icon, title, action.actionIntent)
      .addExtras(action.extras)
    action.remoteInputs?.forEach(builder::addRemoteInput)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      builder.setSemanticAction(action.semanticAction)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      builder.setContextual(action.isContextual)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setAuthenticationRequired(action.isAuthenticationRequired)
    }
    return builder.build()
  }

  private fun sameSteps(left: List<Step>, right: List<Step>) =
    left.size == right.size && left.zip(right).all { (a, b) -> a == b }

  private fun preferences(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun readFlow(context: Context): Flow? {
    val prefs = preferences(context)
    if (prefs.getBoolean(DISABLED_KEY, true)) return null
    val activeOwner = prefs.getString(ACTIVE_OWNER_KEY, null) ?: return null
    val generation = prefs.getString(GENERATION_KEY, null) ?: return null
    val flow = prefs.getString(FLOW_KEY, null)?.let(::parseFlow) ?: return null
    return flow.takeIf {
      it.ownerId == activeOwner && it.generation == generation
    }
  }

  private fun parseFlow(raw: String): Flow? = runCatching {
    val json = JSONObject(raw)
    val ownerId = json.optString("ownerId")
    val generation = json.optString("generation")
    if (ownerId.isBlank() || generation.isBlank()) return@runCatching null
    val sourceSteps = json.optJSONArray("steps") ?: return@runCatching null
    val steps = buildList {
      for (index in 0 until sourceSteps.length()) {
        val step = sourceSteps.optJSONObject(index) ?: continue
        val title = step.optString("title")
        val body = step.optString("body")
        val phase = step.optString("phase")
        if (title.isNotBlank() && body.isNotBlank() && phase in setOf("work", "rest")) {
          add(Step(title, body, phase))
        }
      }
    }
    if (steps.isEmpty()) return@runCatching null
    Flow(
      ownerId = ownerId,
      generation = generation,
      steps = steps,
      index = json.optInt("index", 0).coerceIn(0, steps.lastIndex),
      paused = json.optBoolean("paused", false),
      phaseStartedAt = json.optLong("phaseStartedAt", System.currentTimeMillis()),
      phaseElapsedMs = json.optLong("phaseElapsedMs", 0L).coerceAtLeast(0L),
      finished = json.optBoolean("finished", false),
    )
  }.getOrNull()

  private fun encodeFlow(flow: Flow) = JSONObject().apply {
    put("ownerId", flow.ownerId)
    put("generation", flow.generation)
    put(
      "steps",
      JSONArray().apply {
        flow.steps.forEach { step ->
          put(JSONObject().apply {
            put("title", step.title)
            put("body", step.body)
            put("phase", step.phase)
          })
        }
      },
    )
    put("index", flow.index)
    put("paused", flow.paused)
    put("phaseStartedAt", flow.phaseStartedAt)
    put("phaseElapsedMs", flow.phaseElapsedMs)
    put("finished", flow.finished)
  }.toString()

  private fun appendAction(
    raw: String?,
    action: String,
    occurredAt: Long,
    ownerId: String,
    generation: String,
  ): String {
    val existing = runCatching { JSONArray(raw ?: "[]") }.getOrElse { JSONArray() }
    val next = JSONArray()
    val first = (existing.length() - (MAX_ACTIONS - 1)).coerceAtLeast(0)
    for (index in first until existing.length()) next.put(existing.opt(index))
    next.put(JSONObject().apply {
      put("action", action)
      put("occurredAt", occurredAt)
      put("ownerId", ownerId)
      put("generation", generation)
    })
    return next.toString()
  }

  private fun formatElapsed(milliseconds: Long): String {
    val seconds = (milliseconds / 1000L).coerceAtLeast(0L)
    return "${seconds / 60L}:${(seconds % 60L).toString().padStart(2, '0')}"
  }
}
