import Capacitor
import Foundation
import WatchConnectivity

/// Keeps the Apple Watch app in step with the game on the phone.
///
///   push({ state, seen? })   sends the match (a JSON string) to the watch; the newest one always wins.
///                            `seen` lists the ids of presses the web app has dealt with, so they can be dropped here.
///   pending()                every press from the watch that the web app hasn't yet said it has dealt with, oldest first
///
/// The watch sends goals, whistles and "subs done" back. Each one arrives in the web app as an "event" event:
/// { event } (a JSON string). Each one is also kept here, on disk, until the web app says it has dealt with it:
/// the web view can be asleep in a pocket, reloading, or not loaded yet when the watch speaks, and a press must
/// never be lost to that. The web app asks for `pending()` whenever it wakes.
@objc(WatchLinkPlugin)
public class WatchLinkPlugin: CAPPlugin, CAPBridgedPlugin, WCSessionDelegate {
    public let identifier = "WatchLinkPlugin"
    public let jsName = "WatchLink"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "push", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pending", returnType: CAPPluginReturnPromise)
    ]

    // The watch's messages, the web app's calls and the reply to the watch all arrive on different threads,
    // so everything below is only ever touched on this queue.
    private let turn = DispatchQueue(label: "watchlink.state")
    private var latest: [String: Any]?
    private var inbox: [[String: Any]] = []   // presses from the watch, oldest first: { id, event, got }

    private let saved = "watchlink.latest"
    private let savedInbox = "watchlink.inbox"
    private static let keepFor: Double = 12 * 60 * 60 * 1000   // a press nobody has dealt with after half a day is dropped
    private static let keepMost = 400

    override public func load() {
        let store = UserDefaults.standard
        let now = Date().timeIntervalSince1970 * 1000
        turn.sync {
            // The last game sent is kept, so a watch that asks while the app is only just waking up still gets an answer.
            // It keeps the time it was really sent, so the watch can tell it is old news if it has heard anything since.
            if let state = store.string(forKey: saved) { latest = ["state": state, "sent": store.double(forKey: saved + ".sent")] }
            let kept = (store.array(forKey: savedInbox) as? [[String: Any]]) ?? []
            inbox = kept.filter { ($0["id"] as? String) != nil && ($0["event"] as? String) != nil && now - (($0["got"] as? Double) ?? 0) < WatchLinkPlugin.keepFor }
        }
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    @objc public func push(_ call: CAPPluginCall) {
        guard let state = call.getString("state") else {
            call.reject("No game to send")
            return
        }
        let seen = Set(call.getArray("seen", String.self) ?? [])
        // "sent" lets the watch ignore anything older than what it already has, and makes every update count as new
        let sent = Date().timeIntervalSince1970 * 1000
        turn.sync {
            latest = ["state": state, "sent": sent]
            UserDefaults.standard.set(state, forKey: saved)
            UserDefaults.standard.set(sent, forKey: saved + ".sent")
            if !seen.isEmpty { // the web app has dealt with these: they needn't be kept any longer
                let before = inbox.count
                inbox.removeAll { seen.contains(($0["id"] as? String) ?? "") }
                if inbox.count != before { UserDefaults.standard.set(inbox, forKey: savedInbox) }
            }
        }
        call.resolve(["sent": deliver()])
    }

    @objc public func pending(_ call: CAPPluginCall) {
        let events: [String] = turn.sync { inbox.compactMap { $0["event"] as? String } }
        call.resolve(["events": events])
    }

    @discardableResult
    private func deliver() -> Bool {
        guard WCSession.isSupported() else { return false }
        let newest: [String: Any]? = turn.sync { latest }
        guard let payload = newest else { return false }
        let session = WCSession.default
        guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return false }
        try? session.updateApplicationContext(payload) // waits for the watch if it's out of reach
        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil, errorHandler: nil) // straight away when it's on the wrist
        }
        return true
    }

    /// Puts a press from the watch on disk, unless it is a repeat of one already waiting.
    private func keep(_ event: String) {
        guard let data = event.data(using: .utf8),
              let fields = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let id = fields["id"] as? String, !id.isEmpty else { return }
        let now = Date().timeIntervalSince1970 * 1000
        turn.sync {
            if inbox.contains(where: { ($0["id"] as? String) == id }) { return }
            inbox.append(["id": id, "event": event, "got": now])
            inbox.removeAll { now - (($0["got"] as? Double) ?? 0) >= WatchLinkPlugin.keepFor }
            if inbox.count > WatchLinkPlugin.keepMost { inbox.removeFirst(inbox.count - WatchLinkPlugin.keepMost) }
            UserDefaults.standard.set(inbox, forKey: savedInbox)
        }
    }

    private func received(_ message: [String: Any]) {
        guard let event = message["event"] as? String else { return }
        if event.contains("\"hello\"") {
            deliver() // the watch app has just opened and wants the current game
            return
        }
        keep(event) // first, so it is safe whatever the web view is doing
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

    public func sessionReachabilityDidChange(_ session: WCSession) {
        deliver() // the watch app has just come into reach: send the game straight away
    }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        received(message)
    }

    /// The watch asks for an answer so it knows the phone really has its press; the answer carries the current game too.
    /// The press is on disk before the answer goes back.
    public func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        received(message)
        let newest: [String: Any]? = turn.sync { latest }
        var answer: [String: Any] = newest ?? [:]
        answer["ok"] = true
        replyHandler(answer)
    }

    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        received(userInfo)
    }
}
