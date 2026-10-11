// The phone's store of presses from the watch: kept on disk until the web app has dealt with them, never twice,
// safe when the watch, the web app and the reply to the watch all arrive on different threads at once.
import Foundation

var failures = 0, checks = 0
func check(_ ok: Bool, _ what: String, line: Int = #line) { checks += 1; if !ok { failures += 1; print("FAIL (line \(line)): \(what)") } }
func press(_ id: String, _ type: String = "goal") -> String { "{\"at\":1791660000000,\"gid\":\"game-1\",\"id\":\"\(id)\",\"type\":\"\(type)\",\"us\":true}" }
func pending(_ p: WatchLinkPlugin) -> [String] { let c = CAPPluginCall(); p.pending(c); return (c.resolved?["events"] as? [String]) ?? ["(no answer)"] }
func ids(_ p: WatchLinkPlugin) -> [String] { pending(p).map { (((try? JSONSerialization.jsonObject(with: Data($0.utf8))) as? [String: Any])?["id"] as? String) ?? "?" } }
func opened() -> WatchLinkPlugin { let p = WatchLinkPlugin(); p.load(); return p } // the app starting up
let store = UserDefaults.standard
for key in ["watchlink.latest", "watchlink.latest.sent", "watchlink.inbox"] { store.removeObject(forKey: key) }
let session = WCSession.default

// ---------- a press arrives while the web app is asleep
var phone = opened()
check(pending(phone) == [], "nothing waiting to start with")
var answer: [String: Any] = [:]
phone.session(session, didReceiveMessage: ["event": press("A")], replyHandler: { answer = $0 })
check(answer["ok"] as? Bool == true && answer["state"] == nil, "the watch is answered, with no game to report yet")
check(ids(phone) == ["A"] && phone.told.count == 1, "the press is kept, and the web app is told in case it is listening")
phone.session(session, didReceiveMessage: ["event": press("A")], replyHandler: { answer = $0 })
check(ids(phone) == ["A"] && phone.told.count == 2, "the watch repeating it doesn't keep it twice")
phone.session(session, didReceiveUserInfo: ["event": press("B", "subs")])
phone.session(session, didReceiveMessage: ["event": press("C", "end")])
check(ids(phone) == ["A", "B", "C"], "presses arriving by any route are kept in the order they came")
let sentBefore = session.messages.count
phone.session(session, didReceiveMessage: ["event": "{\"type\":\"hello\"}"], replyHandler: { answer = $0 })
check(ids(phone) == ["A", "B", "C"], "the watch saying hello is not a press")
phone.session(session, didReceiveMessage: ["event": "{\"type\":\"goal\"}"])
phone.session(session, didReceiveMessage: ["event": "not json"])
phone.session(session, didReceiveMessage: ["nothing": 1])
phone.session(session, didReceiveMessage: ["event": 7])
check(ids(phone) == ["A", "B", "C"], "anything without an id, or that isn't a press at all, is not kept")

// ---------- the app is closed and reopened: everything is still there
phone = opened()
check(ids(phone) == ["A", "B", "C"] && phone.told.isEmpty, "after the app restarts the presses are still waiting")

// ---------- the web app wakes, deals with two of them and says so
let push = CAPPluginCall(["state": "{\"live\":true,\"us\":1}", "seen": ["A", "B", "never-heard-of"]])
phone.push(push)
check(push.resolved?["sent"] as? Bool == true && ids(phone) == ["C"], "the ones the web app has dealt with are let go; the other stays")
check(session.contexts.last?["state"] as? String == "{\"live\":true,\"us\":1}" && (session.contexts.last?["sent"] as? Double ?? 0) > 1_700_000_000_000, "the game goes to the watch with the time it was sent")
check(session.messages.count > sentBefore, "and straight away as a message while the watch is in reach")
phone.session(session, didReceiveMessage: ["event": press("A")], replyHandler: { answer = $0 })
check(answer["state"] as? String == "{\"live\":true,\"us\":1}" && ids(phone) == ["C", "A"], "a late repeat of one already dealt with is kept again (the web app knows it and will say so again)")
phone.push(CAPPluginCall(["state": "{\"live\":true,\"us\":1}", "seen": ["A", "B"]]))
check(ids(phone) == ["C"], "and is let go again")
let bad = CAPPluginCall(["seen": ["C"]]); phone.push(bad)
check(bad.rejected != nil && ids(phone) == ["C"], "a push with no game is refused and lets nothing go")
phone.push(CAPPluginCall(["state": "{\"live\":false}"]))
check(ids(phone) == ["C"], "a push that names nothing as dealt with lets nothing go")
phone = opened()
phone.session(session, didReceiveMessage: ["event": "{\"type\":\"hello\"}"], replyHandler: { answer = $0 })
check(answer["state"] as? String == "{\"live\":false}" && (answer["sent"] as? Double ?? 0) > 1_700_000_000_000, "after a restart the watch is still told the last thing the web app said, and when")

// ---------- old and too many
let now = Date().timeIntervalSince1970 * 1000
store.set([["id": "old", "event": press("old"), "got": now - 13 * 3_600_000], ["id": "recent", "event": press("recent"), "got": now - 3_600_000], ["id": "broken"], ["event": press("x")]] as [[String: Any]], forKey: "watchlink.inbox")
phone = opened()
check(ids(phone) == ["recent"], "a press nobody dealt with for half a day is dropped, and anything malformed on disk is ignored")
for i in 0..<450 { phone.session(session, didReceiveUserInfo: ["event": press("n\(i)")]) }
let many = ids(phone)
check(many.count == 400 && many.last == "n449" && many.first == "n50", "the store holds the newest 400 (\(many.count), \(many.first ?? "") to \(many.last ?? ""))")
phone.push(CAPPluginCall(["state": "{}", "seen": many + ["recent"]]))
check(ids(phone) == [], "all let go at once")

// ---------- everything at once, from different threads
phone = opened()
let group = DispatchGroup()
for t in 0..<8 {
    DispatchQueue.global().async(group: group) {
        for i in 0..<400 {
            switch (t + i) % 4 {
            case 0: phone.session(session, didReceiveMessage: ["event": press("t\(t)-\(i)")], replyHandler: { _ in })
            case 1: phone.session(session, didReceiveUserInfo: ["event": press("t\(t)-\(i)")])
            case 2: phone.push(CAPPluginCall(["state": "{\"n\":\(i)}", "seen": ["t\(t)-\(i - 1)", "t\(t)-\(i - 2)"]]))
            default: _ = pending(phone)
            }
        }
    }
}
check(group.wait(timeout: .now() + 60) == .success, "eight threads hammering it at once all finish")
let left = ids(phone)
check(Set(left).count == left.count && left.count <= 400, "and what is left is consistent: no press twice (\(left.count) waiting)")
phone = opened()
check(ids(phone) == left, "and it is exactly what a restart finds on disk")

print(failures == 0 ? "phone's watch plugin: all \(checks) checks passed" : "phone's watch plugin: \(failures) of \(checks) checks FAILED")
exit(failures == 0 ? 0 : 1)
