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

/// What the phone would send. `changes` are (half, minute) of the changes it still lists.
func phone(live: Bool = true, gid: String = "game-1", acks: [String] = [], phase: String = "h1", running: Bool = true, base: Double = 0, t0: Date = kickoff, us: Int = 0, them: Int = 0,
           due: Bool = false, half: Int = 15, periods: Int = 2, changes: [(Int, Int)] = [(0, 5), (0, 10), (1, 0), (1, 5)], on: String = "Jake") -> String {
    if !live { return "{\"live\":false}" }
    let list = changes.map { "{\"h\":\($0.0),\"from\":\($0.1),\"on\":[\"\(on)\"],\"off\":[\"Reece\"]}" }.joined(separator: ",")
    let acked = acks.map { "\"\($0)\"" }.joined(separator: ",")
    return "{\"live\":true,\"gid\":\"\(gid)\",\"acks\":[\(acked)],\"due\":\(due),\"team\":\"SOP FC\",\"opp\":\"Dog\",\"us\":\(us),\"them\":\(them),\"phase\":\"\(phase)\",\"running\":\(running),\"base\":\(base),\"t0\":\(ms(t0)),\"half\":\(half),\"periods\":\(periods),\"lockUntil\":0,\"changes\":[\(list)],\"players\":[{\"id\":2,\"name\":\"Jake\",\"on\":true},{\"id\":1,\"name\":\"Spice\",\"on\":true,\"gk\":true}]}"
}
func field(_ json: String, _ key: String) -> Any? { ((try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any])?[key] }
func kind(_ json: String) -> String { field(json, "type") as? String ?? "" }
func id(_ json: String) -> String { field(json, "id") as? String ?? "" }
/// Runs the watch's clock second by second and reports when it buzzed for subs and for time.
func run(_ w: inout WatchBrain, from: Int, to: Int) -> (subs: [Int], time: [Int], sent: [String]) {
    var subs: [Int] = [], time: [Int] = [], sent: [String] = []
    if from > to { return (subs, time, sent) }
    for s in from...to { let o = w.tick(now: at(Double(s))); if o.becameDue { subs.append(s) }; if o.timeUp { time.append(s) }; sent += o.send }
    return (subs, time, sent)
}

// ---------- 1. Kick-off from the watch, the phone asleep, and a change coming due by the watch's own clock
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(phase: "pre", running: false), sent: ms(at(-60)), now: at(-60))
    check(w.state?.phase == "pre" && w.state?.live == true, "before kick-off the game shows as set up")
    let press = w.pressStart(now: at(0))
    check(w.state?.phase == "h1" && w.state?.running == true, "kick-off on the watch starts the clock at once")
    check(press.send.count == 1 && kind((press.send.first ?? "")) == "start", "kick-off is sent to the phone")
    check(field((press.send.first ?? ""), "to") as? String == "h1" && field((press.send.first ?? ""), "gid") as? String == "game-1" && !id((press.send.first ?? "")).isEmpty && (field((press.send.first ?? ""), "at") as? Double) == ms(at(0)),
          "the kick-off message says which half, which game and exactly when")
    check(w.state?.seconds(at: at(42)) == 42, "the clock reads 0:42 after 42 seconds")
    // the phone hasn't heard yet and repeats its old "before kick-off"
    _ = w.receive(json: phone(phase: "pre", running: false), sent: ms(at(20)), now: at(20))
    check(w.state?.phase == "h1" && w.state?.seconds(at: at(60)) == 60, "a stale 'before kick-off' from the phone doesn't stop the clock")
    // ...for minutes on end
    var resent = 0
    for s in 1...240 { let o = w.tick(now: at(Double(s))); resent += o.send.filter { kind($0) == "start" }.count; if s % 45 == 0 { _ = w.receive(json: phone(phase: "pre", running: false), sent: ms(at(Double(s))), now: at(Double(s))) } }
    check(w.state?.phase == "h1" && w.state?.seconds(at: at(240)) == 240, "four minutes on, phone still asleep, the clock is still right (\(w.state?.seconds(at: at(240)) ?? -1))")
    check(resent >= 7 && resent <= 9, "kick-off is sent again every half minute until the phone takes it in (\(resent) times in four minutes)")
    // the change at 5:00 comes due with no word from the phone
    let first = run(&w, from: 241, to: 320)
    check(first.subs == [300], "the watch buzzes for the change at exactly 5:00 by its own clock (buzzed at \(first.subs))")
    check(w.state?.due == true, "the change shows as due")
    // subs done on the watch; phone still asleep
    let done = w.pressSubsDone(now: at(312))
    check(w.state?.due == false && w.state?.changes.first?.from == 10, "after 'Subs done' the next change is the one at 10:00")
    check(done.send.count == 1 && kind((done.send.first ?? "")) == "subs" && field((done.send.first ?? ""), "change") as? String == "0-5", "'Subs done' is sent to the phone, naming the change")
    check(w.state?.seconds(at: at(330)) == 330, "the clock carries straight on after the subs (\(w.state?.seconds(at: at(330)) ?? -1))")
    // the phone wakes with its old picture: still 'before kick-off', still listing the 5:00 change
    let stale = w.receive(json: phone(phase: "pre", running: false), sent: ms(at(335)), now: at(335))
    check(!stale.becameDue && w.state?.phase == "h1" && w.state?.seconds(at: at(336)) == 336 && w.state?.changes.first?.from == 10, "a stale update after the subs changes nothing: clock, phase and next change all hold")
    // minutes later the 5:00 change must not come back
    check(run(&w, from: 336, to: 590).subs.isEmpty, "the confirmed change never buzzes a second time, even with the phone silent for four more minutes")
    check(w.state?.seconds(at: at(590)) == 590, "clock right at 9:50 (\(w.state?.seconds(at: at(590)) ?? -1))")
    // the phone finally catches up: kicked off at the watch's time, first change made
    let caught = w.receive(json: phone(t0: at(0), changes: [(0, 10), (1, 0), (1, 5)]), sent: ms(at(595)), now: at(595))
    check(!caught.becameDue && w.state?.seconds(at: at(596)) == 596 && w.presses.isEmpty, "when the phone catches up nothing jumps and nothing is left to resend (\(w.presses.count) left)")
    check(run(&w, from: 596, to: 620).subs == [600], "the 10:00 change buzzes on time")
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
    _ = w.receive(json: phone(live: false), sent: ms(at(210)), now: at(210))
    check(w.state?.live == false, "a second, later 'no game' is believed (the game really was scrapped)")

    var v = WatchBrain()
    _ = v.receive(json: phone(), sent: ms(at(1)), now: at(1))
    _ = v.receive(json: phone(live: false), sent: ms(at(100)), now: at(100))
    _ = run(&v, from: 101, to: 110)
    check(v.state?.live == true, "ten seconds after a lone 'no game' the game is still showing")
    _ = v.receive(json: phone(), sent: ms(at(111)), now: at(111))
    _ = run(&v, from: 112, to: 200)
    check(v.state?.live == true && v.state?.seconds(at: at(200)) == 200, "the phone put it right, so the game carries on for good")
    _ = v.receive(json: phone(live: false), sent: ms(at(300)), now: at(300))
    _ = run(&v, from: 301, to: 325)
    check(v.state?.live == false, "a lone 'no game' that nothing contradicts for 20 seconds is believed")

    var h = WatchBrain()
    _ = h.receive(json: phone(phase: "ht", running: false), sent: ms(at(1000)), now: at(1000))
    _ = h.receive(json: phone(live: false), sent: ms(at(1010)), now: at(1010))
    check(h.state?.live == true && h.state?.phase == "ht", "half time is protected from a lone 'no game' too")
}

// ---------- 3. Full time ends the game straight away
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(phase: "h2", t0: at(1200)), sent: ms(at(1201)), now: at(1201))
    _ = w.receive(json: phone(phase: "ft", running: false, base: 0), sent: ms(at(2100)), now: at(2100))
    check(w.pressGoal(us: true, scorer: nil, assist: nil, now: at(2110)).send.isEmpty && w.state?.us == 0, "no goals after the final whistle")
    _ = w.receive(json: phone(live: false), sent: ms(at(2160)), now: at(2160))
    check(w.state?.live == false, "after full time, 'no game' is taken at once")
    var p = WatchBrain()
    _ = p.receive(json: phone(phase: "pre", running: false), sent: ms(at(-100)), now: at(-100))
    _ = p.receive(json: phone(live: false), sent: ms(at(-50)), now: at(-50))
    check(p.state?.live == false, "a game scrapped before kick-off goes at once")
}

// ---------- 4. Updates arriving out of order
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(us: 2), sent: ms(at(400)), now: at(400))
    _ = w.receive(json: phone(us: 1), sent: ms(at(300)), now: at(401))
    check(w.state?.us == 2, "an older update arriving late is ignored")
    _ = w.receive(json: phone(us: 2), sent: ms(at(400)), now: at(402))
    check(w.state?.us == 2, "the same update arriving twice changes nothing")
}

// ---------- 5. Goals logged on the watch
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(), sent: ms(at(1)), now: at(1))
    let g = w.pressGoal(us: true, scorer: 2, assist: 1, now: at(120))
    check(w.state?.us == 1 && g.send.count == 1 && kind((g.send.first ?? "")) == "goal", "a goal shows at once and is sent")
    check(field((g.send.first ?? ""), "p") as? Int == 2 && field((g.send.first ?? ""), "a") as? Int == 1 && field((g.send.first ?? ""), "us") as? Bool == true, "with its scorer and assist")
    _ = w.receive(json: phone(us: 0), sent: ms(at(125)), now: at(125))
    check(w.state?.us == 1, "the phone's older 0 doesn't undo it")
    let again = run(&w, from: 121, to: 200)
    check(again.sent.count >= 2 && again.sent.allSatisfy { id($0) == id((g.send.first ?? "")) }, "the goal is sent again, under the same id, until the phone has dealt with it (\(again.sent.count))")
    // the phone asleep for ten minutes: the score must not slip back
    for s in stride(from: 160, through: 760, by: 30) { _ = w.receive(json: phone(us: 0), sent: ms(at(Double(s))), now: at(Double(s))) }
    check(w.state?.us == 1, "ten minutes of stale updates and the goal is still on the watch")
    _ = w.receive(json: phone(acks: [id((g.send.first ?? ""))], us: 1), sent: ms(at(770)), now: at(770))
    check(w.state?.us == 1 && w.presses.isEmpty, "once the phone has it, nothing more is sent")
    // a goal the phone deals with but doesn't count (someone else had already logged the same one)
    let dup = w.pressGoal(us: false, scorer: nil, assist: nil, now: at(800))
    check(w.state?.them == 1, "second goal shows")
    _ = w.receive(json: phone(acks: [id((dup.send.first ?? ""))], us: 1, them: 0), sent: ms(at(803)), now: at(803))
    check(w.state?.them == 0 && w.presses.isEmpty, "the phone dealt with it and didn't count it: the watch follows the phone at once")
    // two goals, the phone catching up one at a time
    let a = w.pressGoal(us: true, scorer: nil, assist: nil, now: at(900))
    let b = w.pressGoal(us: true, scorer: nil, assist: nil, now: at(910))
    check(w.state?.us == 3, "two more goals: 3")
    _ = w.receive(json: phone(acks: [id((a.send.first ?? ""))], us: 2), sent: ms(at(915)), now: at(915))
    check(w.state?.us == 3 && w.presses.count == 1, "the phone has counted one of the two: still 3 here, one left to send")
    _ = w.receive(json: phone(acks: [id((a.send.first ?? "")), id((b.send.first ?? ""))], us: 3), sent: ms(at(920)), now: at(920))
    check(w.state?.us == 3 && w.presses.isEmpty, "both counted")
    // an older phone build that never lists what it has dealt with: the score catching up is enough
    _ = w.pressGoal(us: true, scorer: nil, assist: nil, now: at(1000))
    _ = w.receive(json: phone(us: 4), sent: ms(at(1005)), now: at(1005))
    check(w.state?.us == 4 && w.presses.isEmpty, "a phone that only shows the new score also settles it")
    // the phone takes a goal off (undo) after dealing with it
    _ = w.receive(json: phone(us: 3), sent: ms(at(1010)), now: at(1010))
    check(w.state?.us == 3, "a goal undone on the phone comes off the watch too")
}

// ---------- 6. Pause and resume on the phone, half time, and the second half from the watch
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(), sent: ms(at(1)), now: at(1))
    _ = w.receive(json: phone(running: false, base: 200_000), sent: ms(at(200)), now: at(200))
    check(w.state?.seconds(at: at(260)) == 200, "paused on the phone: the watch clock holds at 3:20")
    check(run(&w, from: 200, to: 400).subs.isEmpty, "no change comes due while the clock is stopped")
    _ = w.receive(json: phone(base: 200_000, t0: at(400)), sent: ms(at(400)), now: at(400))
    check(w.state?.seconds(at: at(460)) == 260, "resumed: the clock runs on from where it stopped")
    check(run(&w, from: 401, to: 520).subs == [500], "the 5:00 change comes due 5 minutes of play in, not 5 minutes after kick-off")
    _ = w.receive(json: phone(phase: "ht", running: false, changes: [(1, 0), (1, 5)]), sent: ms(at(1000)), now: at(1000))
    check(w.state?.phase == "ht" && w.state?.due == false, "half time: nothing due")
    check(w.pressSubsDone(now: at(1001)).send.isEmpty, "'Subs done' does nothing when no change is due")
    let second = w.pressStart(now: at(1300))
    check(w.state?.phase == "h2" && kind(second.send.first ?? "") == "start" && field(second.send.first ?? "", "to") as? String == "h2", "second half started from the watch")
    check(w.pressStart(now: at(1301)).send.isEmpty, "a second press of the start button does nothing")
    _ = w.receive(json: phone(phase: "ht", running: false, changes: [(1, 0), (1, 5)]), sent: ms(at(1310)), now: at(1310))
    check(w.state?.phase == "h2" && w.state?.seconds(at: at(1360)) == 60, "the second-half clock holds against a stale 'half time'")
    let later = run(&w, from: 1311, to: 1500)
    check(later.subs.isEmpty && w.state?.changes.first?.from == 5, "the half-time change is made by starting the half, so it isn't asked for; next is 5:00")
    _ = w.receive(json: phone(phase: "h2", t0: at(1300), changes: [(1, 5)]), sent: ms(at(1525)), now: at(1525))
    check(w.state?.seconds(at: at(1600)) == 300 && w.state?.changes.first?.from == 5 && w.presses.isEmpty, "phone agrees: second half under way, next change at 5:00")
    check(run(&w, from: 1526, to: 1610).subs == [1600], "the second half's 5:00 change buzzes at 5:00 of the second half")
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
    _ = w.receive(json: "{\"live\":true,\"half\":\"fifteen\",\"us\":\"two\",\"changes\":\"none\",\"players\":[{\"id\":\"x\"}],\"phase\":7}", sent: 4, now: at(4))
    check(w.state?.half == 15 && w.state?.us == 0 && w.state?.changes.isEmpty == true && w.state?.phase == "pre", "fields of the wrong kind fall back to something sensible")
    _ = w.receive(json: "[1,2,3]", sent: 5, now: at(5))
    _ = w.receive(json: "", sent: 6, now: at(6))
    _ = w.receive(json: "{\"live\":true,\"half\":1000000,\"phase\":\"h1\",\"running\":true,\"t0\":\(ms(at(0))),\"changes\":[{\"h\":0,\"from\":30000000,\"on\":[],\"off\":[]}]}", sent: 7, now: at(7))
    _ = w.tick(now: at(8))
    check(Int64(w.state?.half ?? 0) * 60 <= Int64(Int32.max) && w.state?.changes.isEmpty == true, "a silly half length is cut down and a change at a silly minute is dropped")
    _ = w.receive(json: "{\"live\":true,\"half\":-5,\"phase\":\"h1\",\"running\":true,\"t0\":\(ms(at(0))),\"changes\":[{\"h\":0,\"from\":2000000000,\"on\":[],\"off\":[]},{\"h\":7,\"from\":5,\"on\":[],\"off\":[]},{\"h\":0,\"from\":-3,\"on\":[],\"off\":[]},{\"h\":0,\"from\":5,\"on\":[],\"off\":[]}]}", sent: 8, now: at(8))
    check(w.state?.half == 1 && w.state?.changes.map { $0.id } == ["0-5"], "only the change that makes sense is kept (\(w.state?.changes.map { $0.id } ?? []))")
}

// ---------- 8. Two changes overdue at once
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(), sent: ms(at(1)), now: at(1))
    let r = run(&w, from: 2, to: 640)
    check(r.subs == [300], "with the first change still waiting, the second doesn't buzz on top of it (buzzed at \(r.subs))")
    let done = w.pressSubsDone(now: at(641))
    check(done.becameDue && w.state?.due == true && w.state?.changes.first?.from == 10, "confirming the first shows the second, already overdue, straight away")
    _ = w.pressSubsDone(now: at(650))
    check(w.state?.due == false && w.state?.changes.first?.h == 1 && w.presses.count == 2, "both confirmed; next is at half time; both still to be told to the phone")
    check(run(&w, from: 651, to: 899).subs.isEmpty, "nothing more buzzes this half")
    // the phone hears about the first only
    let firstId = w.presses.first?.id ?? ""
    _ = w.receive(json: phone(acks: [firstId], changes: [(0, 10), (1, 0), (1, 5)]), sent: ms(at(700)), now: at(700))
    check(w.state?.due == false && w.state?.changes.first?.h == 1 && w.presses.count == 1, "the phone has made the first: the second, confirmed here, still doesn't come back")
}

// ---------- 9. A game of one period
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(phase: "pre", running: false, half: 20, periods: 1, changes: [(0, 10)]), sent: ms(at(-10)), now: at(-10))
    _ = w.pressStart(now: at(0))
    let r = run(&w, from: 1, to: 1215)
    check(r.subs == [600] && r.time == [1200], "one period of 20: change at 10:00, time's up at 20:00 (\(r.subs), \(r.time))")
    check(w.state?.lastHalf == true, "its whistle is the final one")
    let end = w.pressEnd(now: at(1230))
    check(w.state?.phase == "ft" && w.state?.running == false && field((end.send.first ?? ""), "from") as? String == "h1", "the whistle goes straight to full time")
    check(w.pressStart(now: at(1240)).send.isEmpty, "there is no second half to start")
}

// ---------- 10. Both whistles and the second half from the watch, the phone asleep throughout
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(phase: "pre", running: false), sent: ms(at(-30)), now: at(-30))
    let ko = w.pressStart(now: at(0))
    let r1 = run(&w, from: 1, to: 930)
    check(r1.subs == [300] && r1.time == [900], "first half: one buzz for subs (the second waits on the first), one for time (\(r1.subs), \(r1.time))")
    check(w.state?.seconds(at: at(930)) == 930, "the clock runs on into added time: 15:30")
    let ht = w.pressEnd(now: at(935))
    check(w.state?.phase == "ht" && w.state?.running == false && w.state?.due == false && kind((ht.send.first ?? "")) == "end" && field((ht.send.first ?? ""), "from") as? String == "h1", "half time blown on the watch: clock stopped, nothing due")
    check(w.state?.changes.first?.h == 1, "the first half's unmade changes are dropped; the half-time change is next")
    _ = w.receive(json: phone(phase: "pre", running: false), sent: ms(at(940)), now: at(940))
    check(w.state?.phase == "ht", "a stale 'before kick-off' doesn't undo half time")
    check(w.pressEnd(now: at(950)).send.isEmpty, "the whistle does nothing at half time")
    let h2 = w.pressStart(now: at(1235))
    _ = w.receive(json: phone(phase: "pre", running: false), sent: ms(at(1240)), now: at(1240))
    check(w.state?.phase == "h2" && w.state?.seconds(at: at(1300)) == 65, "second half running by the watch's clock against a phone that still says 'before kick-off'")
    let r2 = run(&w, from: 1236, to: 2140)
    check(r2.subs == [1535] && r2.time == [2135], "second half: subs at 5:00, time at 15:00 (\(r2.subs), \(r2.time))")
    check(Set(r2.sent.map { kind($0) }) == ["start", "end"] && r2.sent.count > 60, "all three whistles keep being sent while the phone is asleep (\(r2.sent.count))")
    let ft = w.pressEnd(now: at(2150))
    check(w.state?.phase == "ft" && w.state?.changes.isEmpty == true && field((ft.send.first ?? ""), "from") as? String == "h2", "full time")
    // the phone works through them one at a time
    _ = w.receive(json: phone(acks: [id((ko.send.first ?? ""))], phase: "h1", t0: at(0)), sent: ms(at(2160)), now: at(2160))
    check(w.state?.phase == "ft", "phone has only got as far as kick-off: the watch still says full time")
    _ = w.receive(json: phone(acks: [id((ko.send.first ?? "")), id((ht.send.first ?? ""))], phase: "ht", running: false, changes: [(1, 0), (1, 5)]), sent: ms(at(2161)), now: at(2161))
    check(w.state?.phase == "ft", "…then half time: still full time here")
    _ = w.receive(json: phone(acks: [id((ko.send.first ?? "")), id((ht.send.first ?? "")), id((h2.send.first ?? ""))], phase: "h2", t0: at(1235), changes: [(1, 5)]), sent: ms(at(2162)), now: at(2162))
    check(w.state?.phase == "ft" && w.state?.due == false, "…then the second half: still full time, and no change asked for")
    _ = w.receive(json: phone(acks: [id((ko.send.first ?? "")), id((ht.send.first ?? "")), id((h2.send.first ?? "")), id((ft.send.first ?? ""))], phase: "ft", running: false, changes: []), sent: ms(at(2163)), now: at(2163))
    check(w.state?.phase == "ft" && w.presses.filter { $0.kind != "subs" }.isEmpty, "…and full time: everything settled")
}

// ---------- 11. Time's up
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(changes: []), sent: ms(at(1)), now: at(1))
    let r = run(&w, from: 2, to: 1000)
    check(r.time == [900] && r.subs.isEmpty, "the half running out buzzes once, at 15:00 (\(r.time))")
    var p = WatchBrain()
    _ = p.receive(json: phone(changes: []), sent: ms(at(1)), now: at(1))
    _ = run(&p, from: 2, to: 800)
    _ = p.receive(json: phone(running: false, base: 800_000, changes: []), sent: ms(at(800)), now: at(800))
    check(run(&p, from: 801, to: 1100).time.isEmpty, "no 'time's up' while the clock is stopped")
    _ = p.receive(json: phone(base: 800_000, t0: at(1100), changes: []), sent: ms(at(1100)), now: at(1100))
    check(run(&p, from: 1101, to: 1300).time == [1200], "it comes after 15 minutes of play (\(run(&p, from: 1301, to: 1302).time))")
    var stopped = WatchBrain() // first heard of while stopped in added time
    _ = stopped.receive(json: phone(running: false, base: 950_000, changes: []), sent: ms(at(1000)), now: at(1000))
    check(run(&stopped, from: 1001, to: 1100).time.isEmpty, "a clock stopped in added time doesn't buzz")
    _ = stopped.receive(json: phone(base: 950_000, t0: at(1100), changes: []), sent: ms(at(1100)), now: at(1100))
    check(run(&stopped, from: 1101, to: 1200).time.isEmpty, "nor when it is started again: 15:00 went by long ago")
    var justStopped = WatchBrain() // stopped at 14:50, restarted: time is still to come
    _ = justStopped.receive(json: phone(running: false, base: 890_000, changes: []), sent: ms(at(1000)), now: at(1000))
    _ = justStopped.receive(json: phone(base: 890_000, t0: at(1100), changes: []), sent: ms(at(1100)), now: at(1100))
    check(run(&justStopped, from: 1001, to: 1200).time == [1110], "stopped at 14:50 and restarted: time's up ten seconds later")
    var onTheWhistle = WatchBrain() // first heard of stopped at 15:05
    _ = onTheWhistle.receive(json: phone(running: false, base: 905_000, changes: []), sent: ms(at(1000)), now: at(1000))
    check(run(&onTheWhistle, from: 1001, to: 1100).time.isEmpty, "stopped just after 15:00: no buzz while it is stopped")
    var late = WatchBrain()
    _ = late.receive(json: phone(changes: []), sent: ms(at(1000)), now: at(1000))
    check(run(&late, from: 1001, to: 1100).time.isEmpty, "a watch that first hears of the half well into added time doesn't buzz for a moment long gone")
}

// ---------- 12. The next game of the evening
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(), sent: ms(at(1)), now: at(1))
    _ = run(&w, from: 2, to: 300)
    _ = w.pressSubsDone(now: at(305))
    _ = w.pressGoal(us: true, scorer: nil, assist: nil, now: at(400))
    check(w.presses.count == 2 && w.state?.us == 1, "game one: a change made and a goal scored, the phone not yet told")
    // the watch hears nothing more until the second game is already under way
    let k2 = at(3000)
    _ = w.receive(json: phone(gid: "game-2", t0: k2), sent: ms(k2) + 1000, now: k2.addingTimeInterval(1))
    check(w.state?.us == 0 && w.presses.isEmpty, "game two starts clean: 0–0, nothing from game one waiting to be sent")
    check(w.state?.changes.first?.from == 5, "game two's 5:00 change is there, though game one's was confirmed")
    check(run(&w, from: 3002, to: 3310).subs == [3300], "and it buzzes")
    let g = w.pressGoal(us: true, scorer: nil, assist: nil, now: at(3320))
    check(field((g.send.first ?? ""), "gid") as? String == "game-2", "presses now carry the new game's name")
}

// ---------- 13. The gaffer resets the clock on the phone and kicks off again
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(), sent: ms(at(1)), now: at(1))
    _ = run(&w, from: 2, to: 300)
    _ = w.pressSubsDone(now: at(301))
    _ = w.receive(json: phone(acks: [w.presses.first?.id ?? ""], changes: [(0, 10), (1, 0), (1, 5)]), sent: ms(at(302)), now: at(302))
    _ = w.receive(json: phone(phase: "pre", running: false), sent: ms(at(400)), now: at(400))
    check(w.state?.phase == "pre" && w.state?.changes.first?.from == 5, "reset: back to before kick-off with the full list of changes")
    _ = w.receive(json: phone(t0: at(500)), sent: ms(at(500)), now: at(500))
    let r = run(&w, from: 501, to: 1405)
    check(r.subs == [800] && r.time == [1400], "after the restart the 5:00 change and the time-up buzz both come round again (\(r.subs), \(r.time))")
}

// ---------- 14. watchOS closes the app mid-game and it reopens
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(phase: "pre", running: false), sent: ms(at(-30)), now: at(-30))
    _ = w.pressStart(now: at(0))
    _ = run(&w, from: 1, to: 300)
    _ = w.pressSubsDone(now: at(310))
    _ = w.pressGoal(us: true, scorer: 2, assist: nil, now: at(320))
    let saved = try! JSONEncoder().encode(w)
    var again = try! JSONDecoder().decode(WatchBrain.self, from: saved)
    check(again.state == w.state && again.presses == w.presses, "everything the watch knew survives being closed")
    // on reopening it is handed the phone's last word again, from before kick-off
    _ = again.receive(json: phone(phase: "pre", running: false), sent: ms(at(-30)), now: at(400))
    check(again.state?.phase == "h1" && again.state?.seconds(at: at(400)) == 400 && again.state?.us == 1 && again.state?.changes.first?.from == 10, "reopened: clock, score and the confirmed change all as they were")
    let r = run(&again, from: 401, to: 610)
    check(r.subs == [600] && Set(r.sent.map { kind($0) }) == ["start", "subs", "goal"], "and it carries on: next buzz at 10:00, still telling the phone all three things")
}

// ---------- 15. The phone deals with a press but says otherwise
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(phase: "pre", running: false), sent: ms(at(-30)), now: at(-30))
    let ko = w.pressStart(now: at(0))
    _ = w.receive(json: phone(acks: [id((ko.send.first ?? ""))], phase: "pre", running: false), sent: ms(at(5)), now: at(5))
    check(w.state?.phase == "pre" && w.presses.isEmpty, "the phone took the kick-off and still says 'before kick-off' (it was reset): the phone's word stands")
    // kicked off on the phone by hand a few seconds after the watch
    var v = WatchBrain()
    _ = v.receive(json: phone(phase: "pre", running: false), sent: ms(at(-30)), now: at(-30))
    _ = v.pressStart(now: at(0))
    _ = v.receive(json: phone(t0: at(4)), sent: ms(at(5)), now: at(5))
    check(v.state?.seconds(at: at(64)) == 60 && v.presses.isEmpty, "kicked off on the phone too, 4 seconds later: one clock, the phone's")
}

// ---------- 16. The gaffer makes the change on the phone instead
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(), sent: ms(at(1)), now: at(1))
    check(run(&w, from: 2, to: 302).subs == [300], "buzzed at 5:00")
    let o = w.receive(json: phone(due: true), sent: ms(at(303)), now: at(303))
    check(!o.becameDue, "the phone saying 'due' as well doesn't buzz again")
    _ = w.receive(json: phone(changes: [(0, 10), (1, 0), (1, 5)]), sent: ms(at(320)), now: at(320))
    check(w.state?.due == false && w.state?.changes.first?.from == 10, "'Subs done' on the phone clears it on the watch")
    check(w.pressSubsDone(now: at(321)).send.isEmpty && w.state?.changes.first?.from == 10, "a late tap on the watch's button doesn't confirm the next one by mistake")
    check(run(&w, from: 322, to: 610).subs == [600], "the next one buzzes at 10:00")
}

// ---------- 17. A change due while the game is stopped, and the half ending with one unmade
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(), sent: ms(at(1)), now: at(1))
    _ = run(&w, from: 2, to: 310)
    _ = w.receive(json: phone(running: false, base: 310_000, due: true), sent: ms(at(310)), now: at(310))
    check(w.state?.due == true, "pausing with a change waiting leaves it waiting")
    let d = w.pressSubsDone(now: at(330))
    check(kind(d.send.first ?? "") == "subs" && w.state?.due == false, "it can be confirmed while the clock is stopped")
    _ = w.receive(json: phone(acks: [id((d.send.first ?? ""))], base: 310_000, t0: at(400), changes: [(0, 10), (1, 0), (1, 5)]), sent: ms(at(400)), now: at(400))
    check(run(&w, from: 401, to: 700).subs == [690], "the next comes 10 minutes of play in (11:30 by the wall clock)")
    _ = w.receive(json: phone(phase: "ht", running: false, changes: [(1, 0), (1, 5)]), sent: ms(at(1000)), now: at(1000))
    check(w.state?.due == false, "half time with the 10:00 change never made: nothing is due any more")
    check(run(&w, from: 1001, to: 1200).subs.isEmpty, "and nothing buzzes during the break")
}

// ---------- 18. Seven-a-side, 20-minute halves, a change every four minutes, the phone repeating itself every 30 seconds
do {
    var w = WatchBrain()
    var left: [(Int, Int)] = [(0, 4), (0, 8), (0, 12), (0, 16), (1, 0)]
    var buzzes: [Int] = [], times: [Int] = []
    _ = w.receive(json: phone(half: 20, changes: left), sent: ms(at(0)), now: at(0))
    var confirmAt = -1, phoneLeft = left
    for s in 1...1260 {
        let o = w.tick(now: at(Double(s)))
        if o.becameDue { buzzes.append(s); confirmAt = s + 7 }
        if o.timeUp { times.append(s) }
        if s == confirmAt { // seven seconds to get the players swapped
            if w.pressSubsDone(now: at(Double(s))).becameDue { buzzes.append(-s) }
            left.removeFirst()
        }
        if s == confirmAt + 40 { phoneLeft = left } // the phone only hears about it 40 seconds later
        if s % 30 == 0 { // the phone's regular repeat, sometimes still listing a change the watch has confirmed
            if w.receive(json: phone(due: phoneLeft.count != left.count, half: 20, changes: phoneLeft), sent: ms(at(Double(s))), now: at(Double(s))).becameDue { buzzes.append(-s) }
        }
    }
    check(buzzes == [240, 480, 720, 960], "four changes, four buzzes, each on its minute (\(buzzes))")
    check(times == [1200], "time's up at 20:00 (\(times))")
}

// ---------- 19. Updates shuffled, repeated and dropped
do {
    var seed: UInt64 = 42
    func rnd(_ n: Int) -> Int { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return Int((seed >> 33) % UInt64(n)) }
    for round in 0..<200 {
        var w = WatchBrain()
        // the phone's history: kick-off, three goals, the first change made
        let history: [(Double, String)] = [
            (1, phone()), (100, phone(us: 1)), (200, phone(us: 1, them: 1)), (300, phone(us: 1, them: 1, due: true)),
            (310, phone(us: 1, them: 1, changes: [(0, 10), (1, 0), (1, 5)])), (400, phone(us: 2, them: 1, changes: [(0, 10), (1, 0), (1, 5)]))]
        var order: [Int] = []
        for i in history.indices { for _ in 0..<(1 + rnd(3)) { order.append(i) } }
        for i in stride(from: order.count - 1, to: 0, by: -1) { order.swapAt(i, rnd(i + 1)) }
        if !order.contains(history.count - 1) { order.append(history.count - 1) }
        var now = 401.0
        for i in order { now += 0.2; _ = w.receive(json: history[i].1, sent: ms(at(history[i].0)), now: at(now)) }
        let ok = w.state?.us == 2 && w.state?.them == 1 && w.state?.changes.first?.from == 10 && w.state?.due == false && w.state?.seconds(at: at(420)) == 420
        if !ok { check(false, "shuffle \(round): whatever order they arrive in, the newest update wins (\(order))"); break }
        if round == 199 { check(true, "200 shuffles of repeated, reordered updates all end on the newest") }
    }
}

// ---------- 20. The line-up for the next change is edited on the phone while it's waiting
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(), sent: ms(at(1)), now: at(1))
    _ = run(&w, from: 2, to: 301)
    let o = w.receive(json: phone(due: true, on: "Harrison"), sent: ms(at(305)), now: at(305))
    check(!o.becameDue && w.state?.due == true && w.state?.changes.first?.on == ["Harrison"], "the new name shows, without a second buzz")
}

// ---------- 21. A watch that has waited too long stops trying
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(), sent: ms(at(1)), now: at(1))
    _ = w.pressGoal(us: true, scorer: nil, assist: nil, now: at(60))
    _ = w.tick(now: at(60 + 3 * 60 * 60 + 5))
    check(w.presses.isEmpty, "three hours on, a press the phone never took is given up")
}

// ---------- 22. Highlights
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(phase: "pre", running: false), sent: ms(at(-5)), now: at(-5))
    check(w.pressHighlight(now: at(-1)).send.isEmpty, "no highlights before kick-off")
    _ = w.receive(json: phone(), sent: ms(at(1)), now: at(1))
    let h = w.pressHighlight(now: at(50))
    check(kind(h.send.first ?? "") == "hl" && w.presses.isEmpty, "a highlight is sent once and not repeated")
}

// ---------- 22c. Whose highlight: picked on the watch, timed from the Highlight tap
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(), sent: ms(at(1)), now: at(1))
    check(w.state?.highlightPlayers.map { $0.name } == ["Jake"], "the list offers the outfield players on the pitch, not the keeper")
    let jake = w.pressHighlight(now: at(58), at: at(50), chose: .some(2)).send.first ?? ""
    check(kind(jake) == "hl" && field(jake, "p") as? Int == 2 && field(jake, "pick") as? Bool == true, "a player picked goes with the highlight")
    check(field(jake, "at") as? Double == ms(at(50)), "timed when Highlight was tapped, not when the name was picked")
    let none = w.pressHighlight(now: at(70), at: at(66), chose: .some(nil)).send.first ?? ""
    check(field(none, "pick") as? Bool == true && field(none, "p") == nil, "No one: said so, so the phone doesn't put it under the wearer's name")
    let button = w.pressHighlight(now: at(80)).send.first ?? ""
    check(field(button, "pick") == nil && field(button, "p") == nil, "from the Action button nobody was asked: the phone decides")
    _ = w.pressEnd(now: at(900))
    check(w.pressHighlight(now: at(905), at: at(898), chose: .some(2)).send.count == 1, "tapped just before the whistle, picked just after: still marked")
    check(w.pressHighlight(now: at(1100), at: at(898), chose: .some(2)).send.isEmpty, "but not one left on the list for minutes into the break")
    check(w.pressHighlight(now: at(905), at: at(910), chose: .some(2)).send.isEmpty == false, "a tap time later than now is taken as now")
    var pre = WatchBrain()
    _ = pre.receive(json: phone(phase: "pre", running: false), sent: ms(at(-5)), now: at(-5))
    check(pre.pressHighlight(now: at(-1), at: at(-2), chose: .some(2)).send.isEmpty, "never before kick-off")
}

// ---------- 22a. A highlight from the Action button (or Siri), with no screen: what the watch says back
do {
    var w = WatchBrain()
    check(w.highlightSaid(w.pressHighlight(now: at(0)), now: at(0)) == "No game on, so nothing was marked.", "button: no game at all")
    _ = w.receive(json: phone(phase: "pre", running: false), sent: ms(at(-5)), now: at(-5))
    check(w.highlightSaid(w.pressHighlight(now: at(-1)), now: at(-1)) == "The game hasn't kicked off yet, so nothing was marked.", "button: before kick-off")
    _ = w.receive(json: phone(), sent: ms(at(1)), now: at(1))
    let h = w.pressHighlight(now: at(125))
    check(w.highlightSaid(h, now: at(125)) == "Highlight marked at 2:05 in the first half." && kind(h.send.first ?? "") == "hl" && field(h.send.first ?? "", "gid") as? String == "game-1",
          "button: marked, with when in the half, for this game (\(w.highlightSaid(h, now: at(125))))")
    check(w.highlightSaid(w.pressHighlight(now: at(9)), now: at(9)) == "Highlight marked at 0:09 in the first half.", "button: seconds under ten get a leading nought")
    _ = w.pressEnd(now: at(900))
    check(w.highlightSaid(w.pressHighlight(now: at(910)), now: at(910)) == "It's half time, so nothing was marked.", "button: at half time")
    _ = w.pressStart(now: at(1200))
    check(w.highlightSaid(w.pressHighlight(now: at(1261)), now: at(1261)) == "Highlight marked at 1:01 in the second half.", "button: second half")
    _ = w.pressEnd(now: at(2100))
    check(w.highlightSaid(w.pressHighlight(now: at(2110)), now: at(2110)) == "The game's over, so nothing was marked.", "button: after full time")
    var one = WatchBrain()
    _ = one.receive(json: phone(periods: 1), sent: ms(at(1)), now: at(1))
    check(one.highlightSaid(one.pressHighlight(now: at(61)), now: at(61)) == "Highlight marked at 1:01.", "button: a game with no half time doesn't mention halves")
}

// ---------- 22b. Goals and highlights only while a half is being played
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(phase: "pre", running: false), sent: ms(at(-5)), now: at(-5))
    check(w.pressGoal(us: true, scorer: 2, assist: nil, now: at(-1)).send.isEmpty && w.state?.us == 0, "no goal before kick-off: the clock has to be started first")
    _ = w.pressStart(now: at(0))
    check(w.pressGoal(us: true, scorer: 2, assist: nil, now: at(30)).send.count == 1 && w.state?.us == 1, "a goal once it has kicked off")
    _ = w.receive(json: phone(running: false, base: 40_000, us: 1), sent: ms(at(40)), now: at(40))
    check(w.pressGoal(us: false, scorer: nil, assist: nil, now: at(50)).send.count == 1 && w.state?.them == 1, "a goal can be logged while the clock is stopped")
    _ = w.receive(json: phone(base: 40_000, t0: at(60), us: 1, them: 1), sent: ms(at(60)), now: at(60))
    _ = w.pressEnd(now: at(1000))
    check(w.pressGoal(us: true, scorer: nil, assist: nil, now: at(1010)).send.isEmpty && w.pressHighlight(now: at(1011)).send.isEmpty && w.state?.us == 1, "nothing is logged during the break")
    _ = w.pressStart(now: at(1300))
    check(w.pressGoal(us: true, scorer: nil, assist: nil, now: at(1310)).send.count == 1 && w.pressHighlight(now: at(1320)).send.count == 1 && w.state?.us == 2, "and again once the second half is under way")
}

// ---------- 22c. The clock stopped on the phone (a stoppage, or a stray touch in a pocket) and restarted from the wrist
do {
    var w = WatchBrain()
    _ = w.receive(json: phone(), sent: ms(at(1)), now: at(1))
    check(w.pressResume(now: at(50)).send.isEmpty, "nothing to restart while the clock is running")
    _ = w.receive(json: phone(running: false, base: 200_000), sent: ms(at(200)), now: at(200))
    check(w.state?.running == false && w.state?.seconds(at: at(260)) == 200, "stopped on the phone at 3:20")
    let r = w.pressResume(now: at(260))
    check(w.state?.running == true && w.state?.seconds(at: at(300)) == 240 && kind(r.send.first ?? "") == "resume", "restarted from the wrist a minute later: it runs on from 3:20")
    check(w.pressResume(now: at(261)).send.isEmpty, "a second press does nothing")
    _ = w.receive(json: phone(running: false, base: 200_000), sent: ms(at(280)), now: at(280))
    check(w.state?.running == true && w.state?.seconds(at: at(300)) == 240, "the phone still saying 'stopped' doesn't stop it again")
    let b = run(&w, from: 281, to: 400)
    check(b.subs == [360], "the 5:00 change comes due at 5:00 of play (\(b.subs))")
    check(b.sent.contains { kind($0) == "resume" }, "and the restart keeps being sent")
    _ = w.receive(json: phone(acks: [id(r.send.first ?? "")], base: 200_000, t0: at(260), due: true), sent: ms(at(401)), now: at(401))
    check(w.state?.seconds(at: at(420)) == 360 && w.presses.isEmpty, "the phone restarts at the same moment: one clock, nothing left to send")
    // stopped again on the phone at a different point while an earlier restart is still on its way: the phone's word
    _ = w.receive(json: phone(running: false, base: 400_000, due: true), sent: ms(at(500)), now: at(500))
    let r2 = w.pressResume(now: at(520))
    _ = w.receive(json: phone(running: false, base: 450_000, due: true), sent: ms(at(600)), now: at(600))
    check(w.state?.running == false && w.state?.seconds(at: at(610)) == 450 && !w.presses.contains { $0.kind == "resume" } && !r2.send.isEmpty, "if the phone has since been restarted and stopped somewhere else, the watch goes with the phone")
    // the whistle after a restart the phone never heard about
    _ = w.receive(json: phone(running: false, base: 880_000, due: true), sent: ms(at(700)), now: at(700))
    _ = w.pressResume(now: at(710))
    let e = w.pressEnd(now: at(760))
    _ = w.receive(json: phone(running: false, base: 880_000, due: true), sent: ms(at(770)), now: at(770))
    check(w.state?.phase == "ht" && w.state?.running == false && kind(e.send.first ?? "") == "end", "half time blown after a restart from the wrist: half time it stays")
}

// ---------- 23. Presses with no game on do nothing and don't crash
do {
    var w = WatchBrain()
    check(w.pressStart(now: at(0)).send.isEmpty && w.pressEnd(now: at(0)).send.isEmpty && w.pressSubsDone(now: at(0)).send.isEmpty && w.pressGoal(us: true, scorer: nil, assist: nil, now: at(0)).send.isEmpty && w.pressHighlight(now: at(0)).send.isEmpty, "nothing to press before the phone has said anything")
    _ = w.tick(now: at(1))
    _ = w.receive(json: phone(live: false), sent: ms(at(2)), now: at(2))
    check(w.pressStart(now: at(3)).send.isEmpty && w.state?.live == false, "nor with no game set up")
}

// ---------- 24. The phone's clock and the watch's clock a couple of seconds apart
do {
    var w = WatchBrain()
    // the phone is 2 s fast: it stamps kick-off at +2 by its clock, sent at +3
    _ = w.receive(json: phone(t0: at(2)), sent: ms(at(3)), now: at(1))
    let r = run(&w, from: 2, to: 310)
    check(r.subs == [302], "the change comes due when the watch's own clock reaches 5:00 on the phone's kick-off time (\(r.subs))")
    _ = w.receive(json: phone(t0: at(2), us: 1), sent: ms(at(2)), now: at(311))
    check(w.state?.us == 0, "an update the phone sent earlier than one already taken in is still ignored")
}

// ---------- 25. Just me: a game with no players and no subs (Ethan's ask). Goal logs straight away, nobody to pick
do {
    func solo(phase: String = "h1", running: Bool = true, base: Double = 0, us: Int = 0, them: Int = 0, acks: [String] = []) -> String {
        let acked = acks.map { "\"\($0)\"" }.joined(separator: ",")
        return "{\"live\":true,\"gid\":\"solo-1\",\"acks\":[\(acked)],\"due\":false,\"team\":\"SOP FC\",\"opp\":\"Them\",\"us\":\(us),\"them\":\(them),\"phase\":\"\(phase)\",\"running\":\(running),\"base\":\(base),\"t0\":\(ms(kickoff)),\"half\":12,\"periods\":2,\"lockUntil\":0,\"changes\":[],\"players\":[]}"
    }
    var w = WatchBrain()
    _ = w.receive(json: solo(phase: "pre", running: false), sent: ms(at(-30)), now: at(-30))
    check(w.state?.live == true && w.state?.asksScorer == false && w.state?.highlightPlayers.isEmpty == true, "a game of just me shows, with nobody to ask who scored or whose highlight")
    let ko = w.pressStart(now: at(0))
    check(kind(ko.send.first ?? "") == "start" && w.state?.running == true, "kick-off from the watch starts the clock")
    var r = run(&w, from: 1, to: 300)
    check(r.subs.isEmpty, "no subs: the watch never buzzes for a change")
    let g = w.pressGoal(us: true, scorer: nil, assist: nil, now: at(301))
    check(kind(g.send.first ?? "") == "goal" && field(g.send.first ?? "", "us") as? Bool == true && field(g.send.first ?? "", "p") == nil, "Goal for us goes to the phone with no scorer")
    check(w.state?.us == 1, "and shows on the watch straight away")
    _ = w.receive(json: solo(us: 1, acks: [id(g.send.first ?? ""), id(ko.send.first ?? "")]), sent: ms(at(305)), now: at(305))
    let a = w.pressGoal(us: false, scorer: nil, assist: nil, now: at(320))
    check(kind(a.send.first ?? "") == "goal" && field(a.send.first ?? "", "us") as? Bool == false && w.state?.them == 1, "a goal against too")
    _ = w.receive(json: solo(us: 1, them: 1, acks: [id(g.send.first ?? ""), id(ko.send.first ?? ""), id(a.send.first ?? "")]), sent: ms(at(325)), now: at(325))
    r = run(&w, from: 326, to: 730)
    check(r.time == [720] && r.subs.isEmpty, "time's up at 12:00 by the watch's own clock, still no subs (\(r.time))")
    check(w.state?.us == 1 && w.state?.them == 1 && w.state?.seconds(at: at(700)) == 700, "the score and the time played are kept")
}
// a normal game still asks who scored
do { var w = WatchBrain(); _ = w.receive(json: phone(), sent: ms(at(1)), now: at(1)); check(w.state?.asksScorer == true, "a game with a squad still asks who scored") }

print(failures == 0 ? "watch logic: all \(checks) checks passed" : "watch logic: \(failures) of \(checks) checks FAILED")
exit(failures == 0 ? 0 : 1)
