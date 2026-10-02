package expo.modules.melloblocker

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Process
import java.util.Calendar

/** Foreground time per app since local midnight, from Android's UsageStats (needs Usage Access). */
object UsageTracker {
  fun hasAccess(context: Context): Boolean {
    val ops = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
    return mode == AppOpsManager.MODE_ALLOWED
  }

  fun startOfToday(): Long = Calendar.getInstance().apply {
    set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
  }.timeInMillis

  /** Milliseconds in the foreground today, per package. Pairs RESUMED/PAUSED events; an app still open counts until now. */
  fun foregroundMsToday(context: Context, only: Set<String>? = null): Map<String, Long> {
    if (!hasAccess(context)) return emptyMap()
    val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val now = System.currentTimeMillis()
    val events = usm.queryEvents(startOfToday(), now)
    val started = HashMap<String, Long>()
    val total = HashMap<String, Long>()
    val e = UsageEvents.Event()
    while (events.hasNextEvent()) {
      events.getNextEvent(e)
      val pkg = e.packageName ?: continue
      if (only != null && pkg !in only) continue
      when (e.eventType) {
        UsageEvents.Event.ACTIVITY_RESUMED -> started.putIfAbsent(pkg, e.timeStamp)
        UsageEvents.Event.ACTIVITY_PAUSED, UsageEvents.Event.ACTIVITY_STOPPED -> started.remove(pkg)?.let { total[pkg] = (total[pkg] ?: 0L) + (e.timeStamp - it) }
      }
    }
    for ((pkg, since) in started) total[pkg] = (total[pkg] ?: 0L) + (now - since)
    return total
  }

  data class DayUsage(val apps: Map<String, Pair<Long, Int>>, val screenOnMs: Long, val unlocks: Int)

  /**
   * Per-app foreground ms and open counts, screen-on time and unlocks between [from] and [to].
   * Only totals leave this function; the raw event stream never leaves the phone.
   */
  fun usageBetween(context: Context, from: Long, to: Long): DayUsage {
    if (!hasAccess(context)) return DayUsage(emptyMap(), 0L, 0)
    val usm = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val events = usm.queryEvents(from, to)
    val started = HashMap<String, Long>()
    val total = HashMap<String, Long>()
    val opens = HashMap<String, Int>()
    var screenOnSince = -1L
    var screenOnMs = 0L
    var unlocks = 0
    val e = UsageEvents.Event()
    while (events.hasNextEvent()) {
      events.getNextEvent(e)
      when (e.eventType) {
        UsageEvents.Event.ACTIVITY_RESUMED -> e.packageName?.let { pkg ->
          if (started.putIfAbsent(pkg, e.timeStamp) == null) opens[pkg] = (opens[pkg] ?: 0) + 1
        }
        UsageEvents.Event.ACTIVITY_PAUSED, UsageEvents.Event.ACTIVITY_STOPPED -> e.packageName?.let { pkg ->
          started.remove(pkg)?.let { total[pkg] = (total[pkg] ?: 0L) + (e.timeStamp - it) }
        }
        UsageEvents.Event.SCREEN_INTERACTIVE -> if (screenOnSince < 0) screenOnSince = e.timeStamp
        UsageEvents.Event.SCREEN_NON_INTERACTIVE -> if (screenOnSince >= 0) {
          screenOnMs += e.timeStamp - screenOnSince
          screenOnSince = -1
        }
        UsageEvents.Event.KEYGUARD_HIDDEN -> unlocks++
      }
    }
    val end = minOf(to, System.currentTimeMillis())
    for ((pkg, since) in started) total[pkg] = (total[pkg] ?: 0L) + (end - since)
    if (screenOnSince >= 0) screenOnMs += end - screenOnSince
    val apps = (total.keys + opens.keys).associateWith { (total[it] ?: 0L) to (opens[it] ?: 0) }
    return DayUsage(apps, screenOnMs, unlocks)
  }

  fun minutesToday(context: Context, pkg: String): Int = ((foregroundMsToday(context, setOf(pkg))[pkg] ?: 0L) / 60_000L).toInt()
}
