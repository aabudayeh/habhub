package __ANDROID_PACKAGE__

import android.app.AppOpsManager
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
  override fun getName() = "HabHubAndroid"

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
        val rows = manager.queryAndAggregateUsageStats(safeFrom, safeTo)
          .values
          .asSequence()
          .filter { it.totalTimeInForeground > 0L }
          .sortedByDescending { it.totalTimeInForeground }
          .take(limit.toInt().coerceIn(1, 500))
          .toList()
        val apps = Arguments.createArray()
        var total = 0L
        rows.forEach { usage ->
          val info = try {
            packageManager.getApplicationInfo(usage.packageName, 0)
          } catch (_: Exception) {
            null
          }
          val foreground = usage.totalTimeInForeground.coerceAtLeast(0L)
          total += foreground
          apps.pushMap(
            Arguments.createMap().apply {
              putString("packageName", usage.packageName)
              putString(
                "appName",
                info?.let { packageManager.getApplicationLabel(it).toString() }
                  ?: usage.packageName,
              )
              putDouble("foregroundMs", foreground.toDouble())
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
            putArray("apps", apps)
          },
        )
      } catch (error: Exception) {
        promise.reject("usage_query_failed", error)
      }
    }
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

