package __ANDROID_PACKAGE__

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
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

internal object HabHubWorkoutNotificationStore {
  const val NOTIFICATION_ID = "metricrally-workout-timer-live"
  const val NEXT_ACTION = "workout-next"
  const val PAUSE_ACTION = "workout-pause"
  const val FINISH_ACTION = "workout-finish"

  private const val PREFS = "habhub-workout-notification-v1"
  private const val FLOW_KEY = "flow"
  private const val ACTIONS_KEY = "actions"
  private const val ACTIVE_OWNER_KEY = "active-owner"
  private const val GENERATION_KEY = "generation"
  private const val DISABLED_KEY = "disabled"
  private const val MAX_ACTIONS = 30
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
      .remove(ACTIVE_OWNER_KEY)
      .remove(GENERATION_KEY)
      .remove(FLOW_KEY)
      .remove(ACTIONS_KEY)
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
    val visibleActions = when {
      flow.finished -> emptyList()
      // Keep both PendingIntents while paused. Removing Next would mean the
      // resumed row only has the Pause PendingIntent left to relabel, so its
      // apparent Next action would pause again. Next resumes the current phase
      // without skipping it; the second action is explicitly labeled Resume.
      flow.paused -> previousActions.mapIndexed { index, action ->
        if (index == 1) relabel(action, "Resume") else action
      }
      else -> previousActions.mapIndexed { index, action ->
        when (index) {
          0 -> relabel(
            action,
            if (flow.index == flow.steps.lastIndex) "Finish workout" else "Next",
          )
          1 -> relabel(action, "Pause")
          else -> action
        }
      }
    }
    builder.setActions(*visibleActions.toTypedArray())
    manager.notify(active.tag, active.id, builder.build())
    return true
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
