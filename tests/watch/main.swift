// Plays whole games through the watch's logic (ios/App/Watch/MatchLogic.swift) with a made-up clock and a phone that
// goes quiet, wakes up confused, and delivers updates late or twice. Run on every build:
//   swiftc ios/App/Watch/MatchLogic.swift tests/watch/main.swift -o /tmp/watchtests && /tmp/watchtests
import Foundation

var failures = 0
var checks = 0
func check(_ ok: Bool, _ what: String, line: Int = #line) {
    checks += 1
    if !ok { failures += 1; print("FAIL (line \(line)): \(what)") }
}

let kickoff = Date(timeIntervalSince1970: 1_791_660_000) // a Saturday evening in October 2026
func at(_ seconds: Double) -> Date { kickoff.addingTimeInterval(seconds) }
func ms(_ date: Date) -> Double { date.timeIntervalSince1970 * 1000 }

/// What the phone would send. `firstChange` is the minute of the first change it still lists in this half.
func phone(live: Bool = true, phase: String = "h1", running: Bool = true, base: Double = 0, t0: Date = kickoff, us: Int = 0, them: Int = 0, due: Bool = false,
           changes: [(Int, Int)] = [(0, 5), (0, 10), (1, 0), (1, 5)]) -> String {
    if !live { return "{\"live\":false}" }
    let list = changes.map { "{\"h\":\($0.0),\"from\":\($0.1),\"on\":[\"Jake\"],\"off\":[\"Reece\"]}" }.joined(separator: ",")
    return "{\"live\":true,\"due\":\(due),\"team\":\"SOP FC\",\"opp\":\"Dog\",\"us\":\(us),\"them\":\(them),\"phase\":\"\(phase)\",\"running\":\(running),\"base\":\(base),\"t0\":\(ms(t0)),\"half\":15,\"periods\":2,\"lockUntil\":0,\"changes\":[\(list)],\"players\":[{\"id\":2,\"name\":\"Jake\",\"on\":true},{\"id\":1,\"name\":\"Spice\",\"on\":true,\"gk\":true}]}"
}
func kind(_ json: String) -> String { ((try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any])?["type"] as? String ?? "" }

// ---------- 1. Kick-off from the watch, the phone asleep, and a change coming due by the watch's own clock
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(phase: "pre", running: false), sent: ms(at(-60)), now: at(-60))
    check(w.state?.phase == "pre" && w.state?.live == true, "before kick-off the game shows as set up")
    let press = w.pressStart(now: at(0))
    check(w.state?.phase == "h1" && w.state?.running == true, "kick-off on the watch starts the clock at once")
    check(press.send.count == 1 && kind(press.send[0]) == "start", "kick-off is sent to the phone")
    check(w.state?.seconds(at: at(42)) == 42, "the clock reads 0:42 after 42 seconds")
    // the phone hasn't heard yet and repeats its old "before kick-off"
    _ = w.receive(json: phone(phase: "pre", running: false), sent: ms(at(20)), now: at(20))
    check(w.state?.phase == "h1" && w.state?.seconds(at: at(60)) == 60, "a stale 'before kick-off' from the phone doesn't stop the clock")
    // ...for minutes on end
    var resent = 0
    for s in 1...240 { let o = w.tick(now: at(Double(s))); resent += o.send.filter { kind($0) == "start" }.count; if s % 45 == 0 { _ = w.receive(json: phone(phase: "pre", running: false), sent: ms(at(Double(s))), now: at(Double(s))) } }
    check(w.state?.phase == "h1" && w.state?.seconds(at: at(240)) == 240, "four minutes on, phone still asleep, the clock is still right (\(w.state?.seconds(at: at(240)) ?? -1))")
    check(resent >= 20, "kick-off is sent again every ten seconds until the phone takes it in (\(resent) times)")
    // the change at 5:00 comes due with no word from the phone
    var buzzedAt = -1
    for s in 241...320 where buzzedAt < 0 { if w.tick(now: at(Double(s))).becameDue { buzzedAt = s } }
    check(buzzedAt == 300, "the watch buzzes for the change at exactly 5:00 by its own clock (buzzed at \(buzzedAt))")
    check(w.state?.due == true, "the change shows as due")
    // subs done on the watch; phone still asleep
    let done = w.pressSubsDone(now: at(312))
    check(w.state?.due == false && w.state?.changes.first?.from == 10, "after 'Subs done' the next change is the one at 10:00")
    check(done.send.count == 1 && kind(done.send[0]) == "subs", "'Subs done' is sent to the phone")
    check(w.state?.seconds(at: at(330)) == 330, "the clock carries straight on after the subs (\(w.state?.seconds(at: at(330)) ?? -1))")
    // the phone wakes with its old picture: still 'before kick-off', still listing the 5:00 change
    let stale = w.receive(json: phone(phase: "pre", running: false), sent: ms(at(335)), now: at(335))
    check(!stale.becameDue && w.state?.phase == "h1" && w.state?.seconds(at: at(336)) == 336 && w.state?.changes.first?.from == 10, "a stale update after the subs changes nothing: clock, phase and next change all hold")
    // minutes later the 5:00 change must not come back
    var again = false
    for s in 336...590 { if w.tick(now: at(Double(s))).becameDue { again = true } }
    check(!again, "the confirmed change never buzzes a second time, even with the phone silent for four more minutes")
    check(w.state?.seconds(at: at(590)) == 590, "clock right at 9:50 (\(w.state?.seconds(at: at(590)) ?? -1))")
    // the phone finally catches up: kicked off at the watch's time, first change made
    let caught = w.receive(json: phone(t0: at(0), changes: [(0, 10), (1, 0), (1, 5)]), sent: ms(at(595)), now: at(595))
    check(!caught.becameDue && w.state?.seconds(at: at(596)) == 596 && w.presses.isEmpty, "when the phone catches up nothing jumps and nothing is left to resend (\(w.presses.count) left)")
    var second = -1
    for s in 596...620 where second < 0 { if w.tick(now: at(Double(s))).becameDue { second = s } }
    check(second == 600, "the 10:00 change buzzes on time (at \(second))")
}

// ---------- 2. The phone app wakes up confused mid-game and says "no game"
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(), sent: ms(at(1)), now: at(1))
    _ = w.receive(json: phone(live: false), sent: ms(at(100)), now: at(100))
    check(w.state?.live == true && w.state?.seconds(at: at(101)) == 101, "one 'no game' in the middle of a game is not believed")
    _ = w.receive(json: phone(), sent: ms(at(102)), now: at(102))
    _ = w.receive(json: phone(live: false), sent: ms(at(200)), now: at(200))
    _ = w.receive(json: phone(live: false), sent: ms(at(200)), now: at(201))
    check(w.state?.live == true, "the same 'no game' delivered twice is still one report")
    _ = w.receive(json: phone(live: false), sent: ms(at(230)), now: at(230))
    check(w.state?.live == false, "a second, later 'no game' is believed (the game really was scrapped)")
}

// ---------- 3. Full time ends the game straight away
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(phase: "h2", t0: at(1200)), sent: ms(at(1201)), now: at(1201))
    _ = w.receive(json: phone(phase: "ft", running: false, base: 900_000), sent: ms(at(2100)), now: at(2100))
    _ = w.receive(json: phone(live: false), sent: ms(at(2160)), now: at(2160))
    check(w.state?.live == false, "after full time, 'no game' is taken at once")
}

// ---------- 4. Updates arriving out of order
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(us: 2), sent: ms(at(400)), now: at(400))
    _ = w.receive(json: phone(us: 1), sent: ms(at(300)), now: at(401))
    check(w.state?.us == 2, "an older update arriving late is ignored")
}

// ---------- 5. A goal logged on the watch
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(), sent: ms(at(1)), now: at(1))
    let g = w.pressGoal(us: true, scorer: 2, assist: nil, now: at(120))
    check(w.state?.us == 1 && g.send.count == 1 && kind(g.send[0]) == "goal", "a goal shows at once and is sent")
    _ = w.receive(json: phone(us: 0), sent: ms(at(125)), now: at(125))
    check(w.state?.us == 1, "the phone's older 0 doesn't undo it")
    var resent = 0
    for s in 121...150 { resent += w.tick(now: at(Double(s))).send.count }
    check(resent >= 2, "the goal is sent again until the phone has counted it (\(resent))")
    _ = w.receive(json: phone(us: 1), sent: ms(at(151)), now: at(151))
    check(w.state?.us == 1 && w.presses.isEmpty, "once the phone has it, nothing more is sent")
    _ = w.pressGoal(us: false, scorer: nil, assist: nil, now: at(200))
    _ = w.receive(json: phone(us: 1, them: 0), sent: ms(at(300)), now: at(300))
    check(w.state?.them == 0, "a goal the phone never counts (it was a duplicate) drops off after 90 seconds")
}

// ---------- 6. Pause and resume on the phone, half time, and the second half from the watch
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(), sent: ms(at(1)), now: at(1))
    _ = w.receive(json: phone(running: false, base: 200_000), sent: ms(at(200)), now: at(200))
    check(w.state?.seconds(at: at(260)) == 200, "paused on the phone: the watch clock holds at 3:20")
    var buzz = false
    for s in 200...400 { if w.tick(now: at(Double(s))).becameDue { buzz = true } }
    check(!buzz, "no change comes due while the clock is stopped")
    _ = w.receive(json: phone(base: 200_000, t0: at(400)), sent: ms(at(400)), now: at(400))
    check(w.state?.seconds(at: at(460)) == 260, "resumed: the clock runs on from where it stopped")
    _ = w.receive(json: phone(phase: "ht", running: false, changes: [(1, 0), (1, 5)]), sent: ms(at(1000)), now: at(1000))
    check(w.state?.phase == "ht" && w.state?.due == false, "half time: nothing due")
    let second = w.pressStart(now: at(1300))
    check(w.state?.phase == "h2" && kind(second.send.first ?? "") == "start", "second half started from the watch")
    _ = w.receive(json: phone(phase: "ht", running: false, changes: [(1, 0), (1, 5)]), sent: ms(at(1310)), now: at(1310))
    check(w.state?.phase == "h2" && w.state?.seconds(at: at(1360)) == 60, "the second-half clock holds against a stale 'half time'")
    var due = false
    for s in 1311...1500 { if w.tick(now: at(Double(s))).becameDue { due = true } }
    check(!due && w.state?.changes.first?.from == 5, "the half-time change is made by starting the half, so it isn't asked for; next is 5:00")
    _ = w.receive(json: phone(phase: "h2", t0: at(1300), changes: [(1, 5)]), sent: ms(at(1325)), now: at(1325))
    check(w.state?.seconds(at: at(1400)) == 100 && w.state?.changes.first?.from == 5 && w.presses.isEmpty, "phone agrees: second half 1:40 in, next change at 5:00")
}

// ---------- 7. Nothing here can overflow a watch's 32-bit whole numbers
do {
    var w = WatchBrain()
    _ = w.receive(json: "{\"live\":true,\"phase\":\"h1\",\"running\":true,\"base\":0,\"t0\":0,\"half\":15,\"changes\":[{\"h\":0,\"from\":5,\"on\":[],\"off\":[]}]}", sent: 1, now: at(0))
    let s = w.state?.seconds(at: at(0)) ?? -1
    check(s >= 0 && s <= 360_000, "a nonsense start time gives a capped clock, not a crash (\(s))")
    check(Int64(s) <= Int64(Int32.max) && Int64(60 * 60) <= Int64(Int32.max), "seconds always fit in 32 bits")
    _ = w.tick(now: at(1))
    _ = w.receive(json: "not json", sent: 2, now: at(2))
    _ = w.receive(json: "{\"live\":true,\"base\":1e300,\"t0\":-1e300,\"running\":true,\"phase\":\"h2\"}", sent: 3, now: at(3))
    check((w.state?.seconds(at: at(4)) ?? -1) <= 360_000, "absurd numbers from the phone are survived")
}

print(failures == 0 ? "watch logic: all \(checks) checks passed" : "watch logic: \(failures) of \(checks) checks FAILED")
exit(failures == 0 ? 0 : 1)
