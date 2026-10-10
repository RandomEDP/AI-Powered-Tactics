import Capacitor
import Foundation
import WatchConnectivity

/// Keeps the Apple Watch app in step with the game on the phone.
///
///   push({ state })   sends the match (a JSON string) to the watch; the newest one always wins
/// The watch sends goals and highlights back, which arrive as "event" events: { event } (a JSON string).
@objc(WatchLinkPlugin)
public class WatchLinkPlugin: CAPPlugin, CAPBridgedPlugin, WCSessionDelegate {
    public let identifier = "WatchLinkPlugin"
    public let jsName = "WatchLink"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "push", returnType: CAPPluginReturnPromise)
    ]

    private var latest: [String: Any]?

    override public func load() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    @objc public func push(_ call: CAPPluginCall) {
        guard let state = call.getString("state") else {
            call.reject("No game to send")
            return
        }
        latest = ["state": state]
        call.resolve(["sent": deliver()])
    }

    @discardableResult
    private func deliver() -> Bool {
        guard WCSession.isSupported(), let payload = latest else { return false }
        let session = WCSession.default
        guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return false }
        try? session.updateApplicationContext(payload) // waits for the watch if it's out of reach
        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil, errorHandler: nil) // straight away when it's on the wrist
        }
        return true
    }

    private func received(_ message: [String: Any]) {
        guard let event = message["event"] as? String else { return }
        if event.contains("\"hello\"") {
            deliver() // the watch app has just opened and wants the current game
            return
        }
        notifyListeners("event", data: ["event": event], retainUntilConsumed: true)
    }

    public func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        deliver()
    }

    public func sessionDidBecomeInactive(_ session: WCSession) {}

    public func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate() // the person switched to another watch
    }

    public func sessionWatchStateDidChange(_ session: WCSession) {
        deliver()
    }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        received(message)
    }

    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        received(userInfo)
    }
}
