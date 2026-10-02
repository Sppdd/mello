package expo.modules.melloblocker

import android.accessibilityservice.AccessibilityService
import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs

/**
 * A small, always-visible bubble the kid sees on top of apps that have a limit or a timed unlock:
 * "TikTok · 12 min left today". Tapping it expands Mello's suggestions (sent from JS) and an
 * "Open Mello" button. It's drawn by the accessibility service (TYPE_ACCESSIBILITY_OVERLAY), so it
 * needs no extra permission, and it can be dragged out of the way.
 */
class TimeBubble(private val service: AccessibilityService) {
  private val wm = service.getSystemService(AccessibilityService.WINDOW_SERVICE) as WindowManager
  private var root: LinearLayout? = null
  private lateinit var headline: TextView
  private lateinit var details: LinearLayout
  private var expanded = false
  private val params = WindowManager.LayoutParams(
    WindowManager.LayoutParams.WRAP_CONTENT,
    WindowManager.LayoutParams.WRAP_CONTENT,
    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
    PixelFormat.TRANSLUCENT,
  ).apply {
    gravity = Gravity.TOP or Gravity.END
    x = dp(12)
    y = dp(96)
  }

  fun show(text: String, suggestions: List<String>) {
    if (root == null) create()
    headline.text = text
    details.removeAllViews()
    for (s in suggestions.take(4)) details.addView(label("• $s", 13f, Color.parseColor("#1F2430")))
    details.addView(label("Open Mello", 14f, Color.parseColor("#5B5BD6")).apply {
      setPadding(0, dp(8), 0, 0)
      setOnClickListener {
        service.packageManager.getLaunchIntentForPackage(service.packageName)?.let {
          it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          service.startActivity(it)
        }
      }
    })
    details.visibility = if (expanded) View.VISIBLE else View.GONE
  }

  fun hide() {
    root?.let { runCatching { wm.removeView(it) } }
    root = null
    expanded = false
  }

  @SuppressLint("ClickableViewAccessibility")
  private fun create() {
    headline = label("", 14f, Color.WHITE)
    details = LinearLayout(service).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(12), dp(10), dp(12), dp(10))
      background = GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = dp(12).toFloat() }
      visibility = View.GONE
    }
    val pill = LinearLayout(service).apply {
      setPadding(dp(14), dp(8), dp(14), dp(8))
      background = GradientDrawable().apply { setColor(Color.parseColor("#E65B5BD6")); cornerRadius = dp(20).toFloat() }
      addView(headline)
    }
    root = LinearLayout(service).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.END
      addView(pill)
      addView(details, LinearLayout.LayoutParams(dp(240), LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(6) })
    }

    // Drag to move; a tap (little movement) toggles the details.
    var downX = 0f; var downY = 0f; var startX = 0; var startY = 0
    pill.setOnTouchListener { _, ev ->
      when (ev.action) {
        MotionEvent.ACTION_DOWN -> { downX = ev.rawX; downY = ev.rawY; startX = params.x; startY = params.y; true }
        MotionEvent.ACTION_MOVE -> {
          params.x = startX - (ev.rawX - downX).toInt()
          params.y = startY + (ev.rawY - downY).toInt()
          root?.let { wm.updateViewLayout(it, params) }
          true
        }
        MotionEvent.ACTION_UP -> {
          if (abs(ev.rawX - downX) < dp(8) && abs(ev.rawY - downY) < dp(8)) {
            expanded = !expanded
            details.visibility = if (expanded) View.VISIBLE else View.GONE
          }
          true
        }
        else -> false
      }
    }
    wm.addView(root, params)
  }

  private fun label(text: String, size: Float, color: Int) = TextView(service).apply {
    this.text = text
    textSize = size
    setTextColor(color)
  }

  private fun dp(v: Int) = (v * service.resources.displayMetrics.density).toInt()
}
