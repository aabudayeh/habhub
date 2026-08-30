package __ANDROID_PACKAGE__

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PathMeasure
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.text.Layout
import android.text.StaticLayout
import android.text.TextDirectionHeuristics
import android.text.TextPaint
import android.text.TextUtils
import android.util.LruCache
import android.widget.RemoteViews
import java.util.Locale
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import org.json.JSONArray
import org.json.JSONObject

data class HabHubWidgetConfiguration(
  val widgetId: Int,
  val trackerId: String,
  val range: String,
  val backgroundMode: String = "transparent",
  val backgroundColor: String = "#081B49",
  val backgroundOpacity: Int = 55,
  val leaderboardMetricIds: List<String> = emptyList(),
  val leaderboardFontScale: Float = 1f,
)

object HabHubWidgetStore {
  const val LEADERBOARD_FONT_PERCENT_MIN = 60
  const val LEADERBOARD_FONT_PERCENT_MAX = 130
  const val LEADERBOARD_FONT_PERCENT_DEFAULT = 100
  private const val PREFS = "habhub_widgets"
  private const val SNAPSHOT = "snapshot"
  private const val TRACKER_PREFIX = "tracker_"
  private const val RANGE_PREFIX = "range_"
  private const val BACKGROUND_MODE_PREFIX = "background_mode_"
  private const val BACKGROUND_COLOR_PREFIX = "background_color_"
  private const val BACKGROUND_OPACITY_PREFIX = "background_opacity_"
  private const val LEADERBOARD_METRICS_PREFIX = "leaderboard_metrics_"
  private const val LEADERBOARD_FONT_PERCENT_PREFIX = "leaderboard_font_percent_"

  private fun preferences(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun saveSnapshot(context: Context, snapshot: String) {
    // Validate before replacing the last known-good widget payload. Never
    // merge an older payload: it may belong to a previous account or retain
    // legacy tracker rows that current Featured/Status widgets do not use.
    val incoming = JSONObject(snapshot)
    incoming.put("trackers", incoming.optJSONArray("trackers") ?: JSONArray())
    pruneLeaderboardPayload(context, incoming)
    preferences(context).edit().putString(SNAPSHOT, incoming.toString()).apply()
  }

  fun snapshot(context: Context): JSONObject = try {
    JSONObject(preferences(context).getString(SNAPSHOT, null) ?: "{}")
  } catch (_: Exception) {
    JSONObject()
  }

  fun clearSnapshot(context: Context) {
    preferences(context).edit().remove(SNAPSHOT).apply()
  }

  fun saveConfiguration(
    context: Context,
    widgetId: Int,
    trackerId: String,
    range: String,
    backgroundMode: String = "transparent",
    backgroundColor: String = "#081B49",
    backgroundOpacity: Int = 55,
    leaderboardMetricIds: List<String>? = null,
    leaderboardFontScale: Float? = null,
  ) {
    preferences(context).edit().apply {
      putString(
        "$TRACKER_PREFIX$widgetId",
        fixedTracker(context, widgetId) ?: normalizedTracker(trackerId),
      )
      putString("$RANGE_PREFIX$widgetId", normalizedRange(range))
      putString("$BACKGROUND_MODE_PREFIX$widgetId", normalizedBackgroundMode(backgroundMode))
      putString("$BACKGROUND_COLOR_PREFIX$widgetId", normalizedColor(backgroundColor))
      putInt("$BACKGROUND_OPACITY_PREFIX$widgetId", backgroundOpacity.coerceIn(0, 100))
      if (leaderboardMetricIds != null) {
        putString(
          "$LEADERBOARD_METRICS_PREFIX$widgetId",
          leaderboardMetricIds.map(String::trim).filter(String::isNotBlank).distinct().take(4).joinToString(","),
        )
      }
      if (leaderboardFontScale != null) {
        putInt(
          "$LEADERBOARD_FONT_PERCENT_PREFIX$widgetId",
          (leaderboardFontScale * 100f).roundToInt().coerceIn(
            LEADERBOARD_FONT_PERCENT_MIN,
            LEADERBOARD_FONT_PERCENT_MAX,
          ),
        )
      }
    }.apply()
    // Configuration can change without opening React Native. Immediately
    // remove exact leaderboard values no longer used by an active widget.
    pruneStoredLeaderboardPayload(context)
  }

  fun configuration(context: Context, widgetId: Int): HabHubWidgetConfiguration {
    val prefs = preferences(context)
    val defaultTracker = defaultTracker(context, widgetId)
    val storedTracker = prefs.getString("$TRACKER_PREFIX$widgetId", defaultTracker) ?: defaultTracker
    return HabHubWidgetConfiguration(
      widgetId,
      fixedTracker(context, widgetId) ?: normalizedTracker(storedTracker),
      normalizedRange(prefs.getString("$RANGE_PREFIX$widgetId", "week") ?: "week"),
      normalizedBackgroundMode(prefs.getString("$BACKGROUND_MODE_PREFIX$widgetId", "transparent") ?: "transparent"),
      normalizedColor(prefs.getString("$BACKGROUND_COLOR_PREFIX$widgetId", DEFAULT_BACKGROUND) ?: DEFAULT_BACKGROUND),
      prefs.getInt("$BACKGROUND_OPACITY_PREFIX$widgetId", 55).coerceIn(0, 100),
      prefs.getString("$LEADERBOARD_METRICS_PREFIX$widgetId", "").orEmpty()
        .split(",").map(String::trim).filter(String::isNotBlank).distinct().take(4),
      prefs.getInt(
        "$LEADERBOARD_FONT_PERCENT_PREFIX$widgetId",
        LEADERBOARD_FONT_PERCENT_DEFAULT,
      ).coerceIn(
        LEADERBOARD_FONT_PERCENT_MIN,
        LEADERBOARD_FONT_PERCENT_MAX,
      ) / 100f,
    )
  }

  fun configurations(context: Context): List<HabHubWidgetConfiguration> =
    activeWidgetIds(context).map { configuration(context, it) }

  fun hasConfiguration(context: Context, widgetId: Int) =
    preferences(context).contains("$TRACKER_PREFIX$widgetId")

  fun delete(context: Context, widgetIds: IntArray) {
    preferences(context).edit().apply {
      widgetIds.forEach { widgetId ->
        remove("$TRACKER_PREFIX$widgetId")
        remove("$RANGE_PREFIX$widgetId")
        remove("$BACKGROUND_MODE_PREFIX$widgetId")
        remove("$BACKGROUND_COLOR_PREFIX$widgetId")
        remove("$BACKGROUND_OPACITY_PREFIX$widgetId")
        remove("$LEADERBOARD_METRICS_PREFIX$widgetId")
        remove("$LEADERBOARD_FONT_PERCENT_PREFIX$widgetId")
        // Clean the retired count preference. The selected tracker list is
        // now the single source of truth for Leaderboard widget content.
        remove("leaderboard_count_$widgetId")
      }
    }.apply()
    pruneStoredLeaderboardPayload(context)
    // Some launchers still report deleted IDs while onDeleted is running, so
    // explicitly subtract this callback's IDs before deciding whether the
    // last durable health snapshot can be discarded.
    val deleted = widgetIds.toSet()
    if (activeWidgetIds(context).none { it !in deleted }) clearSnapshot(context)
  }

  private fun activeWidgetIds(context: Context): List<Int> {
    val manager = AppWidgetManager.getInstance(context)
    return listOf(
      HabHubSmallWidgetProvider::class.java,
      HabHubSquareWidgetProvider::class.java,
      HabHubWideCompactWidgetProvider::class.java,
      HabHubWideWidgetProvider::class.java,
      HabHubLeaderboardWidgetProvider::class.java,
    ).flatMap { provider ->
      manager.getAppWidgetIds(ComponentName(context, provider)).asList()
    }.distinct()
  }

  private fun pruneStoredLeaderboardPayload(context: Context) {
    val prefs = preferences(context)
    val stored = prefs.getString(SNAPSHOT, null) ?: return
    val snapshot = try {
      JSONObject(stored)
    } catch (_: Exception) {
      return
    }
    pruneLeaderboardPayload(context, snapshot)
    prefs.edit().putString(SNAPSHOT, snapshot.toString()).apply()
  }

  private fun pruneLeaderboardPayload(context: Context, snapshot: JSONObject) {
    val leaderboard = snapshot.optJSONObject("leaderboard") ?: return
    val active = configurations(context).filter { it.trackerId == "__leaderboard__" }
    if (active.isEmpty()) {
      snapshot.remove("leaderboard")
      return
    }
    val metrics = leaderboard.optJSONArray("metrics") ?: JSONArray()
    val allowedIds = active.flatMap { it.leaderboardMetricIds }.toMutableSet()
    // Backward-compatible empty configurations render the first N payload
    // metrics. Retain only that actually visible fallback instead of the whole
    // union while the user has not re-saved the widget yet.
    active.filter { it.leaderboardMetricIds.isEmpty() }.forEach {
      for (index in 0 until min(2, metrics.length())) {
        metrics.optJSONObject(index)?.optString("id")
          ?.takeIf(String::isNotBlank)?.let(allowedIds::add)
      }
    }
    val filtered = JSONArray()
    for (index in 0 until metrics.length()) {
      val metric = metrics.optJSONObject(index) ?: continue
      if (metric.optString("id") in allowedIds) filtered.put(metric)
    }
    leaderboard.put("metrics", filtered)
  }

  private fun normalizedRange(range: String) =
    if (range in setOf("week", "month", "year")) range else "week"

  private fun normalizedTracker(trackerId: String) = when (trackerId) {
    "__avatar__", "__leaderboard__" -> trackerId
    else -> "__featured__"
  }

  /** Matches each optional-config widget's advertised/default content. */
  private fun defaultTracker(context: Context, widgetId: Int): String {
    val manager = AppWidgetManager.getInstance(context)
    return when {
      widgetId in manager.getAppWidgetIds(
        ComponentName(context, HabHubLeaderboardWidgetProvider::class.java),
      ) -> "__leaderboard__"
      widgetId in manager.getAppWidgetIds(
        ComponentName(context, HabHubSquareWidgetProvider::class.java),
      ) -> "__avatar__"
      widgetId in manager.getAppWidgetIds(
        ComponentName(context, HabHubWideWidgetProvider::class.java),
      ) -> "__avatar__"
      else -> "__featured__"
    }
  }

  /** Fixed-size families redirect stale configurations to their intended UI. */
  private fun fixedTracker(context: Context, widgetId: Int): String? {
    val manager = AppWidgetManager.getInstance(context)
    return when {
      widgetId in manager.getAppWidgetIds(
        ComponentName(context, HabHubLeaderboardWidgetProvider::class.java),
      ) -> "__leaderboard__"
      widgetId in manager.getAppWidgetIds(
        ComponentName(context, HabHubSmallWidgetProvider::class.java),
      ) -> "__featured__"
      widgetId in manager.getAppWidgetIds(
        ComponentName(context, HabHubWideCompactWidgetProvider::class.java),
      ) -> "__featured__"
      widgetId in manager.getAppWidgetIds(
        ComponentName(context, HabHubSquareWidgetProvider::class.java),
      ) -> "__avatar__"
      widgetId in manager.getAppWidgetIds(
        ComponentName(context, HabHubWideWidgetProvider::class.java),
      ) -> "__avatar__"
      else -> null
    }
  }

  private fun normalizedBackgroundMode(mode: String) =
    if (mode in setOf("theme", "transparent", "custom")) mode else "transparent"

  private fun normalizedColor(value: String) = try {
    Color.parseColor(value)
    value
  } catch (_: Exception) {
    DEFAULT_BACKGROUND
  }

  private const val DEFAULT_BACKGROUND = "#081B49"
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
class HabHubWideCompactWidgetProvider : HabHubWidgetProvider()
class HabHubWideWidgetProvider : HabHubWidgetProvider()
class HabHubLeaderboardWidgetProvider : HabHubWidgetProvider()

private data class HabHubWidgetSize(
  val heightDp: Float,
  val widthDp: Float,
) {
  val compact = heightDp < 90f
  val wide = widthDp >= 220f
  val roomy = widthDp >= 165f
  val tall = heightDp >= 150f
}

object HabHubWidgetRenderer {
  private const val DEFAULT_NAVY = "#081B49"
  private const val GOAL_GOLD = "#D7A62A"
  private const val GOAL_LIME = "#B8E45C"
  private const val MAX_RENDER_PIXELS = 190_000f
  private const val MIN_LEADERBOARD_ROW_TEXT_SIZE = 6.2f
  private const val MIN_SCALED_LEADERBOARD_TEXT_SIZE = 4.6f
  private val providers = arrayOf(
    HabHubSmallWidgetProvider::class.java,
    HabHubSquareWidgetProvider::class.java,
    HabHubWideCompactWidgetProvider::class.java,
    HabHubWideWidgetProvider::class.java,
    HabHubLeaderboardWidgetProvider::class.java,
  )
  private val avatarCache = object : LruCache<String, Bitmap>(2 * 1024 * 1024) {
    override fun sizeOf(key: String, value: Bitmap) = value.byteCount
  }

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
    val selected = when (configuration.trackerId) {
      "__avatar__" -> snapshot.optJSONObject("avatar")
      "__leaderboard__" -> snapshot.optJSONObject("leaderboard")
      else -> snapshot.optJSONObject("featured")
        ?: findTracker(snapshot.optJSONArray("trackers"), "__featured__")
        ?: snapshot.optJSONArray("trackers")?.optJSONObject(0)
    }
    val item = selected ?: emptySnapshot(context, configuration.trackerId)
    val size = widgetSize(context, manager, widgetId)
    val views = RemoteViews(context.packageName, R.layout.habhub_widget)
    views.setImageViewBitmap(
      R.id.widget_card_image,
      renderCard(context, item, size, configuration),
    )
    views.setCharSequence(
      R.id.widget_root,
      "setContentDescription",
      contentDescription(context, item, configuration, size),
    )
    views.setOnClickPendingIntent(
      R.id.widget_root,
      deepLinkIntent(
        context,
        widgetId,
        item.optString(
          "deepLink",
          when (configuration.trackerId) {
            "__avatar__" -> "paceboard://status"
            "__leaderboard__" -> "paceboard://group"
            else -> "paceboard://"
          },
        ),
      ),
    )
    manager.updateAppWidget(widgetId, views)
  }

  private fun widgetSize(
    context: Context,
    manager: AppWidgetManager,
    widgetId: Int,
  ): HabHubWidgetSize {
    val options = manager.getAppWidgetOptions(widgetId)
    val wideWidgetIds = manager.getAppWidgetIds(
      ComponentName(context, HabHubWideWidgetProvider::class.java),
    )
    val wideCompactWidgetIds = manager.getAppWidgetIds(
      ComponentName(context, HabHubWideCompactWidgetProvider::class.java),
    )
    val smallWidgetIds = manager.getAppWidgetIds(
      ComponentName(context, HabHubSmallWidgetProvider::class.java),
    )
    val leaderboardWidgetIds = manager.getAppWidgetIds(
      ComponentName(context, HabHubLeaderboardWidgetProvider::class.java),
    )
    val fallbackWidth = when {
      widgetId in leaderboardWidgetIds -> 203
      widgetId in wideWidgetIds -> 203
      widgetId in wideCompactWidgetIds -> 250
      else -> 110
    }
    val fallbackHeight = if (widgetId in smallWidgetIds || widgetId in wideCompactWidgetIds) 50 else 105
    fun option(key: String, fallback: Int) = options.getInt(key, fallback)
      .takeIf { it > 0 } ?: fallback
    val minWidth = option(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, fallbackWidth)
    val maxWidth = option(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, minWidth)
    val minHeight = option(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, fallbackHeight)
    val maxHeight = option(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, minHeight)
    // MIN_WIDTH and MIN_HEIGHT can describe different rotations. Render one
    // coherent current-orientation pair instead of a distorted hybrid bitmap;
    // one bitmap also stays safely below RemoteViews/Binder limits.
    val portrait = context.resources.configuration.orientation != Configuration.ORIENTATION_LANDSCAPE
    val width = if (portrait) minWidth else maxWidth
    // Render at the launcher's current-orientation bounds. Forcing the
    // provider's nominal 50dp height made Samsung stretch the bitmap over its
    // taller real cell and distorted the established Featured-card layout.
    // Launchers that honor 50dp still receive the compact seven-goal renderer.
    val height = if (portrait) maxHeight else minHeight
    return HabHubWidgetSize(
      heightDp = height.coerceIn(42, 420).toFloat(),
      widthDp = width.coerceIn(42, 420).toFloat(),
    )
  }

  private fun emptySnapshot(context: Context, requestedId: String) = JSONObject().apply {
    put("id", requestedId)
    put("eyebrow", when (requestedId) {
      "__avatar__" -> context.getString(R.string.habhub_widget_status_avatar)
      "__leaderboard__" -> context.getString(R.string.habhub_widget_leaderboard)
      else -> "HabHub"
    })
    put("title", "HabHub")
    put("value", "\u2014")
    put("subtitle", context.getString(R.string.habhub_widget_open_to_update))
    put("progress", 0)
    put("deepLink", when (requestedId) {
      "__avatar__" -> "paceboard://status"
      "__leaderboard__" -> "paceboard://group"
      else -> "paceboard://"
    })
  }

  private data class LeaderboardGrid(
    val columns: Int,
    val rows: Int,
    val cellWidth: Float,
    val cellHeight: Float,
    val readability: Float,
  )

  private fun bestLeaderboardGrid(
    count: Int,
    width: Float,
    height: Float,
    gap: Float,
  ): LeaderboardGrid {
    var best = LeaderboardGrid(1, count, width, height / max(1, count), 0f)
    for (columns in 1..count) {
      val rows = (count + columns - 1) / columns
      val cellWidth = (width - gap * (columns - 1)) / columns
      val cellHeight = (height - gap * (rows - 1)) / rows
      if (cellWidth <= 0f || cellHeight <= 0f) continue
      // A leaderboard card is naturally wider than it is tall. Maximising the
      // smaller of these two ratios produces one column in narrow/tall widgets,
      // horizontal cards in one-row widgets, and balanced grids at larger sizes.
      val readability = min(cellWidth / 68f, cellHeight / 39f)
      if (readability > best.readability) {
        best = LeaderboardGrid(columns, rows, cellWidth, cellHeight, readability)
      }
    }
    return best
  }

  private fun leaderboardCapacity(size: HabHubWidgetSize): Int {
    val pad = (min(size.widthDp, size.heightDp) * 0.065f).coerceIn(4f, 12f)
    val headerSize = min(size.widthDp / 14f, size.heightDp / 6.5f).coerceIn(6.2f, 15f)
    val gridWidth = max(1f, size.widthDp - pad * 2f)
    val gridHeight = max(1f, size.heightDp - (pad + headerSize + max(3f, headerSize * 0.45f)) - pad)
    val gap = (min(size.widthDp, size.heightDp) * 0.035f).coerceIn(2f, 7f)
    for (count in 4 downTo 2) {
      if (bestLeaderboardGrid(count, gridWidth, gridHeight, gap).readability >= 0.48f)
        return count
    }
    return 1
  }

  private fun configuredLeaderboardMetrics(
    item: JSONObject,
    configuration: HabHubWidgetConfiguration,
    size: HabHubWidgetSize,
  ): List<JSONObject> {
    val allMetrics = item.optJSONArray("metrics") ?: JSONArray()
    val ordered = mutableListOf<JSONObject>()
    fun addMetric(metric: JSONObject) {
      if (ordered.none { it.optString("id") == metric.optString("id") }) ordered += metric
    }
    configuration.leaderboardMetricIds.forEach { id ->
      for (index in 0 until allMetrics.length()) {
        val metric = allMetrics.optJSONObject(index) ?: continue
        if (metric.optString("id") == id) {
          addMetric(metric)
          break
        }
      }
    }
    if (ordered.isEmpty()) {
      for (index in 0 until allMetrics.length())
        allMetrics.optJSONObject(index)?.let(::addMetric)
    }
    return ordered.take(leaderboardCapacity(size))
  }

  private fun contentDescription(
    context: Context,
    item: JSONObject,
    configuration: HabHubWidgetConfiguration,
    size: HabHubWidgetSize,
  ): String {
    val values = mutableListOf<String>()
    if (item.optString("id") == "__avatar__") {
      values += context.getString(R.string.habhub_widget_status_avatar)
      values += "${(item.optDouble("progress", 0.0) * 100.0).roundToInt()}%"
      item.optJSONArray("goals")?.let { goals ->
        for (index in 0 until goals.length()) {
          goals.optJSONObject(index)?.let { goal ->
            values += listOf(goal.optString("title"), goal.optString("value"))
              .filter { it.isNotBlank() }
              .joinToString(" ")
          }
        }
      }
    } else if (item.optString("id") == "__leaderboard__") {
      values += context.getString(R.string.habhub_widget_leaderboard)
      configuredLeaderboardMetrics(item, configuration, size).forEach { metric ->
          values += metric.optString("title")
          metric.optJSONArray("rows")?.let { rows ->
            for (rowIndex in 0 until min(3, rows.length())) {
              val row = rows.optJSONObject(rowIndex) ?: continue
              values += "${row.optString("name")} ${row.optString("value")}".trim()
            }
          }
      }
    } else {
      values += listOf(
        item.optString("eyebrow"),
        item.optString("value"),
        item.optString("subtitle"),
      ).filter { it.isNotBlank() }
    }
    return values.filter { it.isNotBlank() }.joinToString(". ")
  }

  private fun findTracker(trackers: JSONArray?, trackerId: String): JSONObject? {
    if (trackers == null) return null
    for (index in 0 until trackers.length()) {
      val candidate = trackers.optJSONObject(index) ?: continue
      if (candidate.optString("id") == trackerId) return candidate
    }
    return null
  }

  private fun renderCard(
    context: Context,
    item: JSONObject,
    size: HabHubWidgetSize,
    configuration: HabHubWidgetConfiguration,
  ): Bitmap {
    var scale = context.resources.displayMetrics.density.coerceIn(2f, 3f)
    val requestedPixels = size.widthDp * size.heightDp * scale * scale
    if (requestedPixels > MAX_RENDER_PIXELS) {
      scale = sqrt(MAX_RENDER_PIXELS / (size.widthDp * size.heightDp))
    }
    val bitmap = Bitmap.createBitmap(
      max(1, (size.widthDp * scale).roundToInt()),
      max(1, (size.heightDp * scale).roundToInt()),
      Bitmap.Config.ARGB_8888,
    )
    val canvas = Canvas(bitmap)
    canvas.scale(scale, scale)
    val rawProgress = item.optDouble("progress", 0.0).toFloat().coerceIn(0f, 1f)
    // The widget shows an integer percentage. Keep its lime arc, outline and
    // bar empty whenever that visible percentage is 0 instead of drawing the
    // rounded cap of a sub-half-percent value.
    val progress = if (
      item.optString("id") != "__avatar__" &&
      (rawProgress * 100f).roundToInt() == 0
    ) 0f else rawProgress
    val allComplete = item.optBoolean("allComplete", false)
    val accent = parseColor(
      item.optString("progressColor"),
      parseColor(if (allComplete) GOAL_GOLD else GOAL_LIME, Color.rgb(184, 228, 92)),
    )
    drawCardSurface(canvas, size, item, allComplete, configuration)
    if (item.optString("id") != "__leaderboard__" &&
      (item.optString("id") == "__avatar__" || item.optBoolean("showProgressOutline", true))) {
      drawProgressOutline(
        canvas,
        size,
        progress,
        item.optString("fillMode", "clockwise"),
        accent,
      )
    }
    when (item.optString("id")) {
      "__avatar__" -> drawAvatarCard(context, canvas, size, item, progress, accent)
      "__leaderboard__" -> drawLeaderboardCard(context, canvas, size, item, configuration)
      else -> drawFeaturedCard(canvas, size, item, progress, accent)
    }
    return bitmap
  }

  private fun drawCardSurface(
    canvas: Canvas,
    size: HabHubWidgetSize,
    item: JSONObject,
    allComplete: Boolean,
    configuration: HabHubWidgetConfiguration,
  ) {
    val inset = 1.5f
    val rect = RectF(inset, inset, size.widthDp - inset, size.heightDp - inset)
    val radius = if (size.compact) 15f else 19f
    val supplied = when (configuration.backgroundMode) {
      "custom" -> parseColor(configuration.backgroundColor, Color.rgb(8, 27, 73))
      else -> parseColor(item.optString("backgroundColor"), Color.rgb(8, 27, 73))
    }
    val opacity = when (configuration.backgroundMode) {
      "transparent" -> configuration.backgroundOpacity.coerceIn(0, 100)
      "custom" -> configuration.backgroundOpacity.coerceIn(0, 100)
      else -> 100
    }
    val alpha = (255f * opacity / 100f).roundToInt()
    val top = if (allComplete) {
      blendColor(Color.rgb(54, 39, 8), supplied, 0.56f)
    } else {
      blendColor(Color.rgb(13, 40, 86), supplied, 0.24f)
    }
    val bottom = if (allComplete) Color.rgb(35, 25, 5) else Color.rgb(5, 16, 43)
    val surface = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = LinearGradient(
        rect.left,
        rect.top,
        rect.right,
        rect.bottom,
        withAlpha(top, alpha),
        withAlpha(bottom, alpha),
        Shader.TileMode.CLAMP,
      )
    }
    canvas.drawRoundRect(rect, radius, radius, surface)

    val path = Path().apply { addRoundRect(rect, radius, radius, Path.Direction.CW) }
    canvas.save()
    canvas.clipPath(path)
    val glowColor = if (allComplete) Color.rgb(255, 209, 102) else Color.rgb(112, 161, 255)
    val glow = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = RadialGradient(
        size.widthDp * 0.84f,
        -size.heightDp * 0.08f,
        max(size.widthDp, size.heightDp) * 0.76f,
        intArrayOf(withAlpha(glowColor, (72f * opacity / 100f).roundToInt()), withAlpha(glowColor, 0)),
        floatArrayOf(0f, 1f),
        Shader.TileMode.CLAMP,
      )
    }
    canvas.drawRect(rect, glow)
    val sheen = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = LinearGradient(
        0f,
        0f,
        size.widthDp,
        size.heightDp,
        intArrayOf(Color.TRANSPARENT, Color.argb((24f * opacity / 100f).roundToInt(), 255, 255, 255), Color.TRANSPARENT),
        floatArrayOf(0f, 0.44f, 1f),
        Shader.TileMode.CLAMP,
      )
    }
    canvas.drawRect(rect, sheen)
    canvas.restore()
  }

  private fun drawProgressOutline(
    canvas: Canvas,
    size: HabHubWidgetSize,
    progress: Float,
    mode: String,
    accent: Int,
  ) {
    val inset = 2f
    val rect = RectF(inset, inset, size.widthDp - inset, size.heightDp - inset)
    val radius = if (size.compact) 14.5f else 18.5f
    val path = Path().apply { addRoundRect(rect, radius, radius, Path.Direction.CW) }
    canvas.drawPath(path, strokePaint(Color.argb(62, 255, 255, 255), 1f))
    if (progress <= 0f) return
    val active = strokePaint(accent, if (size.compact) 1.7f else 2.15f)
    when (mode) {
      "bottom_up" -> {
        canvas.save()
        canvas.clipRect(0f, size.heightDp * (1f - progress), size.widthDp, size.heightDp)
        canvas.drawPath(path, active)
        canvas.restore()
      }
      "center_out" -> {
        val half = size.widthDp * progress * 0.5f
        canvas.save()
        canvas.clipRect(size.widthDp / 2f - half, 0f, size.widthDp / 2f + half, size.heightDp)
        canvas.drawPath(path, active)
        canvas.restore()
      }
      else -> {
        val measure = PathMeasure(path, false)
        val segment = Path()
        measure.getSegment(0f, measure.length * progress, segment, true)
        canvas.drawPath(segment, active)
      }
    }
  }

  private fun drawLeaderboardCard(
    context: Context,
    canvas: Canvas,
    size: HabHubWidgetSize,
    item: JSONObject,
    configuration: HabHubWidgetConfiguration,
  ) {
    val leaderboardFontScale = configuration.leaderboardFontScale.coerceIn(
      HabHubWidgetStore.LEADERBOARD_FONT_PERCENT_MIN / 100f,
      HabHubWidgetStore.LEADERBOARD_FONT_PERCENT_MAX / 100f,
    )
    val headerTextFloor = (
      MIN_LEADERBOARD_ROW_TEXT_SIZE * leaderboardFontScale
    ).coerceAtLeast(MIN_SCALED_LEADERBOARD_TEXT_SIZE)
    val pad = (min(size.widthDp, size.heightDp) * 0.065f).coerceIn(4f, 12f)
    val headerSize = (
      min(size.widthDp / 14f, size.heightDp / 6.5f) * leaderboardFontScale
    ).coerceIn(headerTextFloor, 17f)
    val headerBaseline = pad + headerSize
    val datePaint = textPaint(
      (headerSize * 0.72f).coerceIn(
        (5f * leaderboardFontScale).coerceAtLeast(4.2f),
        10.5f,
      ),
      Color.argb(210, 222, 230, 242),
      true,
    )
    val dateLabel = item.optString("dateLabel")
    val dateWidth = min(
      size.widthDp * 0.38f,
      max(
        (24f * leaderboardFontScale).coerceAtLeast(18f),
        datePaint.measureText(dateLabel) + 2f,
      ),
    )
    val title = item.optString("title", "Leaderboard")
    val titleWidth = max(12f, size.widthDp - pad * 2f - dateWidth - 4f)
    drawText(
      canvas,
      title,
      pad,
      headerBaseline,
      titleWidth,
      fittedTextPaint(
        title,
        titleWidth,
        headerSize,
        (headerSize * 0.74f).coerceAtLeast(
          (5.2f * leaderboardFontScale).coerceAtLeast(4.2f),
        ),
        Color.WHITE,
        true,
      ),
    )
    drawRightAlignedEllipsizedText(
      canvas,
      dateLabel,
      size.widthDp - pad,
      headerBaseline,
      dateWidth,
      datePaint,
    )
    val metrics = configuredLeaderboardMetrics(item, configuration, size)
    if (metrics.isEmpty()) {
      drawCenteredText(
        canvas,
        context.getString(R.string.habhub_widget_open_to_update),
        size.widthDp / 2f,
        size.heightDp / 2f + 4f,
        textPaint(
          (headerSize * 0.82f).coerceIn(
            (5.2f * leaderboardFontScale).coerceAtLeast(4.2f),
            11f,
          ),
          Color.argb(210, 222, 230, 242),
          true,
        ),
      )
      return
    }
    val gridTop = headerBaseline + max(3f, headerSize * 0.45f)
    val gridBottom = size.heightDp - pad
    val gap = (min(size.widthDp, size.heightDp) * 0.035f).coerceIn(2f, 7f)
    val grid = bestLeaderboardGrid(
      metrics.size,
      size.widthDp - pad * 2f,
      gridBottom - gridTop,
      gap,
    )
    val wideTwoMetricLayout =
      metrics.size == 2 &&
        grid.columns == 2 &&
        grid.rows == 1 &&
        size.widthDp >= 220f &&
        size.heightDp >= 90f &&
        size.widthDp / size.heightDp <= 3f
    val rowTextFloor = (
      MIN_LEADERBOARD_ROW_TEXT_SIZE * leaderboardFontScale
    ).coerceAtLeast(MIN_SCALED_LEADERBOARD_TEXT_SIZE)
    val rowSpacingScale = leaderboardFontScale.coerceIn(0.72f, 1.3f)
    metrics.forEachIndexed { index, metric ->
      val column = index % grid.columns
      val row = index / grid.columns
      val left = pad + column * (grid.cellWidth + gap)
      val top = gridTop + row * (grid.cellHeight + gap)
      val rect = RectF(left, top, left + grid.cellWidth, top + grid.cellHeight)
      val metricRows = metric.optJSONArray("rows") ?: JSONArray()
      val desiredRows = min(metricRows.length(), 5)
      val maximumCellScale = if (wideTwoMetricLayout) 1.45f else 2.6f
      val cellScale = min(grid.cellWidth / 68f, grid.cellHeight / 39f)
        .coerceIn(0.62f, maximumCellScale)
      val denseMemberHeader = desiredRows >= 3 && grid.cellHeight < 32f + desiredRows * 14f
      val headerScale = if (denseMemberHeader) 0.78f else 1f
      val innerPad = (
        4.5f * cellScale * headerScale * leaderboardFontScale
      ).coerceIn(
        (2.4f * leaderboardFontScale).coerceAtLeast(1.8f),
        10f,
      )
      val metricTitleSize = (
        8.2f * cellScale * headerScale * leaderboardFontScale
      ).coerceIn(
        (5.4f * leaderboardFontScale).coerceAtLeast(4.4f),
        18f,
      )
      val baseRowTextSize = (
        6.6f * cellScale * headerScale * leaderboardFontScale
      ).coerceIn(4.5f, 14.5f)
      val iconRadius = (
        4.8f * cellScale * headerScale * leaderboardFontScale
      ).coerceIn(
        (3f * leaderboardFontScale).coerceAtLeast(2.4f),
        12f,
      )
      val cornerRadius = (7f * cellScale).coerceIn(5f, 15f)
      canvas.drawRoundRect(rect, cornerRadius, cornerRadius, fillPaint(Color.argb(34, 255, 255, 255)))
      canvas.drawRoundRect(rect, cornerRadius, cornerRadius, strokePaint(Color.argb(42, 214, 226, 246), max(0.65f, cellScale * 0.55f)))
      val metricColor = parseColor(metric.optString("color"), Color.rgb(184, 228, 92))
      val iconCenterX = left + innerPad + iconRadius
      val iconCenterY = top + innerPad + iconRadius
      val iconRectRadius = iconRadius + max(
        (1.2f * leaderboardFontScale).coerceAtLeast(1f),
        cellScale * leaderboardFontScale,
      )
      canvas.drawRoundRect(
        RectF(
          iconCenterX - iconRectRadius,
          iconCenterY - iconRectRadius,
          iconCenterX + iconRectRadius,
          iconCenterY + iconRectRadius,
        ),
        iconRectRadius * 0.38f,
        iconRectRadius * 0.38f,
        fillPaint(withAlpha(metricColor, 58)),
      )
      drawCompletionIcon(
        canvas,
        iconCenterX,
        iconCenterY,
        iconRadius * 0.68f,
        metric.optString("icon", "trophy-outline"),
        metricColor,
      )
      val metricTitle = metric.optString("title", "Tracker")
      val metricTitleWidth = max(8f, grid.cellWidth - (iconCenterX - left) - iconRadius - innerPad * 1.65f)
      drawText(
        canvas,
        metricTitle,
        iconCenterX + iconRadius + innerPad * 0.65f,
        iconCenterY + metricTitleSize * 0.34f,
        metricTitleWidth,
        fittedTextPaint(
          metricTitle,
          metricTitleWidth,
          metricTitleSize,
          (metricTitleSize * 0.72f).coerceAtLeast(4.8f),
          Color.WHITE,
          true,
        ),
      )
      val titleBandHeight = max(iconRadius * 2f + innerPad * 1.45f, metricTitleSize * 1.65f + innerPad)
      val rowTop = top + titleBandHeight
      val availableHeight = max(0f, rect.bottom - rowTop - innerPad * 0.45f)
      val narrowTallSingleMetricRows =
        metrics.size == 1 &&
          size.widthDp < 150f &&
          size.heightDp >= 150f &&
          grid.cellWidth <= 112f
      val roomyStackRows = grid.cellWidth < 76f || narrowTallSingleMetricRows
      val preferredRowHeight = max(
        (if (roomyStackRows) 14f else 10f) * rowSpacingScale,
        baseRowTextSize * if (roomyStackRows) 3.15f else 2.15f,
      )
      // Keep the airy layout for a couple of members. If it would hide a
      // third, fourth, or fifth member, switch to a denser single-line row and
      // scale only as far as needed to fit the available member list.
      val compactRows = desiredRows > 0 && desiredRows * preferredRowHeight > availableHeight
      val compactRowHeight = max(
        rowTextFloor * 1.35f,
        min(
          10f * rowSpacingScale,
          max(6.4f * rowSpacingScale, baseRowTextSize * 0.9f),
        ),
      )
      val visibleRows = min(
        desiredRows,
        max(1, (availableHeight / if (compactRows) compactRowHeight else preferredRowHeight).toInt()),
      )
      val rowHeight = availableHeight / max(1, visibleRows)
      val stackRows = roomyStackRows && !compactRows
      val rowTextSize = if (compactRows) {
        min(
          max(baseRowTextSize, rowTextFloor),
          rowHeight * 0.66f,
        ).coerceAtLeast(rowTextFloor)
      } else {
        // With only a few members, consume the spare height with larger,
        // easier-to-read names and values instead of leaving dead space.
        min(
          baseRowTextSize * 1.28f,
          rowHeight * if (stackRows) 0.40f else 0.58f,
        ).coerceAtLeast(baseRowTextSize)
      }
      repeat(visibleRows) { rowIndex ->
        val entry = metricRows.optJSONObject(rowIndex) ?: return@repeat
        val centerY = rowTop + rowHeight * rowIndex + rowHeight / 2f
        val rowColor = parseColor(entry.optString("color"), metricColor)
        val rank = "${rowIndex + 1}."
        val rankPaint = textPaint(rowTextSize, rowColor, true)
        val rankWidth = rankPaint.measureText(rank) + innerPad * 0.45f
        val labelLeft = left + innerPad + rankWidth
        val right = rect.right - innerPad
        val name = entry.optString("name").ifBlank { entry.optString("initials").take(2) }
        val value = entry.optString("value", "—")
        val valueColor = if (entry.optBoolean("private", false)) {
          Color.argb(180, 210, 220, 238)
        } else {
          metricColor
        }
        if (stackRows) {
          val firstBaseline = centerY - rowTextSize * 0.18f
          drawText(canvas, rank, left + innerPad, firstBaseline, rankWidth, rankPaint)
          drawText(
            canvas,
            name,
            labelLeft,
            firstBaseline,
            max(5f, right - labelLeft),
            fittedTextPaint(name, max(5f, right - labelLeft), rowTextSize, rowTextFloor, Color.argb(224, 242, 246, 255), false),
          )
          val valueWidth = max(8f, right - (left + innerPad))
          drawRightAlignedEllipsizedText(
            canvas,
            value,
            right,
            centerY + rowTextSize * 1.16f,
            valueWidth,
            fittedTextPaint(value, valueWidth, rowTextSize, rowTextFloor, valueColor, true),
          )
        } else {
          val baseline = centerY + rowTextSize * 0.34f
          drawText(canvas, rank, left + innerPad, baseline, rankWidth, rankPaint)
          val naturalValuePaint = textPaint(rowTextSize, valueColor, true)
          val compactWidthScale = leaderboardFontScale.coerceAtMost(1f)
          val minimumNameWidth = if (wideTwoMetricLayout) {
            min(
              38f + (1f - compactWidthScale) * 10f,
              grid.cellWidth * (0.34f + (1f - compactWidthScale) * 0.10f),
            )
          } else {
            min(
              32f + (1f - compactWidthScale) * 20f,
              grid.cellWidth * (0.30f + (1f - compactWidthScale) * 0.16f),
            )
          }
          val maximumValueWidth = max(10f, right - labelLeft - minimumNameWidth - innerPad * 0.55f)
          val valueWidth = min(
            maximumValueWidth,
            max(
              grid.cellWidth * if (wideTwoMetricLayout) {
                0.18f + compactWidthScale * 0.06f
              } else {
                0.20f + compactWidthScale * 0.14f
              },
              naturalValuePaint.measureText(value) + 1f,
            ),
          )
          val nameWidth = max(5f, right - labelLeft - valueWidth - innerPad * 0.55f)
          drawText(
            canvas,
            name,
            labelLeft,
            baseline,
            nameWidth,
            fittedTextPaint(name, nameWidth, rowTextSize, rowTextFloor, Color.argb(224, 242, 246, 255), false),
          )
          drawRightAlignedEllipsizedText(
            canvas,
            value,
            right,
            baseline,
            valueWidth,
            fittedTextPaint(value, valueWidth, rowTextSize, rowTextFloor, valueColor, true),
          )
        }
      }
    }
  }

  private fun drawFeaturedCard(
    canvas: Canvas,
    size: HabHubWidgetSize,
    item: JSONObject,
    progress: Float,
    accent: Int,
  ) {
    val pad = if (size.compact) 5f else 11f
    val stackedCompact = size.compact && size.heightDp < 48f
    // The launcher's 2 x 1 bounds leave less header width once the date and
    // progress badge are reserved. Keep this adjustment local to that size so
    // larger Featured widgets retain their existing typography.
    // Samsung and other launchers can report the same two-column span anywhere
    // from roughly 109-219dp. Treat every non-wide one-row Featured surface as
    // the compact 2 x 1 layout instead of relying on a fragile 165dp cutoff.
    val twoByOneFeatured = size.compact && !size.wide
    val badgeDiameter = if (stackedCompact) 21f else if (size.compact) 24f else 35f
    val badgeCenterX = size.widthDp - pad - badgeDiameter / 2f
    val badgeCenterY = if (size.compact) min(if (stackedCompact) 17f else 19f, size.heightDp * 0.42f) else 30f
    val contentWidth = max(24f, badgeCenterX - badgeDiameter / 2f - pad - 5f)
    val eyebrow = item.optString("eyebrow").ifBlank { item.optString("title", "HabHub") }
      .uppercase(Locale.getDefault())
    val dateLabel = item.optString("dateLabel")
    val headerBaseline = if (stackedCompact) 7.9f else if (size.compact) 8.7f else 16f
    val datePaint = textPaint(
      if (twoByOneFeatured) 4.15f else if (size.compact) 4.7f else 7.3f,
      Color.argb(225, 222, 230, 242),
      true,
    )
    val dateWidth = if (dateLabel.isBlank()) 0f else min(
      contentWidth * if (twoByOneFeatured) 0.32f else 0.38f,
      max(if (twoByOneFeatured) 14f else if (size.compact) 16f else 24f, datePaint.measureText(dateLabel) + 1f),
    )
    val headerGap = if (dateLabel.isBlank()) {
      0f
    } else if (twoByOneFeatured) {
      0.5f
    } else if (size.compact) {
      2.2f
    } else {
      4f
    }
    val eyebrowLeft = pad + dateWidth + headerGap
    val eyebrowWidth = max(16f, contentWidth - dateWidth - headerGap)
    if (dateLabel.isNotBlank()) {
      drawText(canvas, dateLabel, pad, headerBaseline, dateWidth, datePaint)
    }
    val eyebrowPaint = if (size.compact) {
      fittedTextPaint(
        eyebrow,
        eyebrowWidth,
        if (twoByOneFeatured) 4f else 5.1f,
        if (twoByOneFeatured) 2.8f else 4.1f,
        Color.argb(205, 255, 255, 255),
        true,
        if (twoByOneFeatured) 0f else 0.04f,
      )
    } else {
      textPaint(7.5f, Color.argb(205, 255, 255, 255), true, 0.12f)
    }
    drawText(
      canvas,
      eyebrow,
      eyebrowLeft,
      headerBaseline,
      eyebrowWidth,
      eyebrowPaint,
    )
    drawText(
      canvas,
      item.optString("value", "\u2014"),
      pad,
      if (stackedCompact) 22.9f else if (size.compact) 25.2f else 42f,
      contentWidth,
      textPaint(if (size.compact) 13.2f else 24f, Color.WHITE, true),
    )
    val legacyCompactSubtitle = item.optString("compactSubtitle", item.optString("subtitle"))
    val summarySeparator = " · "
    val todoSummary = item.optString("todoSummary").ifBlank {
      legacyCompactSubtitle.substringAfter(summarySeparator, "")
    }
    val goalSummary = item.optString("goalSummary").ifBlank {
      legacyCompactSubtitle.substringBefore(summarySeparator).ifBlank { item.optString("subtitle") }
    }
    drawFeaturedSummary(
      canvas,
      size,
      pad,
      if (stackedCompact) 28.6f else if (size.compact) 31.5f else 54f,
      goalSummary,
      todoSummary,
    )
    drawProgressBadge(
      canvas,
      badgeCenterX,
      badgeCenterY,
      badgeDiameter,
      progress,
    )

    val barLeft = pad
    val barRight = size.widthDp - pad
    val barHeight = if (stackedCompact) 2.4f else if (size.compact) 3.2f else 5.2f
    val goals = item.optJSONArray("goals") ?: JSONArray()
    val barTop = if (stackedCompact) {
      size.heightDp - 3.7f
    } else if (size.compact) {
      size.heightDp - 5.5f
    } else if (goals.length() > 0) {
      61f
    } else {
      size.heightDp - pad - barHeight
    }
    val track = RectF(barLeft, barTop, barRight, barTop + barHeight)
    canvas.drawRoundRect(track, barHeight, barHeight, fillPaint(Color.argb(52, 255, 255, 255)))
    if (progress > 0f) {
      val fill = RectF(track.left, track.top, track.left + track.width() * progress, track.bottom)
      canvas.drawRoundRect(fill, barHeight, barHeight, fillPaint(accent))
    }

    if (size.compact && goals.length() > 0) {
      drawCompactGoalTiles(
        canvas,
        size,
        goals,
        if (stackedCompact) max(29.5f, barTop - 7.5f) else max(34f, barTop - 10.5f),
        barTop - if (stackedCompact) 0.5f else 1.5f,
        accent,
      )
    } else if (!size.compact) {
      drawGoalTiles(
        canvas,
        size,
        goals,
        barTop + barHeight + 6f,
        size.heightDp - pad,
        accent,
      )
    }
  }

  /** Keeps the two summaries together, with one neutral style and separator. */
  private fun drawFeaturedSummary(
    canvas: Canvas,
    size: HabHubWidgetSize,
    pad: Float,
    baseline: Float,
    goalSummary: String,
    todoSummary: String,
  ) {
    val availableWidth = size.widthDp - pad * 2f
    if (todoSummary.isBlank()) {
      drawText(
        canvas,
        goalSummary,
        pad,
        baseline,
        availableWidth,
        fittedTextPaint(
          goalSummary,
          availableWidth,
          if (size.compact) 5.45f else 8f,
          if (size.compact) 4.1f else 5.4f,
          Color.argb(220, 224, 234, 250),
          true,
        ),
      )
      return
    }
    val combined = "$goalSummary · $todoSummary"
    val sharedPaint = fittedTextPaint(
      combined,
      availableWidth,
      if (size.compact) 5.45f else 8f,
      if (size.compact) 3.8f else 5.2f,
      Color.argb(220, 224, 234, 250),
      true,
    )
    drawText(canvas, combined, pad, baseline, availableWidth, sharedPaint)
  }

  private fun drawCompactGoalTiles(
    canvas: Canvas,
    size: HabHubWidgetSize,
    goals: JSONArray,
    top: Float,
    bottom: Float,
    accent: Int,
  ) {
    val twoByOneFeatured = size.compact && !size.wide
    var count = min(
      goals.length(),
      when {
        size.wide -> 8
        twoByOneFeatured -> 7
        else -> 5
      },
    )
    if (count <= 0 || bottom <= top) return
    val gap = if (twoByOneFeatured) 1.5f else 3f
    val badgeReserve = if (size.wide) 46f else 35f
    // The badge occupies only the top of this card. The bottom goal row can
    // safely use the full width in the 2 x 1 layout; reserving the badge width
    // here was what silently reduced seven goals back to six on real launchers.
    val availableWidth = size.widthDp - 12f - if (twoByOneFeatured) 0f else badgeReserve
    fun resolvedTileSize() = min(
      if (size.wide) 12f else 10.5f,
      min(bottom - top, (availableWidth - gap * (count - 1)) / count),
    )
    var tileSize = resolvedTileSize()
    // A normal 2 x 1 has room for seven compact goal squares. Only reduce the
    // count when a launcher reports genuinely unusable bounds.
    while (twoByOneFeatured && count > 5 && tileSize < 5.2f) {
      count -= 1
      tileSize = resolvedTileSize()
    }
    val minimumTileSize = if (twoByOneFeatured) 5.2f else 6f
    if (tileSize < minimumTileSize) return
    val totalWidth = tileSize * count + gap * (count - 1)
    val startX = if (twoByOneFeatured) max(6f, (size.widthDp - totalWidth) / 2f) else 6f
    repeat(count) { index ->
      val goal = goals.optJSONObject(index) ?: return@repeat
      val left = startX + index * (tileSize + gap)
      val rect = RectF(left, top, left + tileSize, top + tileSize)
      drawFeaturedGoalDot(canvas, rect, goal, accent)
    }
  }

  private fun drawProgressBadge(
    canvas: Canvas,
    centerX: Float,
    centerY: Float,
    diameter: Float,
    progress: Float,
  ) {
    val radius = diameter / 2f
    val strokeWidth = if (diameter <= 25f) 3.1f else 4.2f
    val ringRadius = radius - strokeWidth / 2f - 0.8f
    val arc = RectF(
      centerX - ringRadius,
      centerY - ringRadius,
      centerX + ringRadius,
      centerY + ringRadius,
    )
    // The interior remains neutral at every value, including 100%; completion
    // is represented only by the proportional lime arc and centered percent.
    canvas.drawCircle(centerX, centerY, ringRadius, fillPaint(Color.argb(215, 61, 69, 80)))
    canvas.drawArc(arc, -90f, 360f, false, strokePaint(Color.argb(205, 164, 174, 188), strokeWidth))
    if (progress > 0f) {
      canvas.drawArc(
        arc,
        -90f,
        progress * 360f,
        false,
        strokePaint(Color.rgb(184, 228, 92), strokeWidth),
      )
    }
    val percent = (progress * 100f).roundToInt().coerceIn(0, 100)
    val labelSize = when {
      diameter <= 25f && percent >= 100 -> 6.1f
      diameter <= 25f -> 7.0f
      percent >= 100 -> 8.8f
      else -> 10f
    }
    drawCenteredText(
      canvas,
      "$percent%",
      centerX,
      centerY,
      textPaint(labelSize, Color.WHITE, true),
    )
  }

  private fun drawCompletionIcon(
    canvas: Canvas,
    centerX: Float,
    centerY: Float,
    radius: Float,
    icon: String,
    color: Int,
  ) {
    val stroke = strokePaint(color, max(1.15f, radius * 0.13f))
    when {
      icon.startsWith("checkmark") -> {
        canvas.drawLine(centerX - radius * 0.72f, centerY, centerX - radius * 0.18f, centerY + radius * 0.55f, stroke)
        canvas.drawLine(centerX - radius * 0.18f, centerY + radius * 0.55f, centerX + radius * 0.78f, centerY - radius * 0.55f, stroke)
      }
      icon.startsWith("remove") -> canvas.drawLine(
        centerX - radius * 0.72f,
        centerY,
        centerX + radius * 0.72f,
        centerY,
        stroke,
      )
      icon.startsWith("square") -> canvas.drawRoundRect(
        RectF(centerX - radius, centerY - radius, centerX + radius, centerY + radius),
        radius * 0.18f,
        radius * 0.18f,
        stroke,
      )
      icon.startsWith("flash") -> canvas.drawPath(Path().apply {
        moveTo(centerX + radius * 0.12f, centerY - radius)
        lineTo(centerX - radius * 0.58f, centerY + radius * 0.10f)
        lineTo(centerX - radius * 0.08f, centerY + radius * 0.05f)
        lineTo(centerX - radius * 0.23f, centerY + radius)
        lineTo(centerX + radius * 0.62f, centerY - radius * 0.20f)
        lineTo(centerX + radius * 0.10f, centerY - radius * 0.12f)
        close()
      }, fillPaint(color))
      icon.startsWith("heart") -> canvas.drawPath(Path().apply {
        moveTo(centerX, centerY + radius * 0.82f)
        cubicTo(centerX - radius * 1.18f, centerY + radius * 0.10f, centerX - radius * 0.82f, centerY - radius * 0.88f, centerX, centerY - radius * 0.30f)
        cubicTo(centerX + radius * 0.82f, centerY - radius * 0.88f, centerX + radius * 1.18f, centerY + radius * 0.10f, centerX, centerY + radius * 0.82f)
        close()
      }, stroke)
      icon.startsWith("star") || icon.startsWith("sparkles") -> {
        val path = Path()
        repeat(10) { index ->
          val angle = -PI / 2.0 + index * PI / 5.0
          val pointRadius = if (index % 2 == 0) radius else radius * 0.43f
          val x = centerX + (cos(angle) * pointRadius).toFloat()
          val y = centerY + (sin(angle) * pointRadius).toFloat()
          if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        path.close()
        canvas.drawPath(path, stroke)
      }
      icon.startsWith("diamond") -> canvas.drawPath(Path().apply {
        moveTo(centerX, centerY - radius)
        lineTo(centerX + radius * 0.82f, centerY)
        lineTo(centerX, centerY + radius)
        lineTo(centerX - radius * 0.82f, centerY)
        close()
      }, stroke)
      icon.startsWith("happy") -> {
        canvas.drawCircle(centerX, centerY, radius, stroke)
        canvas.drawCircle(centerX - radius * 0.34f, centerY - radius * 0.20f, radius * 0.09f, fillPaint(color))
        canvas.drawCircle(centerX + radius * 0.34f, centerY - radius * 0.20f, radius * 0.09f, fillPaint(color))
        canvas.drawArc(RectF(centerX - radius * 0.48f, centerY - radius * 0.15f, centerX + radius * 0.48f, centerY + radius * 0.58f), 18f, 144f, false, stroke)
      }
      icon.startsWith("water") || icon.startsWith("leaf") || icon.startsWith("flame") -> canvas.drawPath(Path().apply {
        moveTo(centerX, centerY - radius)
        cubicTo(centerX + radius * 0.82f, centerY - radius * 0.10f, centerX + radius * 0.70f, centerY + radius, centerX, centerY + radius)
        cubicTo(centerX - radius * 0.70f, centerY + radius, centerX - radius * 0.82f, centerY - radius * 0.10f, centerX, centerY - radius)
        close()
      }, stroke)
      icon.startsWith("fitness") || icon.startsWith("barbell") -> {
        canvas.drawLine(centerX - radius * 0.62f, centerY, centerX + radius * 0.62f, centerY, stroke)
        canvas.drawLine(centerX - radius * 0.72f, centerY - radius * 0.46f, centerX - radius * 0.72f, centerY + radius * 0.46f, stroke)
        canvas.drawLine(centerX + radius * 0.72f, centerY - radius * 0.46f, centerX + radius * 0.72f, centerY + radius * 0.46f, stroke)
      }
      icon.startsWith("walk") || icon.startsWith("accessibility") || icon.startsWith("body") -> {
        // A centered, conventional walking-person glyph remains recognizable
        // even in the smallest Leaderboard tracker tile.
        canvas.drawCircle(centerX + radius * 0.08f, centerY - radius * 0.67f, radius * 0.19f, fillPaint(color))
        val shoulderX = centerX - radius * 0.02f
        val shoulderY = centerY - radius * 0.35f
        val hipX = centerX - radius * 0.10f
        val hipY = centerY + radius * 0.15f
        canvas.drawLine(shoulderX, shoulderY, hipX, hipY, stroke)
        canvas.drawLine(shoulderX, centerY - radius * 0.18f, centerX - radius * 0.58f, centerY + radius * 0.06f, stroke)
        canvas.drawLine(shoulderX, centerY - radius * 0.18f, centerX + radius * 0.48f, centerY + radius * 0.02f, stroke)
        canvas.drawLine(hipX, hipY, centerX - radius * 0.52f, centerY + radius * 0.82f, stroke)
        canvas.drawLine(hipX, hipY, centerX + radius * 0.55f, centerY + radius * 0.67f, stroke)
      }
      icon.startsWith("restaurant") || icon.startsWith("nutrition") -> {
        canvas.drawLine(centerX - radius * 0.48f, centerY - radius * 0.82f, centerX - radius * 0.48f, centerY + radius * 0.82f, stroke)
        canvas.drawLine(centerX - radius * 0.72f, centerY - radius * 0.82f, centerX - radius * 0.72f, centerY - radius * 0.18f, stroke)
        canvas.drawLine(centerX - radius * 0.24f, centerY - radius * 0.82f, centerX - radius * 0.24f, centerY - radius * 0.18f, stroke)
        canvas.drawLine(centerX + radius * 0.45f, centerY - radius * 0.82f, centerX + radius * 0.45f, centerY + radius * 0.82f, stroke)
        canvas.drawArc(RectF(centerX + radius * 0.12f, centerY - radius * 0.82f, centerX + radius * 0.78f, centerY - radius * 0.05f), 90f, 180f, false, stroke)
      }
      icon.startsWith("medical") || icon.startsWith("medkit") -> {
        canvas.drawLine(centerX - radius * 0.62f, centerY, centerX + radius * 0.62f, centerY, stroke)
        canvas.drawLine(centerX, centerY - radius * 0.62f, centerX, centerY + radius * 0.62f, stroke)
      }
      icon.startsWith("moon") -> canvas.drawPath(Path().apply {
        addCircle(centerX, centerY, radius * 0.82f, Path.Direction.CW)
        addCircle(centerX + radius * 0.37f, centerY - radius * 0.23f, radius * 0.72f, Path.Direction.CCW)
      }, fillPaint(color))
      icon.startsWith("sunny") -> {
        canvas.drawCircle(centerX, centerY, radius * 0.42f, stroke)
        repeat(8) { index ->
          val angle = index * PI / 4.0
          canvas.drawLine(
            centerX + (cos(angle) * radius * 0.62f).toFloat(),
            centerY + (sin(angle) * radius * 0.62f).toFloat(),
            centerX + (cos(angle) * radius).toFloat(),
            centerY + (sin(angle) * radius).toFloat(),
            stroke,
          )
        }
      }
      icon.startsWith("camera") -> {
        canvas.drawRoundRect(RectF(centerX - radius, centerY - radius * 0.63f, centerX + radius, centerY + radius * 0.72f), radius * 0.16f, radius * 0.16f, stroke)
        canvas.drawCircle(centerX, centerY + radius * 0.05f, radius * 0.37f, stroke)
      }
      icon.startsWith("timer") || icon.startsWith("time") -> {
        canvas.drawCircle(centerX, centerY + radius * 0.08f, radius * 0.76f, stroke)
        canvas.drawLine(centerX, centerY - radius * 0.68f, centerX, centerY - radius, stroke)
        canvas.drawLine(centerX, centerY + radius * 0.08f, centerX + radius * 0.38f, centerY - radius * 0.22f, stroke)
      }
      icon.startsWith("cafe") || icon.startsWith("beer") -> {
        canvas.drawRoundRect(
          RectF(centerX - radius * 0.72f, centerY - radius * 0.62f, centerX + radius * 0.42f, centerY + radius * 0.62f),
          radius * 0.12f,
          radius * 0.12f,
          stroke,
        )
        canvas.drawArc(
          RectF(centerX + radius * 0.20f, centerY - radius * 0.30f, centerX + radius * 0.86f, centerY + radius * 0.35f),
          -85f,
          170f,
          false,
          stroke,
        )
      }
      icon.startsWith("shield") -> canvas.drawPath(Path().apply {
        moveTo(centerX, centerY - radius)
        lineTo(centerX + radius * 0.78f, centerY - radius * 0.62f)
        lineTo(centerX + radius * 0.62f, centerY + radius * 0.35f)
        lineTo(centerX, centerY + radius)
        lineTo(centerX - radius * 0.62f, centerY + radius * 0.35f)
        lineTo(centerX - radius * 0.78f, centerY - radius * 0.62f)
        close()
      }, stroke)
      icon.startsWith("rocket") -> canvas.drawPath(Path().apply {
        moveTo(centerX, centerY - radius)
        cubicTo(centerX + radius * 0.62f, centerY - radius * 0.58f, centerX + radius * 0.66f, centerY + radius * 0.28f, centerX, centerY + radius * 0.72f)
        cubicTo(centerX - radius * 0.66f, centerY + radius * 0.28f, centerX - radius * 0.62f, centerY - radius * 0.58f, centerX, centerY - radius)
        close()
      }, stroke)
      icon.startsWith("trophy") -> {
        canvas.drawArc(RectF(centerX - radius * 0.68f, centerY - radius * 0.75f, centerX + radius * 0.68f, centerY + radius * 0.35f), 0f, 180f, false, stroke)
        canvas.drawLine(centerX, centerY + radius * 0.30f, centerX, centerY + radius * 0.72f, stroke)
        canvas.drawLine(centerX - radius * 0.48f, centerY + radius * 0.74f, centerX + radius * 0.48f, centerY + radius * 0.74f, stroke)
      }
      icon.startsWith("ribbon") -> {
        canvas.drawCircle(centerX, centerY - radius * 0.28f, radius * 0.60f, stroke)
        canvas.drawLine(centerX - radius * 0.28f, centerY + radius * 0.22f, centerX - radius * 0.45f, centerY + radius, stroke)
        canvas.drawLine(centerX + radius * 0.28f, centerY + radius * 0.22f, centerX + radius * 0.45f, centerY + radius, stroke)
      }
      icon.startsWith("planet") || icon.startsWith("compass") -> {
        canvas.drawCircle(centerX, centerY, radius * 0.68f, stroke)
        canvas.drawOval(RectF(centerX - radius, centerY - radius * 0.32f, centerX + radius, centerY + radius * 0.32f), stroke)
      }
      icon.startsWith("briefcase") || icon.startsWith("business") -> {
        canvas.drawRoundRect(
          RectF(centerX - radius, centerY - radius * 0.55f, centerX + radius, centerY + radius * 0.78f),
          radius * 0.14f,
          radius * 0.14f,
          stroke,
        )
        canvas.drawArc(
          RectF(centerX - radius * 0.42f, centerY - radius, centerX + radius * 0.42f, centerY - radius * 0.28f),
          180f,
          180f,
          false,
          stroke,
        )
        canvas.drawLine(centerX - radius, centerY, centerX + radius, centerY, stroke)
      }
      icon.startsWith("school") -> canvas.drawPath(Path().apply {
        moveTo(centerX, centerY - radius)
        lineTo(centerX + radius, centerY - radius * 0.30f)
        lineTo(centerX, centerY + radius * 0.34f)
        lineTo(centerX - radius, centerY - radius * 0.30f)
        close()
        moveTo(centerX - radius * 0.62f, centerY + radius * 0.02f)
        lineTo(centerX - radius * 0.62f, centerY + radius * 0.66f)
        quadTo(centerX, centerY + radius, centerX + radius * 0.62f, centerY + radius * 0.66f)
        lineTo(centerX + radius * 0.62f, centerY + radius * 0.02f)
      }, stroke)
      icon.startsWith("book") -> {
        canvas.drawPath(Path().apply {
          moveTo(centerX, centerY - radius * 0.72f)
          quadTo(centerX - radius * 0.48f, centerY - radius, centerX - radius * 0.92f, centerY - radius * 0.68f)
          lineTo(centerX - radius * 0.92f, centerY + radius * 0.72f)
          quadTo(centerX - radius * 0.46f, centerY + radius * 0.42f, centerX, centerY + radius * 0.78f)
          quadTo(centerX + radius * 0.46f, centerY + radius * 0.42f, centerX + radius * 0.92f, centerY + radius * 0.72f)
          lineTo(centerX + radius * 0.92f, centerY - radius * 0.68f)
          quadTo(centerX + radius * 0.48f, centerY - radius, centerX, centerY - radius * 0.72f)
        }, stroke)
        canvas.drawLine(centerX, centerY - radius * 0.72f, centerX, centerY + radius * 0.78f, stroke)
      }
      icon.startsWith("trending") || icon.startsWith("analytics") || icon.startsWith("stats") -> {
        canvas.drawLine(centerX - radius, centerY + radius * 0.72f, centerX - radius * 0.28f, centerY + radius * 0.10f, stroke)
        canvas.drawLine(centerX - radius * 0.28f, centerY + radius * 0.10f, centerX + radius * 0.20f, centerY + radius * 0.42f, stroke)
        canvas.drawLine(centerX + radius * 0.20f, centerY + radius * 0.42f, centerX + radius, centerY - radius * 0.70f, stroke)
      }
      icon.startsWith("calendar") -> {
        canvas.drawRoundRect(
          RectF(centerX - radius, centerY - radius * 0.78f, centerX + radius, centerY + radius * 0.90f),
          radius * 0.16f,
          radius * 0.16f,
          stroke,
        )
        canvas.drawLine(centerX - radius, centerY - radius * 0.28f, centerX + radius, centerY - radius * 0.28f, stroke)
        canvas.drawCircle(centerX - radius * 0.42f, centerY + radius * 0.20f, radius * 0.09f, fillPaint(color))
        canvas.drawCircle(centerX + radius * 0.12f, centerY + radius * 0.20f, radius * 0.09f, fillPaint(color))
      }
      icon.startsWith("checkbox") || icon.startsWith("checkmark-circle") -> {
        canvas.drawRoundRect(
          RectF(centerX - radius, centerY - radius, centerX + radius, centerY + radius),
          radius * 0.22f,
          radius * 0.22f,
          stroke,
        )
        canvas.drawLine(centerX - radius * 0.55f, centerY, centerX - radius * 0.12f, centerY + radius * 0.42f, stroke)
        canvas.drawLine(centerX - radius * 0.12f, centerY + radius * 0.42f, centerX + radius * 0.62f, centerY - radius * 0.46f, stroke)
      }
      else -> canvas.drawCircle(centerX, centerY, radius, stroke)
    }
  }

  private fun drawGoalTiles(
    canvas: Canvas,
    size: HabHubWidgetSize,
    goals: JSONArray,
    top: Float,
    bottom: Float,
    accent: Int,
  ) {
    if (goals.length() <= 0 || bottom - top < 14f) return
    val pad = 11f
    val gap = 4f
    val preferredSize = min(23f, bottom - top)
    val capacity = max(1, ((size.widthDp - pad * 2f + gap) / (preferredSize + gap)).toInt())
    val count = min(goals.length(), capacity)
    val tileSize = min(preferredSize, (size.widthDp - pad * 2f - gap * (count - 1)) / count)
    repeat(count) { index ->
      val goal = goals.optJSONObject(index) ?: return@repeat
      val left = pad + index * (tileSize + gap)
      drawFeaturedGoalDot(
        canvas,
        RectF(left, top, left + tileSize, top + tileSize),
        goal,
        accent,
      )
    }
  }

  /** Mirrors Today's liquid-fill GoalCompletionDot in the home-screen bitmap. */
  private fun drawFeaturedGoalDot(
    canvas: Canvas,
    rect: RectF,
    goal: JSONObject,
    accent: Int,
  ) {
    val radius = min(8f, rect.height() * 0.34f)
    val path = Path().apply { addRoundRect(rect, radius, radius, Path.Direction.CW) }
    val rawGoalProgress = goal.optDouble("progress", 0.0).toFloat().coerceIn(0f, 1f)
    val goalProgress = if ((rawGoalProgress * 100f).roundToInt() == 0) 0f else rawGoalProgress
    val unavailable = goal.optBoolean("unavailable", false)
    val met = goal.optBoolean("met", goalProgress >= 1f)
    val goalAccent = parseColor(goal.optString("color"), accent)
    canvas.drawPath(path, fillPaint(Color.argb(36, 255, 255, 255)))
    if (!unavailable && goalProgress > 0f) {
      canvas.save()
      canvas.clipPath(path)
      canvas.drawRect(
        rect.left - 1f,
        rect.bottom - (rect.height() + 2f) * goalProgress,
        rect.right + 1f,
        rect.bottom + 1f,
        fillPaint(withAlpha(goalAccent, if (met) 238 else 205)),
      )
      canvas.restore()
    }
    canvas.drawPath(path, strokePaint(Color.argb(70, 255, 255, 255), if (rect.height() < 14f) 0.65f else 0.9f))
    drawCompletionIcon(
      canvas,
      rect.centerX(),
      rect.centerY(),
      rect.height() * 0.22f,
      if (unavailable) "remove" else if (met) "checkmark" else goal.optString("icon", "ellipse-outline"),
      Color.WHITE,
    )
  }

  private fun drawAvatarCard(
    context: Context,
    canvas: Canvas,
    size: HabHubWidgetSize,
    item: JSONObject,
    progress: Float,
    accent: Int,
  ) {
    val avatarBitmap = avatarBitmap(context, item.optString("avatarUri"))
    val heightScale = item.optDouble("heightScale", 1.0).toFloat().coerceIn(0.9f, 1.1f)
    val goals = item.optJSONArray("goals") ?: JSONArray()
    if (size.tall && size.heightDp > size.widthDp * 1.38f) {
      drawPortraitAvatarCard(
        canvas,
        size,
        item,
        avatarBitmap,
        heightScale,
        goals,
        progress,
        accent,
      )
      return
    }
    val outerPad = if (size.compact) 5f else 7f
    val avatarAreaWidth = when {
      size.compact -> min(37f, size.widthDp * 0.34f)
      else -> min(
        size.widthDp * 0.48f,
        max(48f, (size.heightDp - outerPad * 2f) * 328f / 512f / heightScale + 8f),
      )
    }
    val availableHeight = size.heightDp - outerPad * 2f
    val resolvedHeight = min(
      availableHeight,
      avatarAreaWidth * 512f / 328f * heightScale,
    )
    val avatarWidth = resolvedHeight * 328f / 512f
    val centerX = outerPad + avatarAreaWidth / 2f
    val top = (size.heightDp - resolvedHeight) / 2f
    val destination = RectF(
      centerX - avatarWidth / 2f,
      top,
      centerX + avatarWidth / 2f,
      top + resolvedHeight,
    )
    drawAvatarWithProgress(
      canvas,
      avatarBitmap,
      destination,
      item,
      progress,
      accent,
      size.compact,
    )

    drawStatusGoalGrid(
      canvas,
      size,
      goals,
      outerPad + avatarAreaWidth + if (size.compact) 2f else 5f,
      size.widthDp - outerPad,
      outerPad,
      size.heightDp - outerPad,
      accent,
    )
  }

  /** Uses a portrait stack for 2-3 column widgets stretched to 3-5 rows. */
  private fun drawPortraitAvatarCard(
    canvas: Canvas,
    size: HabHubWidgetSize,
    item: JSONObject,
    avatarBitmap: Bitmap?,
    heightScale: Float,
    goals: JSONArray,
    progress: Float,
    accent: Int,
  ) {
    val outerPad = 7f
    val avatarRegionHeight = min(
      size.heightDp * if (size.heightDp >= 260f) 0.48f else 0.45f,
      size.widthDp * 1.35f,
    )
      .coerceAtLeast(58f)
    val avatarMaxHeight = max(36f, avatarRegionHeight - 4f)
    val avatarMaxWidth = size.widthDp * 0.78f
    val resolvedHeight = min(
      avatarMaxHeight,
      avatarMaxWidth * 512f / 328f * heightScale,
    )
    val avatarWidth = resolvedHeight * 328f / 512f
    val destination = RectF(
      size.widthDp / 2f - avatarWidth / 2f,
      outerPad + (avatarRegionHeight - resolvedHeight) / 2f,
      size.widthDp / 2f + avatarWidth / 2f,
      outerPad + (avatarRegionHeight - resolvedHeight) / 2f + resolvedHeight,
    )
    drawAvatarWithProgress(
      canvas,
      avatarBitmap,
      destination,
      item,
      progress,
      accent,
      false,
    )
    drawStatusGoalGrid(
      canvas,
      size,
      goals,
      outerPad,
      size.widthDp - outerPad,
      outerPad + avatarRegionHeight + 3f,
      size.heightDp - outerPad,
      accent,
    )
  }

  private fun drawAvatarWithProgress(
    canvas: Canvas,
    avatarBitmap: Bitmap?,
    destination: RectF,
    item: JSONObject,
    progress: Float,
    accent: Int,
    compact: Boolean,
  ) {
    drawAvatarLayers(
      canvas,
      avatarBitmap,
      destination,
      progress,
      accent,
      item.optString("avatarStyle", "silhouette") == "body_model",
    )
    val pillWidth = if (compact) 23f else (destination.width() * 0.72f).coerceIn(28f, 42f)
    val pillHeight = if (compact) 10.5f else (destination.height() * 0.14f).coerceIn(12f, 17f)
    // Sit the percentage at the avatar's feet. The surrounding outer padding
    // leaves room for the pill to overlap the silhouette edge without clipping.
    val pillCenterY = destination.bottom - pillHeight * 0.35f
    val pill = RectF(
      destination.centerX() - pillWidth / 2f,
      pillCenterY - pillHeight / 2f,
      destination.centerX() + pillWidth / 2f,
      pillCenterY + pillHeight / 2f,
    )
    canvas.drawRoundRect(pill, pillHeight / 2f, pillHeight / 2f, fillPaint(Color.argb(225, 5, 16, 43)))
    canvas.drawRoundRect(pill, pillHeight / 2f, pillHeight / 2f, strokePaint(withAlpha(accent, 210), 0.85f))
    drawCenteredText(
      canvas,
      "${(progress * 100f).roundToInt()}%",
      destination.centerX(),
      pillCenterY,
      textPaint((pillHeight * 0.52f).coerceIn(6.2f, 8.8f), Color.WHITE, true),
    )
  }

  /** Adapts Status rings to the widget's aspect ratio instead of fixed flanks. */
  private fun drawStatusGoalGrid(
    canvas: Canvas,
    size: HabHubWidgetSize,
    goals: JSONArray,
    left: Float,
    right: Float,
    top: Float,
    bottom: Float,
    accent: Int,
  ) {
    val capacity = when {
      size.compact && size.roomy -> 6
      size.compact -> 3
      size.heightDp >= 260f -> 12
      size.heightDp >= 205f -> 10
      size.heightDp >= 145f -> 8
      size.roomy -> 8
      else -> 6
    }
    var count = min(goals.length(), capacity)
    if (count <= 0 || right - left < 18f || bottom - top < 16f) return
    val gridWidth = right - left
    val gridHeight = bottom - top
    var columns = 1
    var diameter = 0f
    while (count > 0) {
      diameter = 0f
      val maximumColumns = when {
        size.compact -> count
        gridWidth >= 118f -> min(3, count)
        else -> min(2, count)
      }
      for (candidate in 1..maximumColumns) {
        val candidateRows = (count + candidate - 1) / candidate
        val candidateCellWidth = gridWidth / candidate
        val candidateCellHeight = gridHeight / candidateRows
        val candidateLabelHeight = if (size.compact) 7f else (candidateCellHeight * 0.2f).coerceIn(8f, 13f)
        val candidateDiameter = min(
          candidateCellWidth - 5f,
          candidateCellHeight - candidateLabelHeight - 4f,
        ).coerceAtMost(
          if (size.compact) 15f
          else if (max(size.widthDp, size.heightDp) >= 300f) 66f
          else 56f,
        )
        if (candidateDiameter > diameter) {
          columns = candidate
          diameter = candidateDiameter
        }
      }
      if (diameter >= 8f) break
      count -= 1
    }
    if (count <= 0) return
    val rows = (count + columns - 1) / columns
    val cellWidth = gridWidth / columns
    val cellHeight = gridHeight / rows
    val labelHeight = if (size.compact) 7f else (cellHeight * 0.2f).coerceIn(8f, 13f)
    val labelSize = (diameter * 0.24f).coerceIn(if (size.compact) 5.2f else 5.8f, 11f)
    val radius = diameter / 2f
    repeat(count) { index ->
      val goal = goals.optJSONObject(index) ?: return@repeat
      val row = index / columns
      val column = index % columns
      val cellLeft = left + column * cellWidth
      val cellTop = top + row * cellHeight
      drawStatusGoalCircle(
        canvas,
        cellLeft + cellWidth / 2f,
        cellTop + (cellHeight - labelHeight) / 2f,
        radius,
        goal,
        accent,
        cellTop + cellHeight - 2f,
        max(10f, cellWidth - 2f),
        labelSize,
      )
    }
  }

  private fun drawStatusGoalCircle(
    canvas: Canvas,
    centerX: Float,
    centerY: Float,
    radius: Float,
    goal: JSONObject,
    accent: Int,
    labelBaseline: Float,
    labelWidth: Float,
    labelSize: Float,
  ) {
    val goalProgress = goal.optDouble("progress", 0.0).toFloat().coerceIn(0f, 1f)
    val unavailable = goal.optBoolean("unavailable", false)
    val met = goal.optBoolean("met", goalProgress >= 1f)
    val goalAccent = parseColor(
      goal.optString("color"),
      if (met) parseColor(GOAL_GOLD, accent) else accent,
    )
    canvas.drawCircle(centerX, centerY, radius, fillPaint(Color.argb(42, 255, 255, 255)))
    canvas.drawCircle(centerX, centerY, radius - 0.8f, strokePaint(Color.argb(88, 255, 255, 255), 0.85f))
    if (goalProgress > 0f) {
      val arc = RectF(centerX - radius + 1f, centerY - radius + 1f, centerX + radius - 1f, centerY + radius - 1f)
      canvas.drawArc(arc, -90f, goalProgress * 360f, false, strokePaint(goalAccent, if (radius < 9f) 1.25f else 1.7f))
    }
    drawCompletionIcon(
      canvas,
      centerX,
      centerY,
      radius * 0.43f,
      if (unavailable) "remove" else if (met) "checkmark" else goal.optString("icon", "ellipse-outline"),
      Color.WHITE,
    )
    drawCenteredEllipsizedText(
      canvas,
      goal.optString("title", "Goal"),
      centerX,
      labelBaseline,
      labelWidth,
      textPaint(labelSize, Color.argb(225, 240, 245, 255), true),
    )
  }

  private fun drawAvatarLayers(
    canvas: Canvas,
    bitmap: Bitmap?,
    destination: RectF,
    progress: Float,
    accent: Int,
    bodyModel: Boolean,
  ) {
    if (bitmap == null) {
      drawFallbackAvatar(canvas, destination, progress, accent)
      return
    }
    val base = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG).apply {
      alpha = if (bodyModel) 245 else 118
      colorFilter = if (bodyModel) null else PorterDuffColorFilter(Color.rgb(221, 230, 245), PorterDuff.Mode.SRC_IN)
    }
    canvas.drawBitmap(bitmap, null, destination, base)
    if (progress <= 0f) return
    canvas.save()
    canvas.clipRect(
      destination.left,
      destination.bottom - destination.height() * progress,
      destination.right,
      destination.bottom,
    )
    val fill = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG).apply {
      alpha = if (bodyModel) 205 else 255
      colorFilter = PorterDuffColorFilter(accent, PorterDuff.Mode.SRC_IN)
    }
    canvas.drawBitmap(bitmap, null, destination, fill)
    canvas.restore()
  }

  private fun drawFallbackAvatar(
    canvas: Canvas,
    destination: RectF,
    progress: Float,
    accent: Int,
  ) {
    fun bodyPath(): Path {
      val cx = destination.centerX()
      val top = destination.top
      val h = destination.height()
      val w = destination.width()
      return Path().apply {
        addCircle(cx, top + h * 0.09f, w * 0.105f, Path.Direction.CW)
        moveTo(cx - w * 0.19f, top + h * 0.18f)
        cubicTo(cx - w * 0.29f, top + h * 0.31f, cx - w * 0.19f, top + h * 0.48f, cx - w * 0.13f, top + h * 0.55f)
        lineTo(cx - w * 0.12f, top + h * 0.96f)
        lineTo(cx - w * 0.01f, top + h * 0.96f)
        lineTo(cx, top + h * 0.57f)
        lineTo(cx + w * 0.01f, top + h * 0.96f)
        lineTo(cx + w * 0.12f, top + h * 0.96f)
        lineTo(cx + w * 0.13f, top + h * 0.55f)
        cubicTo(cx + w * 0.19f, top + h * 0.48f, cx + w * 0.29f, top + h * 0.31f, cx + w * 0.19f, top + h * 0.18f)
        close()
      }
    }
    val path = bodyPath()
    canvas.drawPath(path, fillPaint(Color.argb(100, 221, 230, 245)))
    if (progress > 0f) {
      canvas.save()
      canvas.clipRect(destination.left, destination.bottom - destination.height() * progress, destination.right, destination.bottom)
      canvas.drawPath(path, fillPaint(accent))
      canvas.restore()
    }
  }

  private fun avatarBitmap(context: Context, source: String): Bitmap? {
    if (source.isBlank()) return null
    synchronized(avatarCache) { avatarCache.get(source)?.let { return it } }
    val decoded = try {
      val resourceName = source.substringAfterLast('/').substringBefore('?').substringBeforeLast('.')
      val resourceId = context.resources.getIdentifier(resourceName, "drawable", context.packageName)
      when {
        resourceId != 0 -> BitmapFactory.decodeResource(context.resources, resourceId)
        source.startsWith("assets://") -> context.assets.open(source.removePrefix("assets://").trimStart('/')).use { BitmapFactory.decodeStream(it) }
        source.startsWith("/") -> BitmapFactory.decodeFile(source)
        else -> {
          val uri = Uri.parse(source)
          when (uri.scheme) {
            "file" -> BitmapFactory.decodeFile(uri.path)
            "content", "android.resource" -> context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
            "asset" -> context.assets.open(uri.path.orEmpty().trimStart('/')).use { BitmapFactory.decodeStream(it) }
            else -> null // Never block a widget broadcast on a development URL.
          }
        }
      }
    } catch (_: Exception) {
      null
    }
    if (decoded != null) synchronized(avatarCache) { avatarCache.put(source, decoded) }
    return decoded
  }

  private fun fillPaint(color: Int) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    this.color = color
    style = Paint.Style.FILL
    isDither = true
  }

  private fun strokePaint(color: Int, width: Float) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    this.color = color
    style = Paint.Style.STROKE
    strokeWidth = width
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
    isDither = true
  }

  private fun textPaint(
    size: Float,
    color: Int,
    bold: Boolean,
    letterSpacing: Float = 0f,
  ) = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
    this.color = color
    textSize = size
    typeface = Typeface.create("sans-serif", if (bold) Typeface.BOLD else Typeface.NORMAL)
    this.letterSpacing = letterSpacing
  }

  private fun fittedTextPaint(
    value: String,
    maxWidth: Float,
    preferredSize: Float,
    minimumSize: Float,
    color: Int,
    bold: Boolean,
    letterSpacing: Float = 0f,
  ): TextPaint {
    val paint = textPaint(preferredSize, color, bold, letterSpacing)
    if (value.isBlank() || maxWidth <= 0f) return paint
    val measured = paint.measureText(value)
    if (measured > maxWidth) {
      paint.textSize = max(minimumSize, preferredSize * maxWidth / measured)
    }
    return paint
  }

  private fun drawText(
    canvas: Canvas,
    value: String,
    x: Float,
    baseline: Float,
    maxWidth: Float,
    paint: TextPaint,
  ) {
    val layout = singleLineLayout(value, paint, maxWidth, Layout.Alignment.ALIGN_NORMAL)
    canvas.save()
    canvas.translate(x, baseline - layout.getLineBaseline(0))
    layout.draw(canvas)
    canvas.restore()
  }

  private fun drawCenteredText(
    canvas: Canvas,
    value: String,
    centerX: Float,
    centerY: Float,
    paint: TextPaint,
  ) {
    val metrics = paint.fontMetrics
    paint.textAlign = Paint.Align.CENTER
    canvas.drawText(value, centerX, centerY - (metrics.ascent + metrics.descent) / 2f, paint)
  }

  private fun drawCenteredEllipsizedText(
    canvas: Canvas,
    value: String,
    centerX: Float,
    baseline: Float,
    maxWidth: Float,
    paint: TextPaint,
  ) {
    val layout = singleLineLayout(value, paint, maxWidth, Layout.Alignment.ALIGN_CENTER)
    canvas.save()
    canvas.translate(centerX - maxWidth / 2f, baseline - layout.getLineBaseline(0))
    layout.draw(canvas)
    canvas.restore()
  }

  private fun drawRightAlignedEllipsizedText(
    canvas: Canvas,
    value: String,
    right: Float,
    baseline: Float,
    maxWidth: Float,
    paint: TextPaint,
  ) {
    val layout = singleLineLayout(value, paint, maxWidth, Layout.Alignment.ALIGN_OPPOSITE)
    canvas.save()
    canvas.translate(right - maxWidth, baseline - layout.getLineBaseline(0))
    layout.draw(canvas)
    canvas.restore()
  }

  private fun singleLineLayout(
    value: String,
    paint: TextPaint,
    maxWidth: Float,
    alignment: Layout.Alignment,
  ): StaticLayout {
    val width = max(1, maxWidth.roundToInt())
    val text = TextUtils.ellipsize(value, paint, width.toFloat(), TextUtils.TruncateAt.END)
    return StaticLayout.Builder.obtain(text, 0, text.length, paint, width)
      .setAlignment(alignment)
      .setIncludePad(false)
      .setMaxLines(1)
      .setTextDirection(TextDirectionHeuristics.FIRSTSTRONG_LTR)
      .build()
  }

  private fun blendColor(from: Int, to: Int, fraction: Float): Int {
    val f = fraction.coerceIn(0f, 1f)
    return Color.rgb(
      (Color.red(from) + (Color.red(to) - Color.red(from)) * f).roundToInt(),
      (Color.green(from) + (Color.green(to) - Color.green(from)) * f).roundToInt(),
      (Color.blue(from) + (Color.blue(to) - Color.blue(from)) * f).roundToInt(),
    )
  }

  private fun withAlpha(color: Int, alpha: Int) =
    Color.argb(alpha.coerceIn(0, 255), Color.red(color), Color.green(color), Color.blue(color))

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
    Color.parseColor(value.ifBlank { DEFAULT_NAVY })
  } catch (_: Exception) {
    fallback
  }
}
