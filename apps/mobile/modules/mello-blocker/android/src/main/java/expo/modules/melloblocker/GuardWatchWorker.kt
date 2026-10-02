package expo.modules.melloblocker

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Self mode only: every 15 minutes, if the guard (accessibility service) is off, the user's
 * character asks them to switch it back on, at most [MAX_PER_DAY] times a day. It never tries to
 * stop the user from turning it off; it's their phone.
 */
class GuardWatchWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    val ctx = applicationContext
    val character = BlockerStore.character(ctx) ?: return Result.success()
    if (!character.guardWatch || MelloBlockerModule.isServiceEnabled(ctx)) return Result.success()
    if (!BlockerStore.takeNudge(ctx, MAX_PER_DAY)) return Result.success()
    notify(ctx, character)
    return Result.success()
  }

  private fun notify(ctx: Context, character: BlockerStore.Character) {
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) return
    if (Build.VERSION.SDK_INT >= 26) {
      val nm = ctx.getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "Guard reminders", NotificationManager.IMPORTANCE_DEFAULT))
    }
    val open = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.let {
      PendingIntent.getActivity(ctx, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val text = character.lines["guard_off"] ?: "I'm switched off. Turn me back on when you're ready."
    val n = NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(ctx.applicationInfo.icon)
      .setContentTitle(character.name)
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setContentIntent(open)
      .setAutoCancel(true)
      .build()
    runCatching { NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, n) }
  }

  companion object {
    private const val WORK_NAME = "mello-guard-watch"
    private const val CHANNEL = "mello_guard"
    private const val NOTIFICATION_ID = 4711
    private const val MAX_PER_DAY = 3

    fun schedule(context: Context, enabled: Boolean) {
      val wm = WorkManager.getInstance(context)
      if (!enabled) {
        wm.cancelUniqueWork(WORK_NAME)
        return
      }
      val request = PeriodicWorkRequestBuilder<GuardWatchWorker>(15, TimeUnit.MINUTES).build()
      wm.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
    }
  }
}
