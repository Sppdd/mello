package expo.modules.melloblocker

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * State shared between the JS module and the accessibility service. Lives in SharedPreferences
 * so the family's rules keep working when the React Native side is not running.
 */
object BlockerStore {
  private const val PREFS = "mello_blocker"
  private const val KEY_BLOCKED = "blocked_packages"
  private const val KEY_UNLOCKS = "unlocks"
  private const val KEY_PENDING = "pending_app"
  private const val KEY_PENDING_REASON = "pending_reason"
  private const val KEY_LIMITS = "limits"
  private const val KEY_QUIET = "quiet_hours"
  private const val KEY_BUBBLE_ENABLED = "bubble_enabled"
  private const val KEY_BUBBLE_LINES = "bubble_lines"

  // Mirrors NEVER_BLOCK in packages/shared: the phone must always be able to call for help.
  val NEVER_BLOCK = setOf(
    "com.android.dialer",
    "com.google.android.dialer",
    "com.android.phone",
    "com.android.emergency",
    "com.google.android.apps.safetyhub",
    "com.android.settings",
    "com.android.systemui",
  )

  data class QuietHours(val start: Int, val end: Int, val allowed: Set<String>)

  fun prefs(context: Context): SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  // ----- read-first rules -----
  fun setBlocked(context: Context, packages: Collection<String>) {
    prefs(context).edit().putString(KEY_BLOCKED, JSONArray(packages.filterNot { it in NEVER_BLOCK }).toString()).apply()
  }

  fun blocked(context: Context): Set<String> = stringSet(prefs(context).getString(KEY_BLOCKED, "[]"))

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

  fun unlockedUntil(context: Context, packageName: String): Long = unlocks(context)[packageName] ?: 0L

  // ----- daily limits (minutes per app) and bedtime -----
  fun setLimits(context: Context, limits: Map<String, Int>) {
    prefs(context).edit().putString(KEY_LIMITS, JSONObject(limits as Map<*, *>).toString()).apply()
  }

  fun limits(context: Context): Map<String, Int> {
    val obj = JSONObject(prefs(context).getString(KEY_LIMITS, "{}") ?: "{}")
    return obj.keys().asSequence().associateWith { obj.getInt(it) }
  }

  /** null clears bedtime. */
  fun setQuietHours(context: Context, q: QuietHours?) {
    val value = q?.let { JSONObject().put("start", it.start).put("end", it.end).put("allowed", JSONArray(it.allowed.toList())).toString() }
    prefs(context).edit().putString(KEY_QUIET, value).apply()
  }

  fun quietHours(context: Context): QuietHours? {
    val raw = prefs(context).getString(KEY_QUIET, null) ?: return null
    val o = JSONObject(raw)
    return QuietHours(o.getInt("start"), o.getInt("end"), stringSet(o.getJSONArray("allowed").toString()))
  }

  // ----- hand-off from the service to the app -----
  fun setPending(context: Context, packageName: String?, reason: String? = null) {
    prefs(context).edit().putString(KEY_PENDING, packageName).putString(KEY_PENDING_REASON, reason).apply()
  }

  /** Returns (packageName, reason) once, then clears it. */
  fun consumePending(context: Context): Pair<String, String>? {
    val p = prefs(context)
    val pkg = p.getString(KEY_PENDING, null) ?: return null
    val reason = p.getString(KEY_PENDING_REASON, null) ?: "rule"
    setPending(context, null)
    return pkg to reason
  }

  // ----- floating bubble -----
  fun setBubble(context: Context, enabled: Boolean, lines: List<String>) {
    prefs(context).edit().putBoolean(KEY_BUBBLE_ENABLED, enabled).putString(KEY_BUBBLE_LINES, JSONArray(lines).toString()).apply()
  }

  fun bubbleEnabled(context: Context) = prefs(context).getBoolean(KEY_BUBBLE_ENABLED, true)

  fun bubbleLines(context: Context): List<String> = stringSet(prefs(context).getString(KEY_BUBBLE_LINES, "[]")).toList()

  private fun stringSet(json: String?): Set<String> {
    val arr = JSONArray(json ?: "[]")
    return (0 until arr.length()).map { arr.getString(it) }.toCollection(LinkedHashSet())
  }
}
