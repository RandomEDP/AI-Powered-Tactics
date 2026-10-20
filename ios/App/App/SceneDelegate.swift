import UIKit
import Capacitor
import AppTrackingTransparency

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

    /// Apple's tracking question, asked as soon as Gaffer is first on screen, before Google's ads are ever started (App
    /// Review turned 1.1 down twice because it was only asked just before the first ad, which a reviewer never reaches).
    /// Asked on the main thread, a moment after the app is active: asked any earlier (or while another pop-up is going),
    /// iOS can drop it without showing anything. Once answered iOS never shows it again, and the web app's own ask before
    /// an ad (adSetup in index.html) then has nothing to do.
    func sceneDidBecomeActive(_ scene: UIScene) {
        guard ATTrackingManager.trackingAuthorizationStatus == .notDetermined, !trackingAsked else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            guard let self = self, !self.trackingAsked, UIApplication.shared.applicationState == .active,
                  ATTrackingManager.trackingAuthorizationStatus == .notDetermined else { return }
            self.trackingAsked = true
            ATTrackingManager.requestTrackingAuthorization { status in
                // (it came back without asking, so it wasn't shown: try again next time Gaffer is on screen)
                if status == .notDetermined { DispatchQueue.main.async { self.trackingAsked = false } }
            }
        }
    }
    private var trackingAsked = false

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
