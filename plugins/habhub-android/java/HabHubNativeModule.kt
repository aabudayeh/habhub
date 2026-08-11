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
import android.os.Process
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import kotlin.concurrent.thread

class HabHubNativeModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private data class ForegroundUsage(
    var foregroundMs: Long = 0L,
    var lastTimeUsed: Long = 0L,
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
        val eventRows = usageFromForegroundEvents(manager, safeFrom, safeTo)
        val aggregateRows = if (eventRows.isEmpty()) {
          manager.queryAndAggregateUsageStats(safeFrom, safeTo)
            .values
            .asSequence()
            .filter { it.totalTimeInForeground > 0L }
            .associate {
              it.packageName to ForegroundUsage(
                foregroundMs = it.totalTimeInForeground.coerceAtLeast(0L),
                lastTimeUsed = it.lastTimeUsed,
              )
            }
        } else {
          eventRows
        }
        val rows = aggregateRows
          .asSequence()
          .filter { (packageName, usage) ->
            usage.foregroundMs > 0L && !excludedUsagePackage(packageName)
          }
          .sortedByDescending { (_, usage) -> usage.foregroundMs }
          .toList()
        val apps = Arguments.createArray()
        val total = rows.sumOf { (_, usage) -> usage.foregroundMs }
        rows.take(limit.toInt().coerceIn(1, 500)).forEach { (packageName, usage) ->
          val info = try {
            packageManager.getApplicationInfo(packageName, 0)
          } catch (_: Exception) {
            null
          }
          apps.pushMap(
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
              if (eventRows.isEmpty()) "aggregate_fallback" else "foreground_events",
            )
            putArray("apps", apps)
          },
        )
      } catch (error: Exception) {
        promise.reject("usage_query_failed", error)
      }
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
  ): Map<String, ForegroundUsage> {
    val dayMs = 24L * 60L * 60L * 1000L
    val lookback = (from - dayMs).coerceAtLeast(0L)
    val events = manager.queryEvents(lookback, to) ?: return emptyMap()
    val rows = mutableMapOf<String, ForegroundUsage>()
    val event = UsageEvents.Event()
    var currentPackage: String? = null
    var screenInteractive = Build.VERSION.SDK_INT < Build.VERSION_CODES.P
    var keyguardHidden = true
    var sawScreenState = false
    var cursor = lookback

    fun accrue(until: Long) {
      val start = maxOf(cursor, from)
      val end = minOf(until, to)
      val packageName = currentPackage
      if (
        packageName != null &&
        screenInteractive &&
        keyguardHidden &&
        end > start
      ) {
        val usage = rows.getOrPut(packageName) { ForegroundUsage() }
        usage.foregroundMs += end - start
        usage.lastTimeUsed = maxOf(usage.lastTimeUsed, end)
      }
    }

    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      val timestamp = event.timeStamp.coerceIn(lookback, to)
      if (timestamp < cursor) continue
      accrue(timestamp)
      when (event.eventType) {
        UsageEvents.Event.SCREEN_INTERACTIVE -> {
          screenInteractive = true
          sawScreenState = true
        }
        UsageEvents.Event.SCREEN_NON_INTERACTIVE,
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
        UsageEvents.Event.ACTIVITY_PAUSED,
        UsageEvents.Event.ACTIVITY_STOPPED -> {
          if (currentPackage == event.packageName) currentPackage = null
        }
      }
      cursor = timestamp
    }
    accrue(to)
    return rows
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

