// Stand-ins for Capacitor and WatchConnectivity, just enough for the phone's watch plugin
// (plugins/reel-cutter/ios/Sources/ReelCutterPlugin/WatchLinkPlugin.swift) to be compiled and exercised off a phone.
// tests/run.mjs strips the plugin's two imports and its @objc markers, then builds it with this file and main.swift.
import Foundation

public class CAPPluginCall {
    var options: [String: Any]
    var resolved: [String: Any]?
    var rejected: String?
    init(_ options: [String: Any] = [:]) { self.options = options }
    func getString(_ key: String) -> String? { options[key] as? String }
    func getArray<T>(_ key: String, _ type: T.Type) -> [T]? { options[key] as? [T] }
    func resolve(_ data: [String: Any] = [:]) { resolved = data }
    func reject(_ message: String) { rejected = message }
}

open class CAPPlugin: NSObject {
    var told: [[String: Any]] = []           // what the web app was notified of
    private let lock = NSLock()
    public override init() {}
    open func load() {}
    func notifyListeners(_ name: String, data: [String: Any], retainUntilConsumed: Bool) { lock.lock(); told.append(data); lock.unlock() }
}

public protocol CAPBridgedPlugin {}
public struct CAPPluginMethod { init(name: String, returnType: String) {} }
let CAPPluginReturnPromise = "promise"

public enum WCSessionActivationState { case notActivated, inactive, activated }
public protocol WCSessionDelegate: AnyObject {}
public class WCSession {
    public static let `default` = WCSession()
    public static func isSupported() -> Bool { true }
    public weak var delegate: WCSessionDelegate?
    public var activationState: WCSessionActivationState = .activated
    public var isPaired = true, isWatchAppInstalled = true, isReachable = true
    private let lock = NSLock()
    var contexts: [[String: Any]] = [], messages: [[String: Any]] = []
    public func activate() {}
    public func updateApplicationContext(_ context: [String: Any]) throws { lock.lock(); contexts.append(context); lock.unlock() }
    public func sendMessage(_ message: [String: Any], replyHandler: (([String: Any]) -> Void)?, errorHandler: ((Error) -> Void)?) { lock.lock(); messages.append(message); lock.unlock() }
}
