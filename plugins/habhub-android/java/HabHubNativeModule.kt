package __ANDROID_PACKAGE__

import android.Manifest
import android.app.AppOpsManager
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.fitness.FitnessLocal
import com.google.android.gms.fitness.LocalRecordingClient
import com.google.android.gms.fitness.data.LocalDataType
import com.google.android.gms.fitness.data.LocalField
import com.google.android.gms.fitness.request.LocalDataReadRequest
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import kotlin.math.roundToLong

class HabHubNativeModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private data class ForegroundUsage(
    var foregroundMs: Long = 0L,
    var lastTimeUsed: Long = 0L,
  )

  private data class EventUsageResult(
    val rowsByDay: Map<String, Map<String, ForegroundUsage>>,
    val coveredDays: Set<String>,
  )

  private data class UsageDay(
    val localDate: String,
    val from: Long,
    val to: Long,
    val rows: Map<String, ForegroundUsage>,
    val calculationMethod: String,
  )

  override fun getName() = "HabHubAndroid"

  override fun getConstants(): Map<String, Any> = mapOf(
    "nativeWorkoutActions" to true,
    "localPhoneStepRecording" to true,
  )

  private fun physicalActivityPermissionGranted() =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
      ContextCompat.checkSelfPermission(
        reactContext,
        Manifest.permission.ACTIVITY_RECOGNITION,
      ) == PackageManager.PERMISSION_GRANTED

  /**
   * Starts persistent, battery-efficient on-device recording without keeping
   * an app-owned sensor listener or foreground service alive.
   */
  @ReactMethod
  fun startLocalPhoneStepRecording(promise: Promise) {
    if (!physicalActivityPermissionGranted()) {
      promise.resolve(false)
      return
    }
    val playServices = GoogleApiAvailability.getInstance()
      .isGooglePlayServicesAvailable(
        reactContext,
        LocalRecordingClient.LOCAL_RECORDING_CLIENT_STEPS_MIN_VERSION_CODE,
      )
    if (playServices != ConnectionResult.SUCCESS) {
      promise.resolve(false)
      return
    }
    FitnessLocal.getLocalRecordingClient(reactContext)
      .subscribe(LocalDataType.TYPE_STEP_COUNT_DELTA)
      .addOnSuccessListener { promise.resolve(true) }
      .addOnFailureListener { promise.resolve(false) }
  }

  /**
   * Reads the accountless Android Recording API. Its step deltas are a phone
   * view that overlaps Health Connect, so JavaScript may use this only as a
   * current-day floor and must never add it to the Health Connect aggregate.
   */
  @ReactMethod
  fun readLocalPhoneSteps(from: Double, to: Double, promise: Promise) {
    val safeFrom = from.toLong()
    val safeTo = to.toLong().coerceAtMost(System.currentTimeMillis())
    if (!physicalActivityPermissionGranted() || safeFrom >= safeTo) {
      promise.resolve(null)
      return
    }
    val playServices = GoogleApiAvailability.getInstance()
      .isGooglePlayServicesAvailable(
        reactContext,
        LocalRecordingClient.LOCAL_RECORDING_CLIENT_STEPS_MIN_VERSION_CODE,
      )
    if (playServices != ConnectionResult.SUCCESS) {
      promise.resolve(null)
      return
    }
    val client = FitnessLocal.getLocalRecordingClient(reactContext)
    client.subscribe(LocalDataType.TYPE_STEP_COUNT_DELTA)
      .addOnSuccessListener {
        val request = LocalDataReadRequest.Builder()
          .read(LocalDataType.TYPE_STEP_COUNT_DELTA)
          .setTimeRange(safeFrom, safeTo, TimeUnit.MILLISECONDS)
          .build()
        client.readData(request)
          .addOnSuccessListener { response ->
            val points = response
              .getDataSet(LocalDataType.TYPE_STEP_COUNT_DELTA)
              .dataPoints
            if (points.isEmpty()) {
              promise.resolve(null)
              return@addOnSuccessListener
            }
            val count = points
              .sumOf { point ->
                point.getValue(LocalField.FIELD_STEPS)
                  .asInt()
                  .toDouble()
              }
            val coverageStart = points.minOf { point ->
              point.getStartTime(TimeUnit.MILLISECONDS)
            }
            promise.resolve(
              Arguments.createMap().apply {
                putDouble("count", count.coerceAtLeast(0.0))
                putDouble("coverageStartEpochMs", coverageStart.toDouble())
              },
            )
          }
          .addOnFailureListener {
            // Health Connect remains fully usable when Play services or the
            // optional local recorder is unavailable on this device.
            promise.resolve(null)
          }
      }
      .addOnFailureListener {
        promise.resolve(null)
      }
  }

  @ReactMethod
  fun stopLocalPhoneStepRecording(promise: Promise) {
    val playServices = GoogleApiAvailability.getInstance()
      .isGooglePlayServicesAvailable(
        reactContext,
        LocalRecordingClient.LOCAL_RECORDING_CLIENT_STEPS_MIN_VERSION_CODE,
      )
    if (playServices != ConnectionResult.SUCCESS) {
      promise.resolve(false)
      return
    }
    FitnessLocal.getLocalRecordingClient(reactContext)
      .unsubscribe(LocalDataType.TYPE_STEP_COUNT_DELTA)
      .addOnSuccessListener { promise.resolve(true) }
      .addOnFailureListener { promise.resolve(false) }
  }

  private fun usageAccessGranted(): Boolean {
    val appOps = reactContext.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      appOps.unsafeCheckOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS,
        Process.myUid(),
        reactContext.packageName,
      )
    } else {
      @Suppress("DEPRECATION")
      appOps.checkOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS,
        Process.myUid(),
        reactContext.packageName,
      )
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }

  @ReactMethod
  fun isUsageAccessGranted(promise: Promise) {
    promise.resolve(usageAccessGranted())
  }

  @ReactMethod
  fun openUsageAccessSettings(promise: Promise) {
    try {
      val targeted = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
        data = Uri.parse("package:${reactContext.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      try {
        reactContext.startActivity(targeted)
      } catch (_: Exception) {
        reactContext.startActivity(
          Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK,
          ),
        )
      }
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("usage_settings_unavailable", error)
    }
  }

  @ReactMethod
  fun queryUsageStats(from: Double, to: Double, limit: Double, promise: Promise) {
    if (!usageAccessGranted()) {
      promise.resolve(
        Arguments.createMap().apply {
          putBoolean("supported", true)
          putBoolean("accessGranted", false)
          putDouble("from", from)
          putDouble("to", to)
          putDouble("screenTimeMs", 0.0)
          putBoolean("approximate", true)
          putArray("apps", Arguments.createArray())
        },
      )
      return
    }
    thread(name = "habhub-usage-stats") {
      try {
        val now = System.currentTimeMillis()
        val safeTo = to.toLong().coerceAtMost(now)
        // Keep a bounded two-year history request so first-run hydration stays
        // responsive. UsageStats retention is OEM-controlled and can be much
        // shorter; the returned `from` tells JavaScript the actual query bound.
        val maxWindow = 730L * 24L * 60L * 60L * 1000L
        val safeFrom = from.toLong().coerceAtLeast(safeTo - maxWindow)
        require(safeFrom < safeTo) { "Usage range must have a positive duration." }
        val manager = reactContext.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val packageManager = reactContext.packageManager
        val eventUsage = usageFromForegroundEvents(manager, safeFrom, safeTo)
        val dailyFallback = usageFromDailyAggregates(manager, safeFrom, safeTo)
        val days = localDayWindows(safeFrom, safeTo).mapNotNull { window ->
          val localDate = localDateKey(window.first)
          val maximumMs = window.second - window.first
          val aggregateRows = dailyFallback[localDate]?.let {
            normalizedUsageRows(it, maximumMs)
          }
          val eventCovered = eventUsage.coveredDays.contains(localDate)
          val eventRows = normalizedUsageRows(
            eventUsage.rowsByDay[localDate].orEmpty(),
            maximumMs,
          )
          val isCurrentDay = localDate == localDateKey(now)
          val eventTotal = eventRows.values.sumOf { it.foregroundMs }
          val aggregateTotal = aggregateRows?.values?.sumOf { it.foregroundMs } ?: 0L
          // DAILY UsageStats is stable for retained history but can lag during
          // the current partial day. Use the reconstructed event stream only
          // when it contains more foreground time; this fixes the common
          // Samsung undercount without replacing complete history with the
          // short-lived event archive.
          val useCurrentEvents =
            isCurrentDay && eventCovered && eventTotal > aggregateTotal
          val sourceRows = when {
            useCurrentEvents -> eventRows
            aggregateRows != null -> aggregateRows
            eventCovered -> eventRows
            else -> return@mapNotNull null
          }
          UsageDay(
            localDate = localDate,
            from = window.first,
            to = window.second,
            rows = sourceRows,
            calculationMethod = if (useCurrentEvents || aggregateRows == null) {
              "foreground_events"
            } else {
              "aggregate_fallback"
            },
          )
        }
        val combinedRows = mutableMapOf<String, ForegroundUsage>()
        days.forEach { day ->
          day.rows.forEach { (packageName, usage) ->
            val combined = combinedRows.getOrPut(packageName) { ForegroundUsage() }
            combined.foregroundMs += usage.foregroundMs
            combined.lastTimeUsed = maxOf(combined.lastTimeUsed, usage.lastTimeUsed)
          }
        }
        val rows = combinedRows.entries.sortedByDescending { it.value.foregroundMs }
        val total = days.sumOf { day -> day.rows.values.sumOf { it.foregroundMs } }
        val apps = usageApps(
          packageManager,
          rows.map { it.key to it.value },
          limit.toInt().coerceIn(1, 500),
        )
        val dailyReports = Arguments.createArray()
        days.forEach { day ->
          dailyReports.pushMap(
            Arguments.createMap().apply {
              putString("localDate", day.localDate)
              putDouble("from", day.from.toDouble())
              putDouble("to", day.to.toDouble())
              putDouble(
                "screenTimeMs",
                day.rows.values.sumOf { it.foregroundMs }.toDouble(),
              )
              putString("calculationMethod", day.calculationMethod)
            },
          )
        }
        promise.resolve(
          Arguments.createMap().apply {
            putBoolean("supported", true)
            putBoolean("accessGranted", true)
            putDouble("from", safeFrom.toDouble())
            putDouble("to", safeTo.toDouble())
            putDouble("screenTimeMs", total.toDouble())
            putBoolean("approximate", true)
            putString(
              "calculationMethod",
              when {
                days.all { it.calculationMethod == "foreground_events" } -> "foreground_events"
                days.all { it.calculationMethod == "aggregate_fallback" } -> "aggregate_fallback"
                else -> "mixed"
              },
            )
            putArray("apps", apps)
            putArray("days", dailyReports)
          },
        )
      } catch (error: Exception) {
        promise.reject("usage_query_failed", error)
      }
    }
  }

  @ReactMethod
  fun isIgnoringBatteryOptimizations(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      promise.resolve(true)
      return
    }
    try {
      val powerManager = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
      promise.resolve(
        powerManager.isIgnoringBatteryOptimizations(reactContext.packageName),
      )
    } catch (error: Exception) {
      promise.reject("battery_optimization_status_failed", error)
    }
  }

  @ReactMethod
  fun canScheduleExactAlarms(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      promise.resolve(true)
      return
    }
    try {
      val alarmManager = reactContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      promise.resolve(alarmManager.canScheduleExactAlarms())
    } catch (error: Exception) {
      promise.reject("exact_alarm_status_failed", error)
    }
  }

  /** Opens exact-alarm access only after a deliberate user tap. */
  @ReactMethod
  fun openExactAlarmSettings(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      promise.resolve(false)
      return
    }
    try {
      val packageUri = Uri.parse("package:${reactContext.packageName}")
      val candidates = listOf(
        Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, packageUri),
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri),
      )
      val opened = candidates.any { candidate ->
        candidate.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
          reactContext.startActivity(candidate)
          true
        } catch (_: Exception) {
          false
        }
      }
      promise.resolve(opened)
    } catch (error: Exception) {
      promise.reject("exact_alarm_settings_unavailable", error)
    }
  }

  /**
   * Opens Android's user-managed battery-optimization list. HabHub deliberately
   * does not request a direct exemption or launch this page automatically.
   */
  @ReactMethod
  fun openBatteryOptimizationSettings(promise: Promise) {
    try {
      val packageUri = Uri.parse("package:${reactContext.packageName}")
      val candidates = listOf(
        Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri),
        Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS),
        Intent(Settings.ACTION_SETTINGS),
      )
      val opened = candidates.any { candidate ->
        candidate.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
          reactContext.startActivity(candidate)
          true
        } catch (_: Exception) {
          false
        }
      }
      promise.resolve(opened)
    } catch (error: Exception) {
      promise.reject("battery_optimization_settings_unavailable", error)
    }
  }

  /**
   * Adds Android's native chronometer to an Expo notification after Expo has
   * posted it. Rebuilding the existing notification (rather than replacing it
   * with a separate custom notification) preserves Expo's content intent,
   * category action PendingIntents, Wear OS bridge behavior, and serialized
   * request metadata.
   *
   * mode is one of "elapsed", "countdown", or "paused". referenceTime is a
   * wall-clock epoch in milliseconds: the timer origin for elapsed mode and
   * the target end for countdown mode. timeoutAt removes a countdown's live
   * notification at zero so Android never starts counting upward afterwards.
   */
  @ReactMethod
  fun enhanceTimerNotification(
    identifier: String,
    mode: String,
    referenceTime: Double,
    timeoutAt: Double,
    expectedTitle: String,
    promise: Promise,
  ) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
      promise.resolve(false)
      return
    }
    thread(name = "habhub-live-notification") {
      try {
        val manager = reactContext.getSystemService(
          Context.NOTIFICATION_SERVICE,
        ) as NotificationManager
        // Posting a local notification is asynchronous inside
        // expo-notifications. Briefly retry so we enhance the first frame that
        // reaches NotificationManager without blocking the JS or UI threads.
        var updated = false
        for (attempt in 0 until 20) {
          val active = manager.activeNotifications.firstOrNull {
            it.tag == identifier
          }
          val activeTitle = active?.notification?.extras
            ?.getCharSequence(Notification.EXTRA_TITLE)
            ?.toString()
          // An update reuses the same notification tag. Wait until Expo has
          // posted the requested generation instead of immediately rebuilding
          // the previous phase and then losing the chronometer when Expo's
          // asynchronous replacement lands.
          if (active != null && (expectedTitle.isBlank() || activeTitle == expectedTitle)) {
            val builder = Notification.Builder.recoverBuilder(
              reactContext,
              active.notification,
            ).setOnlyAlertOnce(true)
              .setCategory(Notification.CATEGORY_STOPWATCH)
            if (mode == "paused") {
              builder
                .setUsesChronometer(false)
                .setShowWhen(false)
                .setTimeoutAfter(0L)
            } else {
              builder
                .setShowWhen(true)
                .setWhen(referenceTime.toLong())
                .setUsesChronometer(true)
                .setChronometerCountDown(mode == "countdown")
              val remaining = timeoutAt.toLong() - System.currentTimeMillis()
              builder.setTimeoutAfter(if (remaining > 0L) remaining else 0L)
            }
            manager.notify(active.tag, active.id, builder.build())
            updated = true
            break
          }
          if (attempt < 19) Thread.sleep(50L)
        }
        promise.resolve(updated)
      } catch (error: Exception) {
        // The Expo notification is still useful without enhancement, so this
        // is a best-effort capability and must not break timer actions.
        promise.resolve(false)
      }
    }
  }

  @ReactMethod
  fun syncWorkoutTimerNotificationFlow(flow: String, promise: Promise) {
    promise.resolve(HabHubWorkoutNotificationStore.sync(reactContext, flow))
  }

  @ReactMethod
  fun reconcileWorkoutTimerNotification(identifier: String, promise: Promise) {
    thread(name = "habhub-workout-notification") {
      try {
        val reconciled = HabHubWorkoutNotificationStore.reconcile(
          reactContext,
          identifier,
        )
        if (reconciled) {
          // Expo and some OEM notification pipelines can perform a delayed
          // rewrite after scheduleNotificationAsync has resolved. Keep the
          // native stopwatch row authoritative through that handoff without
          // blocking React or posting a second notification.
          HabHubWorkoutNotificationStore.reconcileAsync(
            reactContext.applicationContext,
          )
        }
        promise.resolve(reconciled)
      } catch (_: Exception) {
        // Expo's notification remains usable if an OEM does not expose the
        // active row in time. Never reject the React call for this best-effort
        // visual enhancement.
        promise.resolve(false)
      }
    }
  }

  @ReactMethod
  fun consumeWorkoutTimerNotificationActions(
    ownerId: String,
    generation: String,
    promise: Promise,
  ) {
    promise.resolve(
      HabHubWorkoutNotificationStore.consumeActions(
        reactContext,
        ownerId,
        generation,
      ),
    )
  }

  @ReactMethod
  fun clearWorkoutTimerNotificationFlow(promise: Promise) {
    HabHubWorkoutNotificationStore.clear(reactContext)
    promise.resolve(true)
  }

  /**
   * Replays the short-lived activity event stream as a fallback when an OEM
   * has not materialized the current DAILY UsageStats bucket yet. Historical
   * accuracy comes from daily aggregates because Android retains events for
   * only a few days.
   */
  private fun usageFromForegroundEvents(
    manager: UsageStatsManager,
    from: Long,
    to: Long,
  ): EventUsageResult {
    val dayMs = 24L * 60L * 60L * 1000L
    val lookback = (from - dayMs).coerceAtLeast(0L)
    val events = manager.queryEvents(lookback, to)
      ?: return EventUsageResult(emptyMap(), emptySet())
    val rowsByDay = mutableMapOf<String, MutableMap<String, ForegroundUsage>>()
    val coveredDays = mutableSetOf<String>()
    val event = UsageEvents.Event()
    var currentPackage: String? = null
    var currentActivityKey: String? = null
    var screenInteractive = Build.VERSION.SDK_INT < Build.VERSION_CODES.P
    var keyguardHidden = true
    var sawScreenState = false
    var cursor = lookback

      fun accrue(until: Long) {
        var start = maxOf(cursor, from)
        val end = minOf(until, to)
        val packageName = currentPackage
        // Long unlocked/idle gaps can span hundreds of local days during the
        // retained-history request. There is nothing to split or attribute
        // until an app is both foreground and visible.
        if (packageName == null || !screenInteractive || !keyguardHidden || end <= start) {
          return
        }
        while (end > start) {
          val segmentEnd = minOf(end, nextLocalMidnight(start))
          if (segmentEnd > start) {
          val localDate = localDateKey(start)
          val rows = rowsByDay.getOrPut(localDate) { mutableMapOf() }
          val usage = rows.getOrPut(packageName) { ForegroundUsage() }
          usage.foregroundMs += segmentEnd - start
          usage.lastTimeUsed = maxOf(usage.lastTimeUsed, segmentEnd)
          coveredDays.add(localDate)
        }
        start = segmentEnd
      }
    }

    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      val timestamp = event.timeStamp.coerceIn(lookback, to)
      if (timestamp < cursor) continue
      accrue(timestamp)
      if (timestamp >= from) coveredDays.add(localDateKey(timestamp))
      when (event.eventType) {
        UsageEvents.Event.SCREEN_INTERACTIVE -> {
          screenInteractive = true
          sawScreenState = true
        }
        UsageEvents.Event.SCREEN_NON_INTERACTIVE -> {
          screenInteractive = false
          sawScreenState = true
          // Keep the resumed package across display-off. Several Samsung and
          // vendor builds do not emit another ACTIVITY_RESUMED when the user
          // unlocks back into the same activity; clearing it here drops the
          // entire next foreground session compared with Digital Wellbeing.
          // A real pause/resume transition still updates the package normally.
        }
        UsageEvents.Event.DEVICE_SHUTDOWN -> {
          screenInteractive = false
          sawScreenState = true
          currentPackage = null
          currentActivityKey = null
        }
        UsageEvents.Event.KEYGUARD_SHOWN -> keyguardHidden = false
        UsageEvents.Event.KEYGUARD_HIDDEN -> keyguardHidden = true
        UsageEvents.Event.ACTIVITY_RESUMED -> {
          currentPackage = event.packageName
          currentActivityKey = "${event.packageName}\u0000${event.className ?: ""}"
          // Older devices and vendor builds do not always retain explicit
          // screen-state events. A resumed activity is then the best evidence
          // that the display was interactive.
          if (!sawScreenState) screenInteractive = true
        }
        UsageEvents.Event.ACTIVITY_PAUSED -> {
          val pausedActivityKey = "${event.packageName}\u0000${event.className ?: ""}"
          // A pause from an older Activity must not erase a newer resumed
          // Activity in the same app. Tracking the class as well as package
          // prevents a common navigation undercount.
          if (currentActivityKey == pausedActivityKey) {
            currentPackage = null
            currentActivityKey = null
          }
        }
        // Do not clear the package on ACTIVITY_STOPPED. Android commonly emits
        // it after another Activity in the same package has already resumed;
        // clearing here loses the entire following foreground interval and
        // substantially underreports compared with Digital Wellbeing.
        UsageEvents.Event.ACTIVITY_STOPPED -> Unit
      }
      cursor = timestamp
    }
    accrue(to)
    return EventUsageResult(rowsByDay, coveredDays)
  }

  private fun localDateKey(timestamp: Long): String =
    SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(timestamp))

  private fun nextLocalMidnight(timestamp: Long): Long {
    val calendar = Calendar.getInstance().apply {
      timeInMillis = timestamp
      set(Calendar.HOUR_OF_DAY, 0)
      set(Calendar.MINUTE, 0)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
      add(Calendar.DAY_OF_YEAR, 1)
    }
    return calendar.timeInMillis.coerceAtLeast(timestamp + 1)
  }

  private fun localDayWindows(from: Long, to: Long): List<Pair<Long, Long>> {
    val windows = mutableListOf<Pair<Long, Long>>()
    var cursor = from
    while (cursor < to) {
      val end = minOf(to, nextLocalMidnight(cursor))
      windows.add(cursor to end)
      cursor = end
    }
    return windows
  }

  /**
   * Usage events are retained for only a few days. For older dates request
   * DAILY buckets explicitly and assign each returned bucket to its native
   * local date. Proportionally spreading a bucket fabricates historical
   * values because UsageStats does not expose within-bucket timing.
   * queryAndAggregateUsageStats is deliberately
   * avoided because it may return an entire weekly/monthly bucket for a
   * single-day request (the source of impossible 44-hour values).
   */
  private fun usageFromDailyAggregates(
    manager: UsageStatsManager,
    from: Long,
    to: Long,
  ): Map<String, Map<String, ForegroundUsage>> {
    val rowsByDay = mutableMapOf<String, MutableMap<String, ForegroundUsage>>()
    val stats = manager.queryUsageStats(
      UsageStatsManager.INTERVAL_DAILY,
      from,
      to,
    ) ?: return emptyMap()
    stats.forEach usageLoop@{ usage ->
      if (usage.totalTimeInForeground <= 0L || excludedUsagePackage(usage.packageName))
        return@usageLoop
      val bucketTimestamp = usage.firstTimeStamp.takeIf { it > 0L } ?: from
      val calendar = Calendar.getInstance().apply {
        timeInMillis = bucketTimestamp
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
      }
      val dayStart = calendar.timeInMillis
      val dayEnd = nextLocalMidnight(dayStart)
      val bucketEnd = usage.lastTimeStamp.takeIf { it > bucketTimestamp } ?: dayEnd
      // A vendor-expanded weekly/monthly row has no public per-day breakdown.
      // Dropping it is safer than inventing or cloning a total onto one date.
      if (bucketEnd > dayEnd) return@usageLoop
      val windowStart = maxOf(from, dayStart)
      val windowEnd = minOf(to, dayEnd)
      val maximum = windowEnd - windowStart
      if (maximum <= 0L) return@usageLoop
      val foreground = usage.totalTimeInForeground.coerceIn(0L, maximum)
      if (foreground <= 0L) return@usageLoop
      val rows = rowsByDay.getOrPut(localDateKey(dayStart)) { mutableMapOf() }
      val row = rows.getOrPut(usage.packageName) { ForegroundUsage() }
      // A few OEMs return duplicate interval rows. The row already represents
      // a daily total, so summing duplicates would double-count the package.
      row.foregroundMs = maxOf(row.foregroundMs, foreground)
      row.lastTimeUsed = maxOf(
        row.lastTimeUsed,
        usage.lastTimeUsed.coerceIn(windowStart, windowEnd),
      )
    }
    return rowsByDay
  }

  private fun normalizedUsageRows(
    source: Map<String, ForegroundUsage>,
    maximumMs: Long,
  ): Map<String, ForegroundUsage> {
    val bounded = source
      .filter { (packageName, usage) ->
        usage.foregroundMs > 0L && !excludedUsagePackage(packageName)
      }
      .mapValues { (_, usage) ->
        ForegroundUsage(
          foregroundMs = usage.foregroundMs.coerceIn(0L, maximumMs),
          lastTimeUsed = usage.lastTimeUsed,
        )
      }
    val total = bounded.values.sumOf { it.foregroundMs }
    if (total <= maximumMs || total <= 0L) return bounded
    val scale = maximumMs.toDouble() / total.toDouble()
    return bounded.mapValues { (_, usage) ->
      usage.copy(foregroundMs = (usage.foregroundMs * scale).roundToLong())
    }
  }

  private fun usageApps(
    packageManager: android.content.pm.PackageManager,
    rows: List<Pair<String, ForegroundUsage>>,
    limit: Int,
  ) = Arguments.createArray().apply {
    rows.take(limit).forEach { (packageName, usage) ->
      val info = try {
        packageManager.getApplicationInfo(packageName, 0)
      } catch (_: Exception) {
        null
      }
      pushMap(
        Arguments.createMap().apply {
          putString("packageName", packageName)
          putString(
            "appName",
            info?.let { packageManager.getApplicationLabel(it).toString() }
              ?: packageName,
          )
          putDouble("foregroundMs", usage.foregroundMs.toDouble())
          putDouble("lastTimeUsed", usage.lastTimeUsed.toDouble())
          putString("category", appCategory(info))
          putBoolean(
            "isSystemApp",
            info?.let {
              it.flags and (ApplicationInfo.FLAG_SYSTEM or ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0
            } ?: false,
          )
        },
      )
    }
  }

  private fun excludedUsagePackage(packageName: String): Boolean {
    if (packageName == "android") return true
    return packageName in setOf(
      "com.android.systemui",
      "com.android.permissioncontroller",
      "com.google.android.permissioncontroller",
      "com.google.android.inputmethod.latin",
      "com.samsung.android.honeyboard",
      "com.sec.android.app.launcher",
      "com.samsung.android.app.cocktailbarservice",
    )
  }

  private fun appCategory(info: ApplicationInfo?): String {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || info == null) return "unknown"
    return when (info.category) {
      ApplicationInfo.CATEGORY_GAME -> "game"
      ApplicationInfo.CATEGORY_AUDIO -> "audio"
      ApplicationInfo.CATEGORY_VIDEO -> "video"
      ApplicationInfo.CATEGORY_IMAGE -> "image"
      ApplicationInfo.CATEGORY_SOCIAL -> "social"
      ApplicationInfo.CATEGORY_NEWS -> "news"
      ApplicationInfo.CATEGORY_MAPS -> "maps"
      ApplicationInfo.CATEGORY_PRODUCTIVITY -> "productivity"
      ApplicationInfo.CATEGORY_ACCESSIBILITY -> "accessibility"
      else -> "unknown"
    }
  }

  @ReactMethod
  fun updateWidgetSnapshot(snapshot: String, promise: Promise) {
    try {
      HabHubWidgetStore.saveSnapshot(reactContext, snapshot)
      HabHubWidgetRenderer.updateAll(reactContext)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("widget_update_failed", error)
    }
  }

  @ReactMethod
  fun refreshWidgets(promise: Promise) {
    try {
      HabHubWidgetRenderer.updateAll(reactContext)
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("widget_refresh_failed", error)
    }
  }

  @ReactMethod
  fun configureWidget(widgetId: Double, trackerId: String, range: String, promise: Promise) {
    try {
      HabHubWidgetStore.saveConfiguration(
        reactContext,
        widgetId.toInt(),
        trackerId,
        range,
      )
      HabHubWidgetRenderer.updateWidget(reactContext, widgetId.toInt())
      promise.resolve(true)
    } catch (error: Exception) {
      promise.reject("widget_configuration_failed", error)
    }
  }

  @ReactMethod
  fun getWidgetConfigurations(promise: Promise) {
    try {
      val result = Arguments.createArray()
      HabHubWidgetStore.configurations(reactContext).forEach { configuration ->
        result.pushMap(
          Arguments.createMap().apply {
            putInt("widgetId", configuration.widgetId)
            putString("trackerId", configuration.trackerId)
            putString("range", configuration.range)
          },
        )
      }
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("widget_configuration_read_failed", error)
    }
  }
}

