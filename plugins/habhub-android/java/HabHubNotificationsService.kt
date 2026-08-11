package __ANDROID_PACKAGE__

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.notifications.service.NotificationsService
import org.json.JSONArray
import org.json.JSONObject

/**
 * Handles workout actions immediately on Android's broadcast thread, then
 * delegates to Expo so its listener/routing behavior stays intact. Expo's
 * background TaskManager job may be delayed while the device is locked; the
 * native path keeps the visible phase, exercise name, and chronometer current
 * without waiting for that job.
 */
class HabHubNotificationsService : NotificationsService() {
  override fun onReceiveNotificationResponse(context: Context, intent: Intent) {
    runCatching {
      val response = getNotificationResponseFromBroadcastIntent(intent)
      HabHubWorkoutNotificationStore.applyAction(
        context,
        response.notification.notificationRequest.identifier,
        response.action.identifier,
        System.currentTimeMillis(),
      )
    }
    super.onReceiveNotificationResponse(context, intent)
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
  private const val MAX_ACTIONS = 30

  private data class Step(
    val title: String,
    val body: String,
    val phase: String,
  )

  private data class Flow(
    val steps: List<Step>,
    var index: Int,
    var paused: Boolean,
    var phaseStartedAt: Long,
    var phaseElapsedMs: Long,
    var finished: Boolean = false,
  )

  fun sync(context: Context, raw: String): Boolean {
    val incoming = parseFlow(raw) ?: return false
    val existing = readFlow(context)
    val hasQueuedNativeActions = runCatching {
      JSONArray(preferences(context).getString(ACTIONS_KEY, null) ?: "[]").length() > 0
    }.getOrDefault(false)
    val next = when {
      existing == null -> incoming
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
    return preferences(context).edit().putString(FLOW_KEY, encodeFlow(next)).commit()
  }

  fun clear(context: Context) {
    preferences(context).edit().remove(FLOW_KEY).remove(ACTIONS_KEY).commit()
  }

  fun consumeActions(context: Context): String {
    val prefs = preferences(context)
    val actions = prefs.getString(ACTIONS_KEY, null) ?: "[]"
    // Preserve the native flow until React has replayed every queued action.
    // Its monotonic timestamp guard then rejects intermediate/stale renders
    // and accepts subsequent genuine foreground transitions.
    prefs.edit().remove(ACTIONS_KEY).commit()
    return actions
  }

  fun applyAction(
    context: Context,
    notificationId: String,
    action: String,
    occurredAt: Long,
  ) {
    if (
      notificationId != NOTIFICATION_ID ||
      action !in setOf(NEXT_ACTION, PAUSE_ACTION, FINISH_ACTION)
    ) return

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

    if (!accepted) return
    val prefs = preferences(context)
    val editor = prefs.edit()
    if (flow != null) editor.putString(FLOW_KEY, encodeFlow(flow))
    editor.putString(ACTIONS_KEY, appendAction(prefs.getString(ACTIONS_KEY, null), action, occurredAt))
    editor.commit()
    if (flow != null) render(context, flow)
  }

  private fun render(context: Context, flow: Flow) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val active = manager.activeNotifications.firstOrNull { it.tag == NOTIFICATION_ID }
      ?: return
    val step = flow.steps.getOrNull(flow.index.coerceIn(0, flow.steps.lastIndex))
      ?: return
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

  private fun readFlow(context: Context): Flow? =
    preferences(context).getString(FLOW_KEY, null)?.let(::parseFlow)

  private fun parseFlow(raw: String): Flow? = runCatching {
    val json = JSONObject(raw)
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
      steps = steps,
      index = json.optInt("index", 0).coerceIn(0, steps.lastIndex),
      paused = json.optBoolean("paused", false),
      phaseStartedAt = json.optLong("phaseStartedAt", System.currentTimeMillis()),
      phaseElapsedMs = json.optLong("phaseElapsedMs", 0L).coerceAtLeast(0L),
      finished = json.optBoolean("finished", false),
    )
  }.getOrNull()

  private fun encodeFlow(flow: Flow) = JSONObject().apply {
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
  ): String {
    val existing = runCatching { JSONArray(raw ?: "[]") }.getOrElse { JSONArray() }
    val next = JSONArray()
    val first = (existing.length() - (MAX_ACTIONS - 1)).coerceAtLeast(0)
    for (index in first until existing.length()) next.put(existing.opt(index))
    next.put(JSONObject().apply {
      put("action", action)
      put("occurredAt", occurredAt)
    })
    return next.toString()
  }

  private fun formatElapsed(milliseconds: Long): String {
    val seconds = (milliseconds / 1000L).coerceAtLeast(0L)
    return "${seconds / 60L}:${(seconds % 60L).toString().padStart(2, '0')}"
  }
}
