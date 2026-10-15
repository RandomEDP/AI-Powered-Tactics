import Capacitor
import Foundation
import StoreKit

/// The team pass, bought through Apple (StoreKit 2). Both products are one-off purchases for the whole team: the web app
/// sends each one to Gaffer's server (the team-pass edge function, which checks it with Apple) and only then calls
/// finish, so a purchase is never lost if the signal drops or the app is closed half way.
///
///   products({ ids })          -> { products: [{ id, price, title }] }   price as Apple shows it on this phone ("£4.99")
///   buy({ id, account })       -> { status: "bought", transactionId, productId, environment } | { status: "cancelled" } | { status: "pending" }
///                                 account: the signed-in account's id (a UUID), kept on the purchase so only they can claim it
///   unfinished()               -> { list: [{ transactionId, productId, account, environment }] }  bought, not yet counted
///   finish({ transactionId })  -> { finished }
///   owned({ sync })            -> { list: [{ transactionId, productId, account, environment }] }  what this Apple ID owns
///                                 for good (the commentary voices); sync true asks Apple first ("Restore purchases")
///   event "transaction"        -> { transactionId, productId, account, environment }  one that arrived later (Ask to Buy, a retry)
@objc(TeamPassPlugin)
public class TeamPassPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TeamPassPlugin"
    public let jsName = "TeamPass"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "buy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unfinished", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "owned", returnType: CAPPluginReturnPromise)
    ]

    private var updates: Task<Void, Never>?

    override public func load() {
        updates = Task.detached { [weak self] in
            for await result in Transaction.updates {
                guard case .verified(let t) = result else { continue }
                self?.notifyListeners("transaction", data: TeamPassPlugin.describe(t))
            }
        }
    }

    deinit { updates?.cancel() }

    static func environment(_ t: Transaction) -> String {
        if #available(iOS 16.0, *) { return t.environment.rawValue } // "Production", "Sandbox" or "Xcode"
        return t.environmentStringRepresentation
    }

    static func describe(_ t: Transaction) -> [String: Any] {
        return [
            "transactionId": String(t.id),
            "productId": t.productID,
            "account": t.appAccountToken?.uuidString.lowercased() ?? "",
            "environment": environment(t)
        ]
    }

    @objc public func products(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids") as? [String]) ?? []
        Task {
            do {
                let found = try await Product.products(for: ids)
                call.resolve(["products": found.map { ["id": $0.id, "price": $0.displayPrice, "title": $0.displayName] }])
            } catch {
                call.reject("Couldn't reach the App Store. Check your signal and try again.")
            }
        }
    }

    @objc public func buy(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let account = UUID(uuidString: call.getString("account") ?? "") else {
            call.reject("Sign in first, so the team knows who paid.")
            return
        }
        Task {
            do {
                guard let product = try await Product.products(for: [id]).first else {
                    call.reject("The App Store doesn't have that yet. Try again later.")
                    return
                }
                switch try await product.purchase(options: [.appAccountToken(account)]) {
                case .success(.verified(let t)):
                    var out = TeamPassPlugin.describe(t)
                    out["status"] = "bought"
                    call.resolve(out)
                case .success(.unverified(_, _)):
                    call.reject("Apple couldn't confirm that purchase on this phone. You haven't been charged twice: try again later.")
                case .userCancelled:
                    call.resolve(["status": "cancelled"])
                case .pending:
                    call.resolve(["status": "pending"]) // waiting on Ask to Buy or the bank; it comes later as "transaction"
                @unknown default:
                    call.resolve(["status": "cancelled"])
                }
            } catch {
                call.reject("The App Store said: \(error.localizedDescription)")
            }
        }
    }

    @objc public func unfinished(_ call: CAPPluginCall) {
        Task {
            var list: [[String: Any]] = []
            for await result in Transaction.unfinished {
                if case .verified(let t) = result { list.append(TeamPassPlugin.describe(t)) }
            }
            call.resolve(["list": list])
        }
    }

    @objc public func owned(_ call: CAPPluginCall) {
        let sync = call.getBool("sync") ?? false
        Task {
            if sync {
                do { try await AppStore.sync() } catch {
                    call.reject("Couldn't reach the App Store to restore your purchases. Check your signal and try again.")
                    return
                }
            }
            var list: [[String: Any]] = []
            for await result in Transaction.currentEntitlements {
                if case .verified(let t) = result, t.revocationDate == nil { list.append(TeamPassPlugin.describe(t)) }
            }
            call.resolve(["list": list])
        }
    }

    @objc public func finish(_ call: CAPPluginCall) {
        let id = call.getString("transactionId") ?? ""
        Task {
            for await result in Transaction.unfinished {
                if case .verified(let t) = result, String(t.id) == id {
                    await t.finish()
                    call.resolve(["finished": true])
                    return
                }
            }
            call.resolve(["finished": false])
        }
    }
}
