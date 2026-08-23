package __ANDROID_PACKAGE__

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputFilter
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView

class HabHubWidgetConfigActivity : Activity() {
  private var widgetId = AppWidgetManager.INVALID_APPWIDGET_ID
  private val navy = Color.rgb(8, 27, 73)
  private val panel = Color.rgb(15, 39, 79)
  private val lime = Color.rgb(184, 228, 92)
  private val muted = Color.rgb(195, 207, 229)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setResult(RESULT_CANCELED)
    widgetId = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
      ?: AppWidgetManager.INVALID_APPWIDGET_ID
    if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
      finish()
      return
    }

    val existing = HabHubWidgetStore.configuration(this, widgetId)
    val alreadyConfigured = HabHubWidgetStore.hasConfiguration(this, widgetId)
    val family = widgetFamily(widgetId)
    val choices = when (family) {
      "square" -> listOf("__avatar__" to getString(R.string.habhub_widget_status_avatar))
      "wide_compact" -> listOf("__featured__" to getString(R.string.habhub_widget_featured_progress))
      else -> listOf(
        "__featured__" to getString(R.string.habhub_widget_featured_progress),
        "__avatar__" to getString(R.string.habhub_widget_status_avatar),
      )
    }

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(22), dp(24), dp(22), dp(32))
      setBackgroundColor(navy)
    }
    root.addView(label(getString(R.string.habhub_widget_choose), 24f, true))
    root.addView(label(getString(R.string.habhub_widget_size_hint, sizeName(family)), 13f).apply {
      setTextColor(muted)
      setPadding(0, dp(5), 0, dp(18))
    })

    root.addView(sectionLabel(getString(R.string.habhub_widget_content)))
    val contentGroup = radioGroup()
    val selectedContent = existing.trackerId.takeIf { candidate -> alreadyConfigured && choices.any { it.first == candidate } }
      ?: choices.first().first
    choices.forEach { choice -> contentGroup.addView(option(choice.second, choice.first, choice.first == selectedContent)) }
    root.addView(card(contentGroup))

    root.addView(sectionLabel(getString(R.string.habhub_widget_appearance)))
    val appearanceGroup = radioGroup()
    listOf(
      "theme" to getString(R.string.habhub_widget_follow_theme),
      "transparent" to getString(R.string.habhub_widget_transparent),
      "custom" to getString(R.string.habhub_widget_custom_color),
    ).forEach { choice -> appearanceGroup.addView(option(choice.second, choice.first, choice.first == existing.backgroundMode)) }
    root.addView(card(appearanceGroup))

    val colorInput = EditText(this).apply {
      setText(existing.backgroundColor)
      hint = "#081B49"
      setTextColor(Color.WHITE)
      setHintTextColor(Color.rgb(132, 151, 184))
      filters = arrayOf(InputFilter.LengthFilter(9))
      setSingleLine(true)
      backgroundTintList = ColorStateList.valueOf(lime)
      setPadding(dp(10), dp(8), dp(10), dp(8))
    }
    val colorCard = card(colorInput).apply { visibility = if (existing.backgroundMode == "custom") View.VISIBLE else View.GONE }
    root.addView(colorCard)

    val opacityLabel = label("", 13f, true)
    val opacitySlider = SeekBar(this).apply {
      max = 100
      progress = existing.backgroundOpacity
      progressTintList = ColorStateList.valueOf(lime)
      thumbTintList = ColorStateList.valueOf(lime)
    }
    fun refreshOpacityLabel() {
      opacityLabel.text = getString(R.string.habhub_widget_opacity_value, opacitySlider.progress)
    }
    refreshOpacityLabel()
    opacitySlider.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
      override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) = refreshOpacityLabel()
      override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
      override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
    })
    val opacityPanel = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      addView(opacityLabel)
      addView(opacitySlider, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(42)))
      visibility = if (existing.backgroundMode == "theme") View.GONE else View.VISIBLE
    }
    root.addView(card(opacityPanel))
    root.addView(label(getString(R.string.habhub_widget_blur_note), 12f).apply {
      setTextColor(muted)
      setPadding(dp(2), dp(8), dp(2), 0)
    })

    appearanceGroup.setOnCheckedChangeListener { group, checkedId ->
      val mode = group.findViewById<RadioButton>(checkedId)?.tag?.toString() ?: "transparent"
      colorCard.visibility = if (mode == "custom") View.VISIBLE else View.GONE
      opacityPanel.visibility = if (mode == "theme") View.GONE else View.VISIBLE
      if (mode == "transparent" && opacitySlider.progress == 100) opacitySlider.progress = 55
    }

    root.addView(Button(this).apply {
      text = getString(if (alreadyConfigured) R.string.habhub_widget_save else R.string.habhub_widget_add)
      isAllCaps = false
      textSize = 16f
      setTypeface(typeface, Typeface.BOLD)
      setTextColor(navy)
      background = rounded(lime, 15f)
      setOnClickListener {
        val content = contentGroup.findViewById<RadioButton>(contentGroup.checkedRadioButtonId)
          ?.tag?.toString() ?: choices.first().first
        val mode = appearanceGroup.findViewById<RadioButton>(appearanceGroup.checkedRadioButtonId)
          ?.tag?.toString() ?: "transparent"
        HabHubWidgetStore.saveConfiguration(
          this@HabHubWidgetConfigActivity,
          widgetId,
          content,
          existing.range,
          mode,
          colorInput.text?.toString()?.trim().orEmpty().ifBlank { "#081B49" },
          opacitySlider.progress,
        )
        HabHubWidgetRenderer.updateWidget(this@HabHubWidgetConfigActivity, widgetId)
        setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
        finish()
      }
    }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(54)).apply { topMargin = dp(26) })

    setContentView(ScrollView(this).apply { isFillViewport = true; addView(root) })
  }

  private fun widgetFamily(id: Int): String {
    val manager = AppWidgetManager.getInstance(this)
    fun belongsTo(provider: Class<*>) = id in manager.getAppWidgetIds(ComponentName(this, provider))
    return when {
      belongsTo(HabHubSquareWidgetProvider::class.java) -> "square"
      belongsTo(HabHubWideCompactWidgetProvider::class.java) -> "wide_compact"
      belongsTo(HabHubWideWidgetProvider::class.java) -> "wide"
      else -> "small"
    }
  }

  private fun sizeName(family: String) = when (family) {
    "square" -> "2 x 2"
    "wide_compact" -> "4 x 1"
    "wide" -> "4 x 2"
    else -> "2 x 1"
  }

  private fun radioGroup() = RadioGroup(this).apply { orientation = RadioGroup.VERTICAL }

  private fun option(title: String, value: String, checked: Boolean) = RadioButton(this).apply {
    id = View.generateViewId()
    tag = value
    text = title
    textSize = 15f
    setTextColor(Color.WHITE)
    buttonTintList = ColorStateList.valueOf(lime)
    setPadding(dp(4), dp(5), dp(4), dp(5))
    isChecked = checked
  }

  private fun card(child: View) = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL
    setPadding(dp(12), dp(9), dp(12), dp(9))
    background = rounded(panel, 17f, Color.argb(56, 255, 255, 255))
    addView(child)
  }.also {
    it.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
      bottomMargin = dp(8)
    }
  }

  private fun sectionLabel(value: String) = label(value, 13f, true).apply {
    setTextColor(muted)
    setPadding(dp(2), dp(16), 0, dp(7))
  }

  private fun label(value: String, size: Float, bold: Boolean = false) = TextView(this).apply {
    text = value
    textSize = size
    setTextColor(Color.WHITE)
    if (bold) setTypeface(typeface, Typeface.BOLD)
  }

  private fun rounded(color: Int, radiusDp: Float, stroke: Int? = null) = GradientDrawable().apply {
    shape = GradientDrawable.RECTANGLE
    cornerRadius = dp(radiusDp)
    setColor(color)
    if (stroke != null) setStroke(dp(1), stroke)
  }

  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
  private fun dp(value: Float) = value * resources.displayMetrics.density
}
