package expo.modules.melloblocker

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
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
    Events("onBlockedAppOpened", "onFocusEnded")

    OnCreate { instance = WeakReference(this@MelloBlockerModule) }
    OnDestroy { if (instance?.get() === this@MelloBlockerModule) instance = null }

    Function("isSupported") { true }

    Function("isServiceEnabled") { isServiceEnabled(context) }

    Function("openServiceSettings") {
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    AsyncFunction("getInstalledApps") {
      val pm = context.packageManager
      val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      pm.queryIntentActivities(launcher, 0)
        .filter { it.activityInfo.packageName != context.packageName }
        .distinctBy { it.activityInfo.packageName }
        .map { info ->
          // ApplicationInfo.category (API 26+): JS maps it to social/video/reading/… with categoryFor().
          val category = if (Build.VERSION.SDK_INT >= 26) info.activityInfo.applicationInfo.category else -1
          mapOf("packageName" to info.activityInfo.packageName, "label" to info.loadLabel(pm).toString(), "androidCategory" to category)
        }
        .sortedBy { (it["label"] as String).lowercase() }
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

    // ----- focus sessions -----
    /** Starts keeping the user in [packageName] for [minutes]; JS then opens the app with launchApp. */
    Function("startFocus") { packageName: String, label: String, minutes: Int, gatedApp: String? ->
      BlockerStore.startFocus(context, packageName, label, minutes, gatedApp)
    }

    Function("getFocus") { BlockerStore.focus(context)?.toMap() }

    /** The user's way out. The app adds friction before calling this, and it is logged. */
    Function("breakGlass") {
      BlockerStore.endFocus(context, completed = false, reason = "break_glass")
    }

    Function("consumeFocusResult") { BlockerStore.consumeFocusResult(context) }

    // ----- self mode: character, daily usage, guard heartbeat -----
    /** lines: event -> text for the bubble and notifications, already in the character's voice. */
    Function("setCharacter") { name: String, color: String, lines: Map<String, String>, guardWatch: Boolean ->
      BlockerStore.setCharacter(context, BlockerStore.Character(name, color, lines, guardWatch))
      GuardWatchWorker.schedule(context, guardWatch)
    }

    /** Per-app minutes and opens, screen-on minutes and unlocks between two times (epoch ms). */
    AsyncFunction("getUsageBetween") { from: Double, to: Double ->
      val u = UsageTracker.usageBetween(context, from.toLong(), to.toLong())
      mapOf(
        "apps" to u.apps.map { (pkg, v) -> mapOf("packageName" to pkg, "minutes" to (v.first / 60_000L).toInt(), "opens" to v.second) },
        "screenOnMinutes" to (u.screenOnMs / 60_000L).toInt(),
        "unlocks" to u.unlocks,
      )
    }

    Function("getGuardStatus") {
      mapOf(
        "guardMinutesToday" to (BlockerStore.guardMsToday(context) / 60_000L).toInt(),
        "breakGlassToday" to BlockerStore.breakGlassToday(context),
      )
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

    fun emitFocusEnded() {
      instance?.get()?.sendEvent("onFocusEnded", emptyMap<String, Any>())
    }

    fun isServiceEnabled(context: Context): Boolean {
      val expected = ComponentName(context, MelloAccessibilityService::class.java).flattenToString()
      val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
      val splitter = TextUtils.SimpleStringSplitter(':').apply { setString(enabled) }
      return splitter.any { it.equals(expected, ignoreCase = true) }
    }
  }
}
