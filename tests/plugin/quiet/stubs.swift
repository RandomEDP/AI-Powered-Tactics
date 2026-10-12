// Stand-ins for Capacitor's notification router and the UserNotifications types, just enough for
// plugins/reel-cutter/ios/Sources/ReelCutterPlugin/ChatQuietPlugin.swift to be built and exercised off a phone (tests/run.mjs).
import Foundation
public class CAPPluginCall { var o: [String: Any]; var res: [String: Any]?; init(_ o: [String: Any]) { self.o = o }
  func getString(_ k: String) -> String? { o[k] as? String }; func resolve(_ d: [String: Any] = [:]) { res = d } }
public protocol NotificationHandlerProtocol: AnyObject { func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions; func didReceive(response: UNNotificationResponse) }
public class NotificationRouter { public weak var pushNotificationHandler: NotificationHandlerProtocol? }
public class Bridge { var notificationRouter = NotificationRouter() }
open class CAPPlugin: NSObject { var bridge: Bridge? = Bridge() }
public protocol CAPBridgedPlugin {}
public struct CAPPluginMethod { init(name: String, returnType: String) {} }
let CAPPluginReturnPromise = "p"
public struct UNNotificationPresentationOptions: OptionSet { public let rawValue: Int; public init(rawValue: Int) { self.rawValue = rawValue }
  static let banner = UNNotificationPresentationOptions(rawValue: 1); static let sound = UNNotificationPresentationOptions(rawValue: 2) }
public class UNNotificationContent { var userInfo: [AnyHashable: Any]; init(_ u: [AnyHashable: Any]) { userInfo = u } }
public class UNNotificationRequest { var content: UNNotificationContent; init(_ u: [AnyHashable: Any]) { content = UNNotificationContent(u) } }
public class UNNotification: NSObject { var request: UNNotificationRequest; init(_ u: [AnyHashable: Any]) { request = UNNotificationRequest(u) } }
public class UNNotificationResponse: NSObject {}
