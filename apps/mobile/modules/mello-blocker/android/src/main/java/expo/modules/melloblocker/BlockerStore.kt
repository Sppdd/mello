package expo.modules.melloblocker

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * State shared between the JS module, the accessibility service and the device-admin receiver.
 * Lives in SharedPreferences so enforcement keeps working when the React Native side isn't running.
 */
object BlockerStore {
  private const val PREFS = "mello_blocker"
  private const val KEY_BLOCKED = "blocked_packages"
  private const val KEY_UNLOCKS = "unlocks"
  private const val KEY_PENDING = "pending_app"
  private const val KEY_PENDING_REASON = "pending_reason"
  private const val KEY_LIMITS = "limits"
  private const val KEY_QUIET = "quiet_hours"
  private const val KEY_BUBBLE = "bubble"
  private const val KEY_EVENTS = "events"

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

  fun prefs