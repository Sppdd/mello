package expo.modules.melloblocker

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import java.util.Calendar

/**
 * Watches which app is in the foreground and applies the rules, in this order: a running focus
 * session (stay in one app), bedtime (only allowed apps), daily limits, then read/task-first rules.
 * When an app isn't allowed right now, Mello comes to the front and explains why. For apps with a
 * limit or a timed unlock, a small bubble shows how much time is left.
 *
 * It only sees package names and event types; canRetrieveWindowContent is off, so it never reads
 * what's on screen.
 */
class MelloAccessibilityService : AccessibilityService() {
  private var lastBouncedPackage: String? = null
  private var lastBouncedAt = 0L
  private var lastCheckAt = 0L
  private var currentPackage: String? = null
  /** Last time the focus target produced any event (scroll, page turn, tap). Kept in memory; it changes constantly. */
  private var focusActiveAt = 0L
  private lateinit var bubble: TimeBubble
  private val handler = Handler(Looper.getMainLooper())
  private val tick = object : Runnable {
    override fun run() {
      BlockerStore.heartbeat(this@MelloAccessibilityService, System.currentTimeMillis(), HEARTBEAT_MAX_GAP_MS)
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
    // Scrolls, taps and content changes in the focus app mean the user is really there (turning pages).
    if (pkg == focusTarget) focusActiveAt = now
    if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
      // Content, scroll and click events fire constantly; the periodic tick already re-checks the current app.
      if (now - lastCheckAt < CONTENT_CHECK_INTERVAL_MS || isSystemChrome(pkg)) return
    } else if (isSystemChrome(pkg)) {
      return // keyboards and system UI don't change which app the kid is using
    }
    lastCheckAt = now
    currentPackage = pkg
    evaluate(pkg)
  }

  private var focusTarget: String? = null
  private var lastReturnAt = 0L

  /**
   * Focus session (mirrors focusDecision in packages/shared): time in the target counts while the
   * user is active there; any other app sends them back, except Mello and NEVER_BLOCK apps.
   * Returns true when it handled the event.
   */
  private fun evaluateFocus(pkg: String, now: Long): Boolean {
    val f = BlockerStore.focus(this) ?: run { focusTarget = null; return false }
    if (focusTarget != f.target) {
      focusTarget = f.target
      focusActiveAt = now
    }
    if (pkg == f.target) {
      val active = now - focusActiveAt <= FOCUS_IDLE_MS
      val counted = if (active) f.elapsedMs + (now - f.countedAt).coerceIn(0L, TICK_MS + 5_000L) else f.elapsedMs
      if (counted >= f.requiredMs) {
        BlockerStore.saveFocus(this, f.copy(elapsedMs = counted, countedAt = now))
        BlockerStore.endFocus(this, completed = true)
        focusTarget = null
        bubble.hide()
        MelloBlockerModule.emitFocusEnded()
        openMello()
        return true
      }
      BlockerStore.saveFocus(this, f.copy(elapsedMs = counted, countedAt = now))
      val left = ((f.requiredMs - counted) / 60_000L) + 1
      val who = BlockerStore.character(this)?.name ?: "Mello"
      if (BlockerStore.bubbleEnabled(this)) bubble.show("$who · $left min left${if (active) "" else " (paused)"}", emptyList())
      return true
    }
    // Time away never counts.
    BlockerStore.saveFocus(this, f.copy(countedAt = now))
    if (pkg == packageName || pkg in BlockerStore.NEVER_BLOCK) {
      bubble.hide()
      return true
    }
    bubble.hide()
    if (now - lastReturnAt < BOUNCE_DEBOUNCE_MS) return true
    lastReturnAt = now
    val launch = packageManager.getLaunchIntentForPackage(f.target)
    if (launch == null) {
      // The app was uninstalled mid-session: end it rather than trapping the user.
      BlockerStore.endFocus(this, completed = false, reason = "app_missing")
      MelloBlockerModule.emitFocusEnded()
      openMello()
      return true
    }
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    startActivity(launch)
    return true
  }

  private fun openMello() {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    startActivity(launch)
  }

  private fun evaluate(pkg: String) {
    if (evaluateFocus(pkg, System.currentTimeMillis())) return
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
    openMello()
  }

  private fun isSystemChrome(pkg: String) =
    pkg == "com.android.systemui" || pkg.contains("inputmethod") || pkg.endsWith(".keyboard")

  override fun onInterrupt() = Unit

  companion object {
    private const val BOUNCE_DEBOUNCE_MS = 1_500L
    private const val CONTENT_CHECK_INTERVAL_MS = 5_000L
    private const val TICK_MS = 30_000L
    /** Same as FOCUS_IDLE_MS in packages/shared. */
    private const val FOCUS_IDLE_MS = 90_000L
    /** Heartbeats further apart than this mean the service was off or the phone was asleep. */
    private const val HEARTBEAT_MAX_GAP_MS = 3 * TICK_MS

    fun minuteOfDay(): Int = Calendar.getInstance().let { it.get(Calendar.HOUR_OF_DAY) * 60 + it.get(Calendar.MINUTE) }

    /** Same rule as inQuietHours in packages/shared, including windows that cross midnight. */
    fun inWindow(start: Int, end: Int, minute: Int): Boolean = when {
      start == end -> false
      start < end -> minute in start until end
      else -> minute >= start || minute < end
    }
  }
}
