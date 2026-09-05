package __ANDROID_PACKAGE__

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView

class HabHubHealthConnectPrivacyActivity : Activity() {
  companion object {
    private const val PRIVACY_URL = __PRIVACY_URL__
  }

  private lateinit var root: LinearLayout
  private lateinit var progress: ProgressBar
  private lateinit var webView: WebView
  private var errorPanel: View? = null

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    title = "HabHub privacy policy"
    window.statusBarColor = Color.rgb(8, 27, 73)

    root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.WHITE)
    }
    root.addView(TextView(this).apply {
      text = "HabHub privacy policy"
      textSize = 20f
      setTextColor(Color.WHITE)
      setBackgroundColor(Color.rgb(8, 27, 73))
      setPadding(dp(20), dp(18), dp(20), dp(6))
    })
    root.addView(TextView(this).apply {
      text = PRIVACY_URL
      textSize = 12f
      setTextColor(Color.rgb(195, 207, 229))
      setBackgroundColor(Color.rgb(8, 27, 73))
      setPadding(dp(20), 0, dp(20), dp(16))
    })

    progress = ProgressBar(
      this,
      null,
      android.R.attr.progressBarStyleHorizontal,
    ).apply {
      isIndeterminate = false
      max = 100
    }
    root.addView(
      progress,
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        dp(3),
      ),
    )

    webView = WebView(this).apply {
      setBackgroundColor(Color.WHITE)
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = true
      settings.allowFileAccess = false
      settings.allowContentAccess = false
      settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      settings.setSupportMultipleWindows(false)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        settings.safeBrowsingEnabled = true
      }
      webChromeClient = object : WebChromeClient() {
        override fun onProgressChanged(view: WebView?, newProgress: Int) {
          this@HabHubHealthConnectPrivacyActivity.progress.progress =
            newProgress
          this@HabHubHealthConnectPrivacyActivity.progress.visibility =
            if (newProgress >= 100) View.GONE else View.VISIBLE
        }
      }
      webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(
          view: WebView,
          request: WebResourceRequest,
        ): Boolean = request.url.scheme?.lowercase() != "https"

        override fun onReceivedError(
          view: WebView,
          request: WebResourceRequest,
          error: WebResourceError,
        ) {
          super.onReceivedError(view, request, error)
          if (request.isForMainFrame) {
            showLoadError(error.description?.toString())
          }
        }
      }
    }
    root.addView(
      webView,
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        0,
        1f,
      ),
    )
    setContentView(root)
    loadPrivacyPolicy()
  }

  private fun loadPrivacyPolicy() {
    errorPanel?.let(root::removeView)
    errorPanel = null
    progress.visibility = View.VISIBLE
    webView.visibility = View.VISIBLE
    webView.loadUrl(PRIVACY_URL)
  }

  private fun showLoadError(description: String?) {
    progress.visibility = View.GONE
    webView.visibility = View.GONE
    errorPanel?.let(root::removeView)
    val panel = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(24), dp(28), dp(24), dp(24))
      addView(TextView(this@HabHubHealthConnectPrivacyActivity).apply {
        text = "The privacy policy could not be loaded."
        textSize = 18f
        setTextColor(Color.rgb(8, 27, 73))
      })
      addView(TextView(this@HabHubHealthConnectPrivacyActivity).apply {
        text = listOfNotNull(
          description?.takeIf { it.isNotBlank() },
          "Check your connection and retry. The policy is available at $PRIVACY_URL",
        ).joinToString("\n\n")
        textSize = 14f
        setTextColor(Color.rgb(52, 65, 89))
        setPadding(0, dp(12), 0, dp(20))
      })
    }
    panel.addView(Button(this).apply {
      text = "Retry"
      isAllCaps = false
      setOnClickListener { loadPrivacyPolicy() }
    })
    errorPanel = panel
    root.addView(panel)
  }

  @Deprecated("Android still dispatches this callback below API 33.")
  override fun onBackPressed() {
    if (::webView.isInitialized && webView.canGoBack()) {
      webView.goBack()
    } else {
      super.onBackPressed()
    }
  }

  override fun onDestroy() {
    if (::webView.isInitialized) {
      webView.stopLoading()
      webView.removeAllViews()
      webView.destroy()
    }
    super.onDestroy()
  }

  private fun dp(value: Int) =
    (value * resources.displayMetrics.density).toInt()
}
