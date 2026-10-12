import Capacitor
import Foundation
import UserNotifications

/// Keeps a team's chat notifications quiet while that chat is open on screen: you're already reading it.
///
///   quiet({ code })   the chat of the team with this code is open now
///   quiet({})         no chat is open
///
/// It sits between Capacitor's notification router and the push plugin's own handler. Everything is still passed on,
/// so the web app still hears about the message (and pulls it in); only the banner and sound are left off, and only
/// for a chat message to the team whose chat is open. iOS asks this only while the app is in front, so a phone in a
/// pocket with the chat left open still gets the notification as usual.
@objc(ChatQuietPlugin)
public class ChatQuietPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ChatQuietPlugin"
    public let jsName = "ChatQuiet"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "quiet", returnType: CAPPluginReturnPromise)
    ]

    private var gate: ChatQuietGate?   // the router only holds it weakly, so it is kept here

    @objc public func quiet(_ call: CAPPluginCall) {
        let code = (call.getString("code") ?? "").trimmingCharacters(in: .whitespaces).uppercased()
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            ChatQuietGate.open = code
            if self.gate == nil, let router = self.bridge?.notificationRouter, let inner = router.pushNotificationHandler {
                // put in front of the push plugin's handler (only once it has set itself up, and never in front of itself)
                if !(inner is ChatQuietGate) {
                    let gate = ChatQuietGate(inner)
                    self.gate = gate
                    router.pushNotificationHandler = gate
                }
            }
            call.resolve(["quiet": code, "ready": self.gate != nil])
        }
    }
}

/// Passes every notification on to the push plugin, then drops the banner and sound for the open chat's messages.
public class ChatQuietGate: NSObject, NotificationHandlerProtocol {
    // the team code whose chat is on screen ("" for none); set from the web app's calls, read on whatever thread iOS asks on
    private static let lock = NSLock()
    private static var openCode = ""
    static var open: String {
        get { lock.lock(); defer { lock.unlock() }; return openCode }
        set { lock.lock(); openCode = newValue; lock.unlock() }
    }
    private let inner: NotificationHandlerProtocol

    init(_ inner: NotificationHandlerProtocol) { self.inner = inner }

    public func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions {
        let shown = inner.willPresent(notification: notification)   // also tells the web app, which pulls the message in
        let info = notification.request.content.userInfo
        let kind = info["kind"] as? String ?? "", code = (info["code"] as? String ?? "").uppercased()
        if kind == "chat", !code.isEmpty, code == ChatQuietGate.open { return [] }
        return shown
    }

    public func didReceive(response: UNNotificationResponse) {
        inner.didReceive(response: response)
    }
}
