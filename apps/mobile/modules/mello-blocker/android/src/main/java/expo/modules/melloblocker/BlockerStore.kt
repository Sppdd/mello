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
  private const val KEY_FOCUS = "focus"
  private const val KEY_FOCUS_RESULT = "focus_result"
  private const val KEY_CHARACTER = "character"
  private const val KEY_HEARTBEAT = "heartbeat"
  private const val KEY_GUARD_DAY = "guard_day"
  private const val KEY_GUARD_MS = "guard_ms"
  private const val KEY_BREAK_GLASS_DAY = "break_glass_day"
  private const val KEY_BREAK_GLASS_COUNT = "break_glass_count"
  private const val KEY_NUDGE_DAY = "nudge_day"
  private const val KEY_NUDGE_COUNT = "nudge_count"

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

  // ----- focus sessions: stay in one app (e.g. ReadEra) for N minutes -----
  data class Focus(
    val target: String,
    val label: String,
    val requiredMs: Long,
    val elapsedMs: Long,
    /** Last time time was counted (or the user was elsewhere); the next count starts here. */
    val countedAt: Long,
    val startedAt: Long,
    val gatedApp: String?,
  ) {
    fun toJson(): String = JSONObject()
      .put("target", target).put("label", label).put("requiredMs", requiredMs).put("elapsedMs", elapsedMs)
      .put("countedAt", countedAt).put("startedAt", startedAt).put("gatedApp", gatedApp ?: JSONObject.NULL)
      .toString()

    fun toMap(): Map<String, Any?> = mapOf(
      "target" to target, "label" to label, "requiredMs" to requiredMs.toDouble(), "elapsedMs" to elapsedMs.toDouble(),
      "startedAt" to startedAt.toDouble(), "gatedApp" to gatedApp,
    )
  }

  fun startFocus(context: Context, target: String, label: String, minutes: Int, gatedApp: String?) {
    if (target in NEVER_BLOCK) return
    val now = System.currentTimeMillis()
    saveFocus(context, Focus(target, label, minutes * 60_000L, 0L, now, now, gatedApp))
  }

  fun saveFocus(context: Context, f: Focus) {
    prefs(context).edit().putString(KEY_FOCUS, f.toJson()).apply()
  }

  fun focus(context: Context): Focus? {
    val raw = prefs(context).getString(KEY_FOCUS, null) ?: return null
    return runCatching {
      val o = JSONObject(raw)
      Focus(
        o.getString("target"), o.optString("label", o.getString("target")), o.getLong("requiredMs"), o.getLong("elapsedMs"),
        o.getLong("countedAt"), o.getLong("startedAt"), if (o.isNull("gatedApp")) null else o.getString("gatedApp"),
      )
    }.getOrNull()
  }

  /** Ends the session and leaves a result for the app to pick up once. */
  fun endFocus(context: Context, completed: Boolean, reason: String? = null) {
    val f = focus(context) ?: return
    val result = JSONObject(f.toJson()).put("completed", completed).put("endedAt", System.currentTimeMillis()).put("reason", reason ?: JSONObject.NULL)
    val edit = prefs(context).edit().remove(KEY_FOCUS).putString(KEY_FOCUS_RESULT, result.toString())
    if (!completed) {
      val day = today()
      val p = prefs(context)
      val count = if (p.getString(KEY_BREAK_GLASS_DAY, null) == day) p.getInt(KEY_BREAK_GLASS_COUNT, 0) else 0
      edit.putString(KEY_BREAK_GLASS_DAY, day).putInt(KEY_BREAK_GLASS_COUNT, count + 1)
    }
    edit.apply()
  }

  fun consumeFocusResult(context: Context): Map<String, Any?>? {
    val raw = prefs(context).getString(KEY_FOCUS_RESULT, null) ?: return null
    prefs(context).edit().remove(KEY_FOCUS_RESULT).apply()
    val o = JSONObject(raw)
    return mapOf(
      "target" to o.getString("target"),
      "label" to o.optString("label"),
      "elapsedMs" to o.getLong("elapsedMs").toDouble(),
      "requiredMs" to o.getLong("requiredMs").toDouble(),
      "completed" to o.getBoolean("completed"),
      "gatedApp" to if (o.isNull("gatedApp")) null else o.getString("gatedApp"),
      "reason" to if (o.isNull("reason")) null else o.getString("reason"),
    )
  }

  fun breakGlassToday(context: Context): Int =
    prefs(context).let { if (it.getString(KEY_BREAK_GLASS_DAY, null) == today()) it.getInt(KEY_BREAK_GLASS_COUNT, 0) else 0 }

  // ----- the character speaking in the bubble and notifications (sent from JS) -----
  data class Character(val name: String, val color: String, val lines: Map<String, String>, val guardWatch: Boolean)

  fun setCharacter(context: Context, c: Character) {
    val o = JSONObject().put("name", c.name).put("color", c.color).put("lines", JSONObject(c.lines as Map<*, *>)).put("guardWatch", c.guardWatch)
    prefs(context).edit().putString(KEY_CHARACTER, o.toString()).apply()
  }

  fun character(context: Context): Character? {
    val raw = prefs(context).getString(KEY_CHARACTER, null) ?: return null
    return runCatching {
      val o = JSONObject(raw)
      val lines = o.getJSONObject("lines")
      Character(o.getString("name"), o.getString("color"), lines.keys().asSequence().associateWith { lines.getString(it) }, o.optBoolean("guardWatch"))
    }.getOrNull()
  }

  // ----- guard heartbeat: how long the service was running today -----
  /** Called on every service tick. Gaps longer than [maxGapMs] (service off, phone asleep) aren't counted. */
  fun heartbeat(context: Context, now: Long, maxGapMs: Long) {
    val p = prefs(context)
    val day = today()
    val last = p.getLong(KEY_HEARTBEAT, 0L)
    var ms = if (p.getString(KEY_GUARD_DAY, null) == day) p.getLong(KEY_GUARD_MS, 0L) else 0L
    val gap = now - last
    if (last > 0 && gap in 1..maxGapMs && last >= UsageTracker.startOfToday()) ms += gap
    p.edit().putLong(KEY_HEARTBEAT, now).putString(KEY_GUARD_DAY, day).putLong(KEY_GUARD_MS, ms).apply()
  }

  fun guardMsToday(context: Context): Long =
    prefs(context).let { if (it.getString(KEY_GUARD_DAY, null) == today()) it.getLong(KEY_GUARD_MS, 0L) else 0L }

  /** Counts guard-off notifications so we nudge at most a few times a day. Returns false once the cap is hit. */
  fun takeNudge(context: Context, maxPerDay: Int): Boolean {
    val p = prefs(context)
    val day = today()
    val count = if (p.getString(KEY_NUDGE_DAY, null) == day) p.getInt(KEY_NUDGE_COUNT, 0) else 0
    if (count >= maxPerDay) return false
    p.edit().putString(KEY_NUDGE_DAY, day).putInt(KEY_NUDGE_COUNT, count + 1).apply()
    return true
  }

  private fun today(): String = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())

  private fun stringSet(json: String?): Set<String> {
    val arr = JSONArray(json ?: "[]")
    return (0 until arr.length()).map { arr.getString(it) }.toCollection(LinkedHashSet())
  }
}
