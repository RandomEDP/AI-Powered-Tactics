import Capacitor
import Foundation
import StoreKit
import UIKit

/// Reviews on the App Store.
///
///   ask()           -> {}             Apple's own "Enjoying Gaffer?" stars. iOS decides whether it shows (at most three
///                                     times a year, never in TestFlight), so the app only asks once, after a good moment.
///   write({ id })   -> { opened }     opens Gaffer's page in the App Store on "Write a Review". `id` is the App Store id
///                                     if the app knows it; otherwise it's looked up from the bundle id and kept.
@objc(AppReviewPlugin)
public class AppReviewPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppReviewPlugin"
    public let jsName = "AppReview"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ask", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise)
    ]

    static let kept = "appreview.id"

    @objc public func ask(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let scene = self.bridge?.viewController?.view.window?.windowScene
                ?? UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else {
                call.reject("Couldn't ask for a review just now")
                return
            }
            if #available(iOS 16.0, *) {
                AppStore.requestReview(in: scene)
            } else {
                SKStoreReviewController.requestReview(in: scene)
            }
            call.resolve()
        }
    }

    @objc public func write(_ call: CAPPluginCall) {
        let given = (call.getString("id") ?? "").filter(\.isNumber)
        let known = given.isEmpty ? (UserDefaults.standard.string(forKey: Self.kept) ?? "") : given
        if !known.isEmpty { open(known, call); return }
        lookUp { id in
            guard let id = id else {
                call.reject("Couldn't find Gaffer in the App Store just now. Check you've got signal, or search for Gaffer in the App Store and leave a review there.")
                return
            }
            UserDefaults.standard.set(id, forKey: Self.kept)
            self.open(id, call)
        }
    }

    private func open(_ id: String, _ call: CAPPluginCall) {
        guard let url = URL(string: "https://apps.apple.com/app/id\(id)?action=write-review") else {
            call.reject("Couldn't open the App Store")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { ok in
                if ok { call.resolve(["opened": true]) } else { call.reject("Couldn't open the App Store") }
            }
        }
    }

    /// Asks Apple's public lookup for this app's id, in the phone's own country first (an app only listed in the UK isn't
    /// found in the US store, the default), then the UK and the US.
    private func lookUp(_ done: @escaping (String?) -> Void) {
        guard let bundle = Bundle.main.bundleIdentifier else { done(nil); return }
        var countries = ["gb", "us"]
        if let here = Locale.current.regionCode?.lowercased() { countries.removeAll { $0 == here }; countries.insert(here, at: 0) }
        func next(_ i: Int) {
            guard i < countries.count,
                  let url = URL(string: "https://itunes.apple.com/lookup?bundleId=\(bundle)&country=\(countries[i])") else { done(nil); return }
            URLSession.shared.dataTask(with: url) { data, _, _ in
                if let data = data,
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let first = (json["results"] as? [[String: Any]])?.first,
                   let id = first["trackId"] as? NSNumber {
                    done(id.stringValue)
                } else {
                    next(i + 1)
                }
            }.resume()
        }
        next(0)
    }
}
