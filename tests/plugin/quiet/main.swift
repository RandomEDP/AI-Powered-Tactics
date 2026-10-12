// The open team chat's messages arrive without a banner or sound; everything else, and the web app's own copy, still arrives.
import Foundation
class Push: NSObject, NotificationHandlerProtocol { var heard = 0
  func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions { heard += 1; return [.banner, .sound] }
  func didReceive(response: UNNotificationResponse) {} }
var fails = 0
func check(_ ok: Bool, _ what: String) { if !ok { fails += 1; print("FAIL", what) } }
let push = Push(); let p = ChatQuietPlugin(); p.bridge!.notificationRouter.pushNotificationHandler = push
func call(_ o: [String: Any]) { let c = CAPPluginCall(o); p.quiet(c); RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
let r = p.bridge!.notificationRouter
func show(_ kind: String, _ code: String) -> UNNotificationPresentationOptions { r.pushNotificationHandler!.willPresent(notification: UNNotification(["kind": kind, "code": code])) }
check(show("chat", "ABC") == [.banner, .sound], "before any call")
call(["code": "abc"]); check(r.pushNotificationHandler is ChatQuietGate, "installed")
check(show("chat", "ABC") == [], "open chat quiet"); check(push.heard == 2, "still told web app")
check(show("chat", "XYZ") == [.banner, .sound], "other team's chat shows")
check(show("goal", "ABC") == [.banner, .sound], "goal shows")
call(["code": "abc"]); call(["code": "XYZ"]); check(show("chat", "ABC") == [.banner, .sound], "switched team"); check(show("chat", "XYZ") == [], "new team quiet")
call([:]); check(show("chat", "XYZ") == [.banner, .sound], "closed chat shows")
let g = r.pushNotificationHandler; call(["code": "Q"]); check(r.pushNotificationHandler === g, "not wrapped twice")
// watching a team's live stream: its goals arrive without a banner (the picture is behind), everything else as usual
call(["live": " abc"]); check(show("goal", "ABC") == [], "watched stream's goal quiet"); check(show("goal", "XYZ") == [.banner, .sound], "other team's goal shows")
check(show("live", "ABC") == [.banner, .sound] && show("kickoff", "ABC") == [.banner, .sound] && show("chat", "ABC") == [.banner, .sound], "only goals are held back, and chat isn't quiet just for watching")
call(["code": "ABC", "live": "ABC"]); check(show("chat", "ABC") == [] && show("goal", "ABC") == [], "both at once")
let before = push.heard; _ = show("goal", "ABC"); check(push.heard == before + 1, "a quiet goal still reaches the web app")
call(["code": "ABC"]); check(show("goal", "ABC") == [.banner, .sound], "stopped watching: goals show again")
call([:]); check(show("goal", "ABC") == [.banner, .sound] && show("chat", "ABC") == [.banner, .sound], "neither")
print(fails == 0 ? "quiet chat: all good" : "\(fails) failed"); exit(fails == 0 ? 0 : 1)
