// The watch's logic as a little program that takes one instruction per line and answers with one line, so
// tests/link.test.mjs can wire the real watch logic to the real phone app and play games between them.
//   swiftc ios/App/Watch/MatchLogic.swift tests/watch/cli/main.swift -o /tmp/watchbrain
import Foundation

var brain = WatchBrain()
func date(_ ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }

while let line = readLine() {
    guard let cmd = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any], let op = cmd["op"] as? String else { print("{}"); fflush(stdout); continue }
    let now = date(cmd["now"] as? Double ?? 0)
    var outcome = WatchBrain.Outcome()
    switch op {
    case "receive": outcome = brain.receive(json: cmd["json"] as? String ?? "", sent: cmd["sent"] as? Double ?? 0, now: now)
    case "tick": outcome = brain.tick(now: now)
    case "start": outcome = brain.pressStart(now: now)
    case "end": outcome = brain.pressEnd(now: now)
    case "subs": outcome = brain.pressSubsDone(now: now)
    case "goal": outcome = brain.pressGoal(us: cmd["us"] as? Bool ?? false, scorer: cmd["p"] as? Int, assist: cmd["a"] as? Int, now: now)
    case "hl": outcome = brain.pressHighlight(now: now)
    case "relaunch": // watchOS closed the app and it reopened: only what was saved comes back
        if let data = try? JSONEncoder().encode(brain), let back = try? JSONDecoder().decode(WatchBrain.self, from: data) { brain = back }
    default: break
    }
    var answer: [String: Any] = ["due": outcome.becameDue, "timeUp": outcome.timeUp, "send": outcome.send, "pending": brain.presses.map { $0.kind }]
    if let s = brain.state {
        answer["state"] = ["live": s.live, "gid": s.gid, "phase": s.phase, "running": s.running, "us": s.us, "them": s.them, "due": s.due, "seconds": s.seconds(at: now),
                           "changes": s.changes.map { $0.id }, "players": s.players.map { $0.id }] as [String: Any]
    }
    let data = (try? JSONSerialization.data(withJSONObject: answer)) ?? Data("{}".utf8)
    print(String(data: data, encoding: .utf8) ?? "{}")
    fflush(stdout)
}
