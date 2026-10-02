import ExpoModulesCore

// iOS does not let one app watch or cover another. The iOS gate will use Screen Time instead:
// FamilyControls (authorization + app picker), ManagedSettings (shields) and DeviceActivity
// (re-shield when an unlock expires), plus ShieldConfiguration/ShieldAction app extensions.
// That needs Apple's Family Controls entitlement, so until it is granted this module reports
// "not supported" and the app runs in reading-only mode on iPhone. See docs/ARCHITECTURE.md.
public class MelloBlockerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MelloBlocker")
    Events("onBlockedAppOpened")

    Function("isSupported") { false }
    Function("isServiceEnabled") { false }
    Function("openServiceSettings") {}
    AsyncFunction("getInstalledApps") { () -> [[String: String]] in [] }
    Function("setBlockedPackages") { (_: [String]) in }
    Function("setLimits") { (_: [String: Int]) in }
    Function("setQuietHours") { (_: Bool, _: Int, _: Int, _: [String]) in }
    Function("setBubble") { (_: Bool, _: [String]) in }
    Function("isUsageAccessGranted") { false }
    Function("openUsageAccessSettings") {}
    AsyncFunction("getUsageToday") { () -> [String: Int] in [:] }
    Function("unlock") { (_: String, _: Int) in }
    Function("getUnlocks") { () -> [String: Double] in [:] }
    Function("consumePendingBlockedApp") { () -> [String: String]? in nil }
    Function("launchApp") { (_: String) -> Bool in false }
  }
}
