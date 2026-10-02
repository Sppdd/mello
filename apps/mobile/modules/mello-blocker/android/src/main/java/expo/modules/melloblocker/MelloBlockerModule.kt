package expo.modules.melloblocker

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.text.TextUtils
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

class MelloBlockerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context is not available")

  override fun definition() = ModuleDefinition {
    Name("MelloBlocker")
    Events("onBlockedAppOpened")

    OnCreate { instance = WeakReference(this@MelloBlockerModule) }
    OnDestroy { if (instance?.get() === this@MelloBlockerModule) instance = null }

    Function("isSupported") { true }

    Function("isServiceEnabled") {
      val expected = ComponentName(context, MelloAccessibilityService::class.java).flattenToString()
      val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
      val splitter = TextUtils.SimpleStringSplitter(':').apply { setString(enabled) }
      splitter.any { it.equals(expected, ignoreCase = true) }
    }

    Function("openServiceSettings") {
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    AsyncFunction("getInstalledApps") {
      val pm = context.packageManager
      val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      pm.queryIntentActivities(launcher, 0)
        .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
        .filter { (pkg, _) -> pkg != context.packageName }
        .distinctBy { it.first }
        .sortedBy { it.second.lowercase() }
        .map { (pkg, label) -> mapOf("packageName" to pkg, "label" to label) }
    }

    Function("setBlockedPackages") { packages: List<String> ->
      BlockerStore.setBlocked(context, packages)
    }

    Function("unlock") { packageName: String, minutes: Int ->
      BlockerStore.unlock(context, packageName, minutes)
    }

    Function("getUnlocks") {
      BlockerStore.unlocks(context)
    }

    /** Returns {packageName, reason} ("rule" | "limit" | "bedtime") once, or null. */
    Function("consumePendingBlockedApp") {
      BlockerStore.consumePending(context)?.let { (pkg, reason) -> mapOf("packageName" to pkg, "reason" to reason) }
    }

    Function("setLimits") { limits: Map<String, Int> ->
      BlockerStore.setLimits(context, limits)
    }

    /** startMinute/endMinute are minutes after local midnight; pass enabled=false to clear bedtime. */
    Function("setQuietHours") { enabled: Boolean, startMinute: Int, endMinute: Int, allowed: List<String> ->
      BlockerStore.setQuietHours(context, if (enabled) BlockerStore.QuietHours(startMinute, endMinute, allowed.toSet()) else null)
    }

    Function("setBubble") { enabled: Boolean, lines: List<String> ->
      BlockerStore.setBubble(context, enabled, lines)
    }

    Function("isUsageAccessGranted") { UsageTracker.hasAccess(context) }

    Function("openUsageAccessSettings") {
      context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** Minutes in the foreground today per app (only apps used today). Empty without Usage Access. */
    AsyncFunction("getUsageToday") {
      UsageTracker.foregroundMsToday(context).mapValues { (_, ms) -> (ms / 60_000L).toInt() }.filterValues { it > 0 }
    }

    Function("launchApp") { packageName: String ->
      val intent = context.packageManager.getLaunchIntentForPackage(packageName) ?: return@Function false
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      true
    }
  }

  companion object {
    private var instance: WeakReference<MelloBlockerModule>? = null

    /** Called by the accessibility service; reaches JS only if the app is running. */
    fun emitBlocked(packageName: String, reason: String) {
      instance?.get()?.sendEvent("onBlockedAppOpened", mapOf("packageName" to packageName, "reason" to reason))
    }
  }
}
