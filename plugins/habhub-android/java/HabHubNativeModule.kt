package __ANDROID_PACKAGE__

import android.app.AppOpsManager
import android.app.Notification
import android.app.NotificationManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
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
  )

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
        val maxWindow = 366L * 24L * 60L * 60L * 1000L
        val safeFrom = from.toLong().coerceAtLeast(safeTo - maxWindow)
        require(safeFrom < safeTo) { "Usage range must have a positive duration." }
        val manager = reactContext.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val packageManager = reactContext.packageManager
        val eventUsage = usageFromForegroundEvents(manager, safeFrom, safeTo)
        val dailyFallback = usageFromDailyAggregates(manager, safeFrom, safeTo)
        val days = localDayWindows(safeFrom, safeTo).mapNotNull { window ->
          val localDate = localDateKey(window.first)
          val eventCovered = eventUsage.coveredDays.contains(localDate)
          val sourceRows = if (eventCovered) {
            eventUsage.rowsByDay[localDate].orEmpty()
          } else {
            dailyFallback[localDate] ?: return@mapNotNull null
          }
          UsageDay(
            localDate = localDate,
            from = window.first,
            to = window.second,
            rows = normalizedUsageRows(sourceRows, window.second - window.first),
            calculationMethod = if (eventCovered) "foreground_events" else "aggregate_fallback",
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
  fun consumeWorkoutTimerNotificationActions(promise: Promise) {
    promise.resolve(HabHubWorkoutNotificationStore.consumeActions(reactContext))
  }

  @ReactMethod
  fun clearWorkoutTimerNotificationFlow(promise: Promise) {
    HabHubWorkoutNotificationStore.clear(reactContext)
    promise.resolve(true)
  }

  /**
   * UsageStats totals can cover expanded aggregation buckets and several apps
   * can report foreground time over the same interval. Replaying activity and
   * screen/keyguard events produces one active app at a time and clips every
   * interval to the exact requested range, which is substantially closer to
   * Android Digital Wellbeing and Samsung's screen-time total.
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
    var screenInteractive = Build.VERSION.SDK_INT < Build.VERSION_CODES.P
    var keyguardHidden = true
    var sawScreenState = false
    var cursor = lookback

    fun accrue(until: Long) {
      var start = maxOf(cursor, from)
      val end = minOf(until, to)
      val packageName = currentPackage
      while (end > start) {
        val segmentEnd = minOf(end, nextLocalMidnight(start))
        if (
          packageName != null &&
          screenInteractive &&
          keyguardHidden &&
          segmentEnd > start
        ) {
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
        }
        UsageEvents.Event.KEYGUARD_SHOWN -> keyguardHidden = false
        UsageEvents.Event.KEYGUARD_HIDDEN -> keyguardHidden = true
        UsageEvents.Event.ACTIVITY_RESUMED -> {
          currentPackage = event.packageName
          // Older devices and vendor builds do not always retain explicit
          // screen-state events. A resumed activity is then the best evidence
          // that the display was interactive.
          if (!sawScreenState) screenInteractive = true
        }
        UsageEvents.Event.ACTIVITY_PAUSED -> {
          if (currentPackage == event.packageName) currentPackage = null
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
   * DAILY buckets explicitly and proportionally clip any OEM-expanded bucket
   * to each requested local day. queryAndAggregateUsageStats is deliberately
   * avoided because it may return an entire weekly/monthly bucket for a
   * single-day request (the source of impossible 44-hour values).
   */
  private fun usageFromDailyAggregates(
    manager: UsageStatsManager,
    from: Long,
    to: Long,
  ): Map<String, Map<String, ForegroundUsage>> {
    val rowsByDay = mutableMapOf<String, MutableMap<String, ForegroundUsage>>()
    val windows = localDayWindows(from, to)
    val stats = manager.queryUsageStats(
      UsageStatsManager.INTERVAL_DAILY,
      from,
      to,
    ) ?: return emptyMap()
    stats.forEach usageLoop@{ usage ->
      if (usage.totalTimeInForeground <= 0L || excludedUsagePackage(usage.packageName))
        return@usageLoop
      val bucketStart = usage.firstTimeStamp.takeIf { it > 0L } ?: from
      val bucketEnd = usage.lastTimeStamp.takeIf { it > bucketStart } ?: to
      val bucketDuration = maxOf(1L, bucketEnd - bucketStart)
      windows.forEach windowLoop@{ window ->
        val overlapStart = maxOf(window.first, bucketStart)
        val overlapEnd = minOf(window.second, bucketEnd)
        val overlap = overlapEnd - overlapStart
        if (overlap <= 0L) return@windowLoop
        val clipped = (
          usage.totalTimeInForeground.toDouble() * overlap.toDouble() /
            bucketDuration.toDouble()
        ).roundToLong().coerceAtMost(overlap)
        if (clipped <= 0L) return@windowLoop
        val rows = rowsByDay.getOrPut(localDateKey(window.first)) { mutableMapOf() }
        val row = rows.getOrPut(usage.packageName) { ForegroundUsage() }
        row.foregroundMs += clipped
        row.lastTimeUsed = maxOf(
          row.lastTimeUsed,
          usage.lastTimeUsed.coerceIn(window.first, window.second),
        )
      }
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

