import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
        connectionOptions.userActivities.forEach { keepClipLink($0.webpageURL) }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        keepClipLink(userActivity.webpageURL)
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    /// An App Clip link (a friendly's personal link) that opened Gaffer instead of the App Clip, because Gaffer is
    /// installed: kept for the web app, which takes it through ClipHandoffPlugin (the same app group and key).
    private func keepClipLink(_ url: URL?) {
        guard let url = url, let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              q.contains(where: { $0.name == "me" }) else { return }
        (UserDefaults(suiteName: "group.Com.randomedp.aipoweredtactics") ?? .standard).set(url.absoluteString, forKey: "gaffer.link")
    }
}
