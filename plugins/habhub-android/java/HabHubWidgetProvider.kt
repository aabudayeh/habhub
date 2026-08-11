package __ANDROID_PACKAGE__

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject

data class HabHubWidgetConfiguration(
  val widgetId: Int,
  val trackerId: String,
  val range: String,
)

object HabHubWidgetStore {
  private const val PREFS = "habhub_widgets"
  private const val SNAPSHOT = "snapshot"
  private const val TRACKER_PREFIX = "tracker_"
  private const val RANGE_PREFIX = "range_"

  private fun preferences(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun saveSnapshot(context: Context, snapshot: String) {
    // Validate before replacing the last known-good widget payload.
    val incoming = JSONObject(snapshot)
    val previous = snapshot(context)
    val mergedTrackers = linkedMapOf<String, JSONObject>()
    previous.optJSONArray("trackers")?.let { trackers ->
      for (index in 0 until trackers.length()) {
        trackers.optJSONObject(index)?.let { tracker ->
          mergedTrackers[tracker.optString("id")] = tracker
        }
      }
    }
    incoming.optJSONArray("trackers")?.let { trackers ->
      for (index in 0 until trackers.length()) {
        trackers.optJSONObject(index)?.let { tracker ->
          mergedTrackers[tracker.optString("id")] = tracker
        }
      }
    }
    incoming.put("trackers", JSONArray(mergedTrackers.values))
    preferences(context).edit().putString(SNAPSHOT, incoming.toString()).apply()
  }

  fun snapshot(context: Context): JSONObject = try {
    JSONObject(preferences(context).getString(SNAPSHOT, null) ?: "{}")
  } catch (_: Exception) {
    JSONObject()
  }

  fun saveConfiguration(
    context: Context,
    widgetId: Int,
    trackerId: String,
    range: String,
  ) {
    preferences(context).edit()
      .putString("$TRACKER_PREFIX$widgetId", trackerId.ifBlank { "__featured__" })
      .putString("$RANGE_PREFIX$widgetId", normalizedRange(range))
      .apply()
  }

  fun configuration(context: Context, widgetId: Int) = HabHubWidgetConfiguration(
    widgetId,
    preferences(context).getString("$TRACKER_PREFIX$widgetId", "__featured__")
      ?: "__featured__",
    normalizedRange(
      preferences(context).getString("$RANGE_PREFIX$widgetId", "week") ?: "week",
    ),
  )

  fun configurations(context: Context): List<HabHubWidgetConfiguration> =
    preferences(context).all.keys
      .asSequence()
      .filter { it.startsWith(TRACKER_PREFIX) }
      .mapNotNull { it.removePrefix(TRACKER_PREFIX).toIntOrNull() }
      .map { configuration(context, it) }
      .toList()

  fun delete(context: Context, widgetIds: IntArray) {
    preferences(context).edit().apply {
      widgetIds.forEach { widgetId ->
        remove("$TRACKER_PREFIX$widgetId")
        remove("$RANGE_PREFIX$widgetId")
      }
    }.apply()
  }

  private fun normalizedRange(range: String) =
    if (range in setOf("week", "month", "year")) range else "week"
}

abstract class HabHubWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    appWidgetIds.forEach { HabHubWidgetRenderer.updateWidget(context, it) }
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: Bundle,
  ) {
    HabHubWidgetRenderer.updateWidget(context, appWidgetId)
  }

  override fun onDeleted(context: Context, appWidgetIds: IntArray) {
    HabHubWidgetStore.delete(context, appWidgetIds)
  }
}

class HabHubSmallWidgetProvider : HabHubWidgetProvider()
class HabHubSquareWidgetProvider : HabHubWidgetProvider()
class HabHubWideWidgetProvider : HabHubWidgetProvider()

object HabHubWidgetRenderer {
  private const val GOAL_LIME = "#B8E45C"
  private val providers = arrayOf(
    HabHubSmallWidgetProvider::class.java,
    HabHubSquareWidgetProvider::class.java,
    HabHubWideWidgetProvider::class.java,
  )
  private val goalIds = intArrayOf(
    R.id.widget_goal_1,
    R.id.widget_goal_2,
    R.id.widget_goal_3,
  )

  fun updateAll(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    providers.forEach { provider ->
      manager.getAppWidgetIds(ComponentName(context, provider)).forEach { widgetId ->
        updateWidget(context, widgetId)
      }
    }
  }

  fun updateWidget(context: Context, widgetId: Int) {
    if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return
    val manager = AppWidgetManager.getInstance(context)
    val configuration = HabHubWidgetStore.configuration(context, widgetId)
    val snapshot = HabHubWidgetStore.snapshot(context)
    val featured = snapshot.optJSONObject("featured")
    val selected = findTracker(snapshot.optJSONArray("trackers"), configuration.trackerId)
      ?: featured
    val views = RemoteViews(context.packageName, R.layout.habhub_widget)
    if (selected == null) {
      renderEmpty(context, views, widgetId)
    } else {
      renderSnapshot(context, views, widgetId, selected)
    }
    applyWidgetDimensions(
      manager,
      widgetId,
      views,
      selected?.optJSONArray("goals")?.length()?.let { it > 0 } == true,
    )
    manager.updateAppWidget(widgetId, views)
  }

  private fun applyWidgetDimensions(
    manager: AppWidgetManager,
    widgetId: Int,
    views: RemoteViews,
    hasGoalDetails: Boolean,
  ) {
    val options = manager.getAppWidgetOptions(widgetId)
    val minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 105)
    val minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250)
    val oneRow = minHeight < 90
    if (oneRow) {
      views.setViewVisibility(R.id.widget_goal_details, View.GONE)
    }
    // Even the 2x1 card keeps an at-a-glance progress line.
    views.setViewVisibility(R.id.widget_progress_container, View.VISIBLE)
    views.setViewVisibility(R.id.widget_subtitle, if (oneRow) View.GONE else View.VISIBLE)
    views.setViewVisibility(R.id.widget_completion_badge, if (oneRow) View.GONE else View.VISIBLE)
    views.setViewVisibility(R.id.widget_range, View.GONE)
    if (!oneRow && hasGoalDetails) {
      if (minWidth < 150) {
        views.setViewVisibility(R.id.widget_goal_2, View.GONE)
        views.setViewVisibility(R.id.widget_goal_3, View.GONE)
      } else if (minWidth < 220) {
        views.setViewVisibility(R.id.widget_goal_3, View.GONE)
      }
    }
    views.setTextViewTextSize(
      R.id.widget_title,
      TypedValue.COMPLEX_UNIT_SP,
      if (oneRow || minWidth < 150) 8f else 9f,
    )
    views.setTextViewTextSize(
      R.id.widget_value,
      TypedValue.COMPLEX_UNIT_SP,
      if (oneRow || minWidth < 150) 17f else 21f,
    )
    views.setTextViewTextSize(
      R.id.widget_badge_value,
      TypedValue.COMPLEX_UNIT_SP,
      if (oneRow || minWidth < 150) 10f else 11f,
    )
  }

  private fun findTracker(trackers: JSONArray?, trackerId: String): JSONObject? {
    if (trackerId == "__featured__" || trackers == null) return null
    for (index in 0 until trackers.length()) {
      val candidate = trackers.optJSONObject(index) ?: continue
      if (candidate.optString("id") == trackerId) return candidate
    }
    return null
  }

  private fun renderEmpty(context: Context, views: RemoteViews, widgetId: Int) {
    views.setTextViewText(R.id.widget_title, "HabHub")
    views.setTextViewText(R.id.widget_value, "\u2014")
    views.setTextViewText(
      R.id.widget_subtitle,
      context.getString(R.string.habhub_widget_open_to_update),
    )
    views.setTextViewText(R.id.widget_range, "")
    views.setTextViewText(R.id.widget_badge_value, "\u2014")
    views.setProgressBar(R.id.widget_progress, 100, 0, false)
    views.setProgressBar(R.id.widget_progress_gold, 100, 0, false)
    views.setViewVisibility(R.id.widget_progress, View.VISIBLE)
    views.setViewVisibility(R.id.widget_progress_gold, View.GONE)
    views.setInt(
      R.id.widget_root,
      "setBackgroundResource",
      R.drawable.habhub_widget_background,
    )
    views.setInt(
      R.id.widget_completion_badge,
      "setBackgroundResource",
      R.drawable.habhub_widget_badge,
    )
    views.setTextColor(R.id.widget_title, parseColor(GOAL_LIME, Color.rgb(184, 228, 92)))
    clearGoalDetails(views)
    views.setOnClickPendingIntent(
      R.id.widget_root,
      deepLinkIntent(context, widgetId, "paceboard://"),
    )
  }

  private fun renderSnapshot(
    context: Context,
    views: RemoteViews,
    widgetId: Int,
    item: JSONObject,
  ) {
    val featured = item.optString("id") == "__featured__"
    val allComplete = featured && item.optBoolean("allComplete", false)
    views.setTextViewText(
      R.id.widget_title,
      item.optString("eyebrow").ifBlank { item.optString("title", "HabHub") },
    )
    views.setTextViewText(R.id.widget_value, item.optString("value", "\u2014"))
    views.setTextViewText(R.id.widget_subtitle, item.optString("subtitle", ""))
    val progress = (item.optDouble("progress", 0.0).coerceIn(0.0, 1.0) * 100).toInt()
    views.setTextViewText(
      R.id.widget_range,
      "$progress%",
    )
    views.setTextViewText(R.id.widget_badge_value, "$progress%")
    views.setProgressBar(R.id.widget_progress, 100, progress, false)
    views.setProgressBar(R.id.widget_progress_gold, 100, progress, false)
    views.setViewVisibility(R.id.widget_progress, if (allComplete) View.GONE else View.VISIBLE)
    views.setViewVisibility(R.id.widget_progress_gold, if (allComplete) View.VISIBLE else View.GONE)
    views.setInt(
      R.id.widget_root,
      "setBackgroundResource",
      if (allComplete) {
        R.drawable.habhub_widget_background_complete
      } else {
        R.drawable.habhub_widget_background
      },
    )
    views.setInt(
      R.id.widget_completion_badge,
      "setBackgroundResource",
      if (allComplete) R.drawable.habhub_widget_badge_complete else R.drawable.habhub_widget_badge,
    )
    views.setTextColor(
      R.id.widget_title,
      if (allComplete) Color.rgb(255, 225, 138) else parseColor(GOAL_LIME, Color.rgb(184, 228, 92)),
    )
    val goals = item.optJSONArray("goals") ?: JSONArray()
    if (goals.length() > 0) {
      renderGoalDetails(views, goals)
    } else {
      clearGoalDetails(views)
    }
    views.setOnClickPendingIntent(
      R.id.widget_root,
      deepLinkIntent(
        context,
        widgetId,
        item.optString("deepLink", "paceboard://"),
      ),
    )
  }

  private fun renderGoalDetails(views: RemoteViews, goals: JSONArray) {
    views.setViewVisibility(R.id.widget_goal_details, View.VISIBLE)
    goalIds.forEachIndexed { index, viewId ->
      val goal = goals.optJSONObject(index)
      if (goal == null) {
        views.setViewVisibility(viewId, View.GONE)
      } else {
        val percent = (goal.optDouble("progress", 0.0).coerceIn(0.0, 1.0) * 100).toInt()
        val completed = goal.optBoolean("met", false)
        views.setTextViewText(
          viewId,
          "${if (completed) "\u2713 " else ""}${goal.optString("value")}  \u00B7  $percent%\n${goal.optString("title")}",
        )
        views.setInt(
          viewId,
          "setBackgroundResource",
          if (completed) R.drawable.habhub_widget_goal_complete else R.drawable.habhub_widget_goal,
        )
        views.setTextColor(
          viewId,
          if (completed) parseColor(GOAL_LIME, Color.rgb(184, 228, 92)) else Color.WHITE,
        )
        views.setViewVisibility(viewId, View.VISIBLE)
      }
    }
  }

  private fun clearGoalDetails(views: RemoteViews) {
    views.setViewVisibility(R.id.widget_goal_details, View.GONE)
    goalIds.forEach { viewId ->
      views.setTextViewText(viewId, "")
      views.setViewVisibility(viewId, View.GONE)
    }
  }

  private fun deepLinkIntent(
    context: Context,
    widgetId: Int,
    deepLink: String,
  ): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(deepLink), context, MainActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
    }
    return PendingIntent.getActivity(
      context,
      widgetId,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun parseColor(value: String, fallback: Int) = try {
    Color.parseColor(value)
  } catch (_: Exception) {
    fallback
  }

}
