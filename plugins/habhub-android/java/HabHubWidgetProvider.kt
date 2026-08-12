package __ANDROID_PACKAGE__

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
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
    // Validate before replacing the last known-good widget payload. Tracker
    // rows are calculated only when a configured widget needs them, so merge
    // those rows and the last avatar instead of erasing useful snapshots.
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
    if (!incoming.has("avatar") && previous.has("avatar")) {
      incoming.put("avatar", previous.optJSONObject("avatar"))
    }
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
      // Status is the single supported widget. Normalize older Featured and
      // per-tracker configurations as soon as the launcher touches them.
      .putString("$TRACKER_PREFIX$widgetId", "__avatar__")
      .putString("$RANGE_PREFIX$widgetId", normalizedRange(range))
      .apply()
  }

  fun configuration(context: Context, widgetId: Int) = HabHubWidgetConfiguration(
    widgetId,
    "__avatar__",
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

private data class HabHubWidgetSize(
  val heightDp: Float,
  val widthDp: Float,
) {
  val compact = heightDp < 90f
  val wide = widthDp >= 220f
}

object HabHubWidgetRenderer {
  private const val DEFAULT_NAVY = "#081B49"
  private const val GOAL_GOLD = "#D7A62A"
  private const val GOAL_LIME = "#B8E45C"
  private const val MAX_RENDER_PIXELS = 190_000f
  private val providers = arrayOf(
    HabHubSmallWidgetProvider::class.java,
    HabHubSquareWidgetProvider::class.java,
    HabHubWideWidgetProvider::class.java,
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
    val selected = snapshot.optJSONObject("avatar")
    val item = selected ?: emptySnapshot(context, configuration.trackerId)
    val size = widgetSize(context, manager, widgetId)
    val views = RemoteViews(context.packageName, R.layout.habhub_widget)
    views.setImageViewBitmap(
      R.id.widget_card_image,
      renderCard(context, item, size),
    )
    views.setCharSequence(
      R.id.widget_root,
      "setContentDescription",
      contentDescription(item),
    )
    views.setOnClickPendingIntent(
      R.id.widget_root,
      deepLinkIntent(
        context,
        widgetId,
        item.optString(
          "deepLink",
          if (configuration.trackerId == "__avatar__") "paceboard://status" else "paceboard://",
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
    val smallWidgetIds = manager.getAppWidgetIds(
      ComponentName(context, HabHubSmallWidgetProvider::class.java),
    )
    val fallbackWidth = if (widgetId in wideWidgetIds) 250 else 110
    val fallbackHeight = if (widgetId in smallWidgetIds) 48 else 105
    val width = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, fallbackWidth)
      .takeIf { it > 0 } ?: fallbackWidth
    val height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, fallbackHeight)
      .takeIf { it > 0 } ?: fallbackHeight
    return HabHubWidgetSize(
      heightDp = height.coerceIn(42, 220).toFloat(),
      widthDp = width.coerceIn(90, 420).toFloat(),
    )
  }

  private fun emptySnapshot(context: Context, requestedId: String) = JSONObject().apply {
    put("id", requestedId)
    put("eyebrow", if (requestedId == "__avatar__") context.getString(R.string.habhub_widget_status_avatar) else "HabHub")
    put("title", "HabHub")
    put("value", "\u2014")
    put("subtitle", context.getString(R.string.habhub_widget_open_to_update))
    put("progress", 0)
    put("deepLink", if (requestedId == "__avatar__") "paceboard://status" else "paceboard://")
  }

  private fun contentDescription(item: JSONObject): String = listOf(
    item.optString("eyebrow"),
    item.optString("value"),
    item.optString("subtitle"),
    item.optString("weightLabel"),
    item.optString("bodyCompositionLabel"),
  ).filter { it.isNotBlank() }.joinToString(". ")

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
    val progress = item.optDouble("progress", 0.0).toFloat().coerceIn(0f, 1f)
    val allComplete = item.optBoolean("allComplete", false)
    val accent = parseColor(
      item.optString("progressColor"),
      parseColor(if (allComplete) GOAL_GOLD else GOAL_LIME, Color.rgb(184, 228, 92)),
    )
    drawCardSurface(canvas, size, item, allComplete)
    drawProgressOutline(
      canvas,
      size,
      progress,
      item.optString("fillMode", "clockwise"),
      accent,
    )
    if (item.optString("id") == "__avatar__") {
      drawAvatarCard(context, canvas, size, item, progress, accent)
    } else {
      drawFeaturedCard(canvas, size, item, progress, accent)
    }
    return bitmap
  }

  private fun drawCardSurface(
    canvas: Canvas,
    size: HabHubWidgetSize,
    item: JSONObject,
    allComplete: Boolean,
  ) {
    val inset = 1.5f
    val rect = RectF(inset, inset, size.widthDp - inset, size.heightDp - inset)
    val radius = if (size.compact) 15f else 19f
    val supplied = parseColor(item.optString("backgroundColor"), Color.rgb(8, 27, 73))
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
        top,
        bottom,
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
        intArrayOf(withAlpha(glowColor, 72), withAlpha(glowColor, 0)),
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
        intArrayOf(Color.TRANSPARENT, Color.argb(24, 255, 255, 255), Color.TRANSPARENT),
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

  private fun drawFeaturedCard(
    canvas: Canvas,
    size: HabHubWidgetSize,
    item: JSONObject,
    progress: Float,
    accent: Int,
  ) {
    val pad = if (size.compact) 9f else 11f
    val badgeDiameter = if (size.compact) 27f else 35f
    val badgeCenterX = size.widthDp - pad - badgeDiameter / 2f
    val badgeCenterY = if (size.compact) size.heightDp / 2f - 1f else 30f
    val contentWidth = max(24f, badgeCenterX - badgeDiameter / 2f - pad - 5f)
    val eyebrow = item.optString("eyebrow").ifBlank { item.optString("title", "HabHub") }
      .uppercase(Locale.getDefault())
    drawText(
      canvas,
      eyebrow,
      pad,
      if (size.compact) 12f else 17f,
      contentWidth,
      textPaint(if (size.compact) 6.5f else 7.5f, Color.argb(205, 255, 255, 255), true, 0.12f),
    )
    drawText(
      canvas,
      item.optString("value", "\u2014"),
      pad,
      if (size.compact) 29.5f else 42f,
      contentWidth,
      textPaint(if (size.compact) 16f else 24f, Color.WHITE, true),
    )
    if (!size.compact) {
      drawText(
        canvas,
        item.optString("subtitle"),
        pad,
        54f,
        contentWidth,
        textPaint(8f, Color.argb(220, 224, 234, 250), true),
      )
    }
    drawProgressBadge(canvas, badgeCenterX, badgeCenterY, badgeDiameter, progress, accent)

    val barLeft = pad
    val barRight = size.widthDp - pad
    val barHeight = if (size.compact) 3.2f else 5.2f
    val goals = item.optJSONArray("goals") ?: JSONArray()
    val barTop = if (size.compact) {
      size.heightDp - pad + 1f
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

    if (!size.compact) {
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

  private fun drawProgressBadge(
    canvas: Canvas,
    centerX: Float,
    centerY: Float,
    diameter: Float,
    progress: Float,
    accent: Int,
  ) {
    val radius = diameter / 2f
    canvas.drawCircle(centerX, centerY, radius, fillPaint(Color.argb(31, 255, 255, 255)))
    canvas.drawCircle(centerX, centerY, radius - 1f, strokePaint(Color.argb(72, 255, 255, 255), 1f))
    val arc = RectF(centerX - radius + 1f, centerY - radius + 1f, centerX + radius - 1f, centerY + radius - 1f)
    canvas.drawArc(arc, -90f, progress * 360f, false, strokePaint(accent, 2.3f))
    drawCenteredText(
      canvas,
      "${(progress * 100f).roundToInt()}%",
      centerX,
      centerY,
      textPaint(if (diameter < 30f) 7.5f else 9f, Color.WHITE, true),
    )
  }

  private fun drawGoalTiles(
    canvas: Canvas,
    size: HabHubWidgetSize,
    goals: JSONArray,
    top: Float,
    bottom: Float,
    accent: Int,
  ) {
    val count = min(goals.length(), if (size.wide) 3 else if (size.widthDp >= 165f) 2 else 1)
    if (count <= 0 || bottom - top < 17f) return
    val pad = 11f
    val gap = 4f
    val tileWidth = (size.widthDp - pad * 2f - gap * (count - 1)) / count
    repeat(count) { index ->
      val goal = goals.optJSONObject(index) ?: return@repeat
      val left = pad + index * (tileWidth + gap)
      val rect = RectF(left, top, left + tileWidth, bottom)
      val radius = min(7f, rect.height() / 3f)
      val path = Path().apply { addRoundRect(rect, radius, radius, Path.Direction.CW) }
      canvas.drawPath(path, fillPaint(Color.argb(29, 255, 255, 255)))
      val goalProgress = goal.optDouble("progress", 0.0).toFloat().coerceIn(0f, 1f)
      if (goalProgress > 0f) {
        canvas.save()
        canvas.clipPath(path)
        canvas.drawRect(
          rect.left,
          rect.bottom - rect.height() * goalProgress,
          rect.right,
          rect.bottom,
          fillPaint(withAlpha(accent, if (goal.optBoolean("met", false)) 105 else 72)),
        )
        canvas.restore()
      }
      canvas.drawPath(path, strokePaint(Color.argb(48, 255, 255, 255), 0.8f))
      val textLeft = rect.left + 4f
      val textWidth = rect.width() - 8f
      drawText(
        canvas,
        goal.optString("value"),
        textLeft,
        rect.top + min(9f, rect.height() * 0.42f),
        textWidth,
        textPaint(6.7f, Color.WHITE, true),
      )
      drawText(
        canvas,
        goal.optString("title"),
        textLeft,
        rect.bottom - 4f,
        textWidth,
        textPaint(5.8f, Color.argb(220, 235, 241, 252), false),
      )
    }
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
    val availableHeight = when {
      size.compact -> size.heightDp - 6f
      size.wide -> size.heightDp - 12f
      else -> size.heightDp - 31f
    }
    val avatarHeight = availableHeight * heightScale
    val resolvedHeight = min(avatarHeight, availableHeight + 2f)
    val avatarWidth = resolvedHeight * 328f / 512f
    val centerX = if (size.compact) max(24f, size.widthDp * 0.27f) else size.widthDp / 2f
    val top = when {
      size.compact -> (size.heightDp - resolvedHeight) / 2f
      size.wide -> 5f
      else -> 14f
    }
    val destination = RectF(
      centerX - avatarWidth / 2f,
      top,
      centerX + avatarWidth / 2f,
      top + resolvedHeight,
    )
    drawAvatarLayers(
      canvas,
      avatarBitmap,
      destination,
      progress,
      accent,
      item.optString("avatarStyle", "silhouette") == "body_model",
    )

    val pillWidth = if (size.compact) 23f else 30f
    val pillHeight = if (size.compact) 10.5f else 14f
    val pillCenterY = destination.top + destination.height() * 0.48f
    val pill = RectF(
      centerX - pillWidth / 2f,
      pillCenterY - pillHeight / 2f,
      centerX + pillWidth / 2f,
      pillCenterY + pillHeight / 2f,
    )
    canvas.drawRoundRect(pill, pillHeight / 2f, pillHeight / 2f, fillPaint(Color.argb(225, 5, 16, 43)))
    canvas.drawRoundRect(pill, pillHeight / 2f, pillHeight / 2f, strokePaint(withAlpha(accent, 210), 0.85f))
    drawCenteredText(
      canvas,
      "${(progress * 100f).roundToInt()}%",
      centerX,
      pillCenterY,
      textPaint(if (size.compact) 6.2f else 7.5f, Color.WHITE, true),
    )

    val eyebrow = item.optString("eyebrow", item.optString("title", "STATUS"))
      .uppercase(Locale.getDefault())
    if (size.compact) {
      val factsLeft = min(size.widthDp - 38f, centerX + avatarWidth / 2f + 6f)
      val factsWidth = size.widthDp - factsLeft - 8f
      drawText(canvas, eyebrow, factsLeft, 12f, factsWidth, textPaint(6.3f, withAlpha(accent, 240), true, 0.1f))
      drawText(canvas, item.optString("weightLabel"), factsLeft, 27f, factsWidth, textPaint(8f, Color.WHITE, true))
      drawText(canvas, item.optString("bodyCompositionLabel"), factsLeft, 39f, factsWidth, textPaint(6.5f, Color.argb(215, 224, 234, 250), false))
    } else if (size.wide) {
      drawAvatarFact(
        canvas,
        eyebrow,
        item.optString("weightLabel"),
        12f,
        size.widthDp / 2f - avatarWidth / 2f - 9f,
        size.heightDp,
        accent,
      )
      drawAvatarFact(
        canvas,
        item.optString("subtitle").uppercase(Locale.getDefault()),
        item.optString("bodyCompositionLabel"),
        size.widthDp / 2f + avatarWidth / 2f + 9f,
        size.widthDp - 12f,
        size.heightDp,
        accent,
      )
    } else {
      drawText(canvas, eyebrow, 9f, 13f, size.widthDp - 18f, textPaint(6.5f, withAlpha(accent, 235), true, 0.1f))
      val facts = listOf(item.optString("weightLabel"), item.optString("bodyCompositionLabel"))
        .filter { it.isNotBlank() }
        .joinToString("  \u00B7  ")
      drawCenteredEllipsizedText(
        canvas,
        facts,
        size.widthDp / 2f,
        size.heightDp - 7f,
        size.widthDp - 16f,
        textPaint(6.2f, Color.argb(220, 231, 238, 250), true),
      )
    }
  }

  private fun drawAvatarFact(
    canvas: Canvas,
    eyebrow: String,
    value: String,
    left: Float,
    right: Float,
    height: Float,
    accent: Int,
  ) {
    if (right - left < 22f) return
    val center = (left + right) / 2f
    drawCenteredEllipsizedText(canvas, eyebrow, center, height * 0.39f, right - left, textPaint(6.2f, withAlpha(accent, 235), true, 0.08f))
    drawCenteredEllipsizedText(canvas, value, center, height * 0.57f, right - left, textPaint(8.2f, Color.WHITE, true))
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
