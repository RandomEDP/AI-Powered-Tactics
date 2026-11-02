// iOS's progress card for a cut (ContinuedWork.swift, the code that ships), checked off the phone.
//   swiftc plugins/reel-cutter/ios/Sources/ReelCutterPlugin/ContinuedWork.swift tests/continued/main.swift -o continued && ./continued
// Ethan lost a whole cut (SOP FC 23–7 Dog Squad, November 2026) to "Stopped from the progress card" without stopping it:
// iOS takes the card back when its progress stands still (a long upload, the commentary being made), and that used to
// throw the cut away. Now the card's progress always moves on, and the card ending never stops the work.
import Foundation

var failures = 0, checks = 0
func check(_ ok: Bool, _ what: String) { checks += 1; if !ok { failures += 1; print("FAIL  " + what) } }
let U = ContinuedWork.units

check(ContinuedWork.nextUnits(shown: 0, p: 0.25) == U / 4, "the card shows how far the work has got")
check(ContinuedWork.nextUnits(shown: U / 2, p: 0.25) == U / 2 + 1, "never backwards, and still moves on")
var at: Int64 = ContinuedWork.nextUnits(shown: 0, p: 0.9)
for _ in 0..<720 { let next = ContinuedWork.nextUnits(shown: at, p: 0.9); check(next > at, "an hour of uploads at the same number still moves the card on every time"); at = next }
check(at < U / 100 * 91, "by so little nobody sees it (an hour of it is under 1%)")
var top = U - 5
for _ in 0..<20 { top = ContinuedWork.nextUnits(shown: top, p: 1) }
check(top < U, "it never says finished by itself: only the end of the work does")
check(ContinuedWork.nextUnits(shown: 0, p: 7) < U && ContinuedWork.nextUnits(shown: 0, p: -1) == 1, "odd numbers are kept in range")

// the card going early only says so: nothing in it can stop the work
var ended = 0
ContinuedWork.shared.onEnded = { ended += 1 }
check(ContinuedWork.shared.start(prefix: "test.work", title: "Highlights v Dog Squad", subtitle: "Starting…") == false, "no card off the phone (or on an older iOS)")
ContinuedWork.shared.update(title: nil, subtitle: "Uploading clip 3 of 30", p: 0.92)
ContinuedWork.shared.end(ok: true)
check(ended == 0, "ending it normally doesn't count as the card ending early")

print(failures == 0 ? "ok  \(checks) checks on iOS's progress card" : "\(failures) of \(checks) checks failed")
exit(failures == 0 ? 0 : 1)
