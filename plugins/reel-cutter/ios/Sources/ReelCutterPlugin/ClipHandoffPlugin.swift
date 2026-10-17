import Capacitor
import Foundation

/// A friendly's personal link, handed over to the full app.
///
/// Gaffer's App Clip (ios/App/Clip) keeps the link it was opened with in the app group the two share, and an App Clip
/// link that opens Gaffer once it's installed is kept the same way by SceneDelegate. The web app takes it when it starts
/// and whenever it comes back, opens that game's highlights, and claims the player once they're signed in.
///
///   take() -> { url? }   the kept link, once; then it's forgotten.
@objc(ClipHandoffPlugin)
public class ClipHandoffPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ClipHandoffPlugin"
    public let jsName = "ClipHandoff"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "take", returnType: CAPPluginReturnPromise)
    ]

    // (the same as ClipConfig in the App Clip and SceneDelegate in the app)
    static let group = "group.Com.randomedp.aipoweredtactics"
    static let key = "gaffer.link"

    @objc public func take(_ call: CAPPluginCall) {
        for d in [UserDefaults(suiteName: ClipHandoffPlugin.group), UserDefaults.standard].compactMap({ $0 }) {
            if let s = d.string(forKey: ClipHandoffPlugin.key), !s.isEmpty {
                d.removeObject(forKey: ClipHandoffPlugin.key)
                call.resolve(["url": s])
                return
            }
        }
        call.resolve([:])
    }
}
