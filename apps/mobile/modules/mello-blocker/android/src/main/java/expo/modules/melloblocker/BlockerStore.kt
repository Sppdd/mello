package expo.modules.melloblocker

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * State shared between the JS module and the accessibility service. Lives in SharedPreferences
 * so the gate keeps working when the React Native side is not running.
 */
object BlockerStore {
  private const val PREFS = "mello_blocker"
  private const val KEY_BLOCKED = "blocked_packages"
  private const val KEY_UNLOCKS = "unlocks"
  private const val KEY_PENDING = "pending_app"

  // Mirrors NEVER_BLOCK in packages/shared: the phone must always be able to call for help.
  val NEVER_BLOCK = setOf(
    "com.android.dialer",
    "com.google.android.dialer",
    "com.android.phone",
    "com.android.emergency",
    "com.google.android.apps.safetyhub",
    "com.android.settings",
  )

  fun prefs(context: Context): SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun setBlocked(context: Context, packages: Collection<String>) {
    prefs(context).edit().putString(KEY_BLOCKED, JSONArray(packages.filterNot { it in NEVER_BLOCK }).toString()).apply()
  }

  fun blocked(context: Context): Set<String> {
    val json = prefs(context).getString(KEY_BLOCKED, "[]") ?: "[]"
    val arr = JSONArray(json)
    return (0 until arr.length()).map { arr.getString(it) }.toSet()
  }

  fun unlock(context: Context, packageName: String, minutes: Int) {
    val unlocks = unlocks(context).toMutableMap()
    val now = System.currentTimeMillis()
    unlocks.entries.removeAll { it.value < now }
    unlocks[packageName] = now + minutes * 60_000L
    prefs(context).edit().putString(KEY_UNLOCKS, JSONObject(unlocks as Map<*, *>).toString()).apply()
  }

  fun unlocks(context: Context): Map<String, Long> {
    val obj = JSONObject(prefs(context).getString(KEY_UNLOCKS, "{}") ?: "{}")
    return obj.keys().asSequence().associateWith { obj.getLong(it) }
  }

  fun isUnlocked(context: Context, packageName: String): Boolean =
    (unlocks(context)[packageName] ?: 0L) > System.currentTimeMillis()

  fun setPending(context: Context, packageName: String?) {
    prefs(context).edit().putString(KEY_PENDING, packageName).apply()
  }

  fun consumePending(context: Context): String? {
    val p = prefs(context).getString(KEY_PENDING, null)
    if (p != null) setPending(context, null)
    return p
  }
}
