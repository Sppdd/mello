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

  fun minutesToday(context: Context, pkg: String): Int = ((foregroundMsToday(context, setOf(pkg))[pkg] ?: 0L) / 60_000L).toInt()
}
