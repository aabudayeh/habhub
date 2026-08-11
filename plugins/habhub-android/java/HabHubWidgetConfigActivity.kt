package __ANDROID_PACKAGE__

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject

class HabHubWidgetConfigActivity : Activity() {
  private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setResult(RESULT_CANCELED)
    widgetId = intent?.extras?.getInt(
      AppWidgetManager.EXTRA_APPWIDGET_ID,
      AppWidgetManager.INVALID_APPWIDGET_ID,
    ) ?: AppWidgetManager.INVALID_APPWIDGET_ID
    if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
      finish()
      return
    }

    val snapshot = HabHubWidgetStore.snapshot(this)
    val existing = HabHubWidgetStore.configuration(this, widgetId)
    val trackerChoices = mutableListOf(
      "__featured__" to getString(R.string.habhub_widget_featured_progress),
      "__avatar__" to getString(R.string.habhub_widget_status_avatar),
    )
    (snapshot.optJSONArray("catalog") ?: snapshot.optJSONArray("trackers"))?.let { trackers ->
      for (index in 0 until trackers.length()) {
        trackers.optJSONObject(index)?.let { tracker ->
          trackerChoices += tracker.optString("id") to tracker.optString("title", "Tracker")
        }
      }
    }

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(24), dp(24), dp(24), dp(24))
      setBackgroundColor(Color.rgb(8, 27, 73))
    }
    root.addView(label(getString(R.string.habhub_widget_choose), 22f))
    root.addView(label(getString(R.string.habhub_widget_tracker), 14f).apply { setPadding(0, dp(20), 0, dp(4)) })
    val trackerGroup = RadioGroup(this).apply { orientation = RadioGroup.VERTICAL }
    trackerChoices.forEachIndexed { index, choice ->
      trackerGroup.addView(RadioButton(this).apply {
        id = View.generateViewId()
        tag = choice.first
        text = choice.second
        setTextColor(Color.WHITE)
        isChecked = choice.first == existing.trackerId ||
          (index == 0 && trackerChoices.none { it.first == existing.trackerId })
      })
    }
    root.addView(trackerGroup)

    root.addView(Button(this).apply {
      text = getString(R.string.habhub_widget_add)
      isAllCaps = false
      setTextColor(Color.rgb(8, 27, 73))
      setBackgroundColor(Color.rgb(184, 228, 92))
      setOnClickListener {
        val tracker = trackerGroup.findViewById<RadioButton>(trackerGroup.checkedRadioButtonId)
          ?.tag?.toString() ?: "__featured__"
        HabHubWidgetStore.saveConfiguration(
          this@HabHubWidgetConfigActivity,
          widgetId,
          tracker,
          existing.range,
        )
        HabHubWidgetRenderer.updateWidget(this@HabHubWidgetConfigActivity, widgetId)
        setResult(
          RESULT_OK,
          Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId),
        )
        finish()
      }
    }, LinearLayout.LayoutParams(
      LinearLayout.LayoutParams.MATCH_PARENT,
      dp(52),
    ).apply { topMargin = dp(24) })

    setContentView(ScrollView(this).apply { addView(root) })
  }

  private fun label(value: String, size: Float) = TextView(this).apply {
    text = value
    textSize = size
    setTextColor(Color.WHITE)
  }

  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
