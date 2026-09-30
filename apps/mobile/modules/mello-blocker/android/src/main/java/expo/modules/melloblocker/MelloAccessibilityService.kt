package expo.modules.melloblocker

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent

/**
 * Watches which app is in the foreground. When it is a blocked app that is not currently unlocked,
 * Mello is brought to the front with the reading gate. Accessibility services may start activities
 * from the background, which is why this approach works on Android 10+.
 */
class MelloAccessibilityService : AccessibilityService() {
  private var lastBouncedPackage: String? = null
  private var lastBouncedAt = 0L
  private var lastContentCheckAt = 0L

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    val pkg = event?.packageName?.toString() ?: return
    if (pkg == packageName) return

    val now = System.currentTimeMillis()
    // Content-changed events fire constantly while scrolling; check them only every few seconds.
    // They are what re-locks an app whose unlock expires while the kid is still inside it.
    if (event.eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
      if (now - lastContentCheckAt < CONTENT_CHECK_INTERVAL_MS) return
      lastContentCheckAt = now
    }

    if (pkg in BlockerStore.NEVER_BLOCK) return
    if (pkg !in BlockerStore.blocked(this)) return
    if (BlockerStore.isUnlocked(this, pkg)) return
    // Some apps fire several window events while opening; bounce once.
    if (pkg == lastBouncedPackage && now - lastBouncedAt < BOUNCE_DEBOUNCE_MS) return
    lastBouncedPackage = pkg
    lastBouncedAt = now

    BlockerStore.setPending(this, pkg)
    MelloBlockerModule.emitBlocked(pkg)
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    launch.putExtra(EXTRA_BLOCKED_APP, pkg)
    startActivity(launch)
  }

  override fun onInterrupt() = Unit

  companion object {
    const val EXTRA_BLOCKED_APP = "mello_blocked_app"
    private const val BOUNCE_DEBOUNCE_MS = 1_500L
    private const val CONTENT_CHECK_INTERVAL_MS = 5_000L
  }
}
