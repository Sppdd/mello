package expo.modules.melloblocker

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import java.util.Calendar

/**
 * Watches which app is in the foreground and applies the family's rules, in this order:
 * bedtime (only allowed apps), daily limits, then read/task-first rules. When an app isn't allowed
 * right now, Mello comes to the front and explains why. For apps with a limit or a timed unlock,
 * a small bubble shows the kid how much time is left.
 */
class MelloAccessibilityService : AccessibilityService() {
  private var lastBouncedPackage: String? = null
  private var lastBouncedAt = 0L
  private var lastCheckAt = 0L
  private var currentPackage: String? = null
  private lateinit var bubble: TimeBubble
  private val handler = Handler(Looper.getMainLooper())
  private val tick = object : Runnable {
    override fun run() {
      currentPackage?.let { evaluate(it) }
      handler.postDelayed(this, TICK_MS)
    }
  }

  override fun onServiceConnected() {
    bubble = TimeBubble(this)
    handler.postDelayed(tick, TICK_MS)
  }

  override fun onDestroy() {
    handler.removeCallbacks(tick)
    if (::bubble.isInitialized) bubble.hide()
    super.onDestroy()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    val pkg = event?.packageName?.toString() ?: return
    val now = System.currentTimeMillis()
    if (event.eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
      // Fires constantly while scrolling; the periodic tick already re-checks the current app.
      if (now - lastCheckAt < CONTENT_CHECK_INTERVAL_MS) return
    } else if (isSystemChrome(pkg)) {
      return // keyboards and system UI don't change which app the kid is using
    }
    lastCheckAt = now
    currentPackage = pkg
    evaluate(pkg)
  }

  private fun evaluate(pkg: String) {
    if (pkg == packageName || pkg in BlockerStore.NEVER_BLOCK) {
      bubble.hide()
      return
    }
    val now = System.currentTimeMillis()

    BlockerStore.quietHours(this)?.let { q ->
      if (inWindow(q.start, q.end, minuteOfDay()) && pkg !in q.allowed) return bounce(pkg, "bedtime")
    }

    val limit = BlockerStore.limits(this)[pkg]
    val usedMinutes = if (limit != null) UsageTracker.minutesToday(this, pkg) else 0
    if (limit != null && usedMinutes >= limit) return bounce(pkg, "limit")

    val unlockedUntil = BlockerStore.unlockedUntil(this, pkg)
    if (pkg in BlockerStore.blocked(this) && unlockedUntil <= now) return bounce(pkg, "rule")

    // Allowed: show time left if there's a limit or a timed unlock.
    val parts = mutableListOf<String>()
    if (limit != null) parts += "${limit - usedMinutes} min left today"
    if (unlockedUntil > now) parts += "unlocked ${((unlockedUntil - now) / 60_000L) + 1} min"
    if (parts.isNotEmpty() && BlockerStore.bubbleEnabled(this)) bubble.show(parts.joinToString(" · "), BlockerStore.bubbleLines(this))
    else bubble.hide()
  }

  private fun bounce(pkg: String, reason: String) {
    bubble.hide()
    val now = System.currentTimeMillis()
    // Some apps fire several window events while opening; bounce once.
    if (pkg == lastBouncedPackage && now - lastBouncedAt < BOUNCE_DEBOUNCE_MS) return
    lastBouncedPackage = pkg
    lastBouncedAt = now
    BlockerStore.setPending(this, pkg, reason)
    MelloBlockerModule.emitBlocked(pkg, reason)
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    startActivity(launch)
  }

  private fun isSystemChrome(pkg: String) =
    pkg == "com.android.systemui" || pkg.contains("inputmethod") || pkg.endsWith(".keyboard")

  override fun onInterrupt() = Unit

  companion object {
    private const val BOUNCE_DEBOUNCE_MS = 1_500L
    private const val CONTENT_CHECK_INTERVAL_MS = 5_000L
    private const val TICK_MS = 30_000L

    fun minuteOfDay(): Int = Calendar.getInstance().let { it.get(Calendar.HOUR_OF_DAY) * 60 + it.get(Calendar.MINUTE) }

    /** Same rule as inQuietHours in packages/shared, including windows that cross midnight. */
    fun inWindow(start: Int, end: Int, minute: Int): Boolean = when {
      start == end -> false
      start < end -> minute in start until end
      else -> minute >= start || minute < end
    }
  }
}
