// The beat edit's plan as the phone reads it (BeatEdit.swift, the code that ships), checked off the phone.
//   swiftc plugins/reel-cutter/ios/Sources/ReelCutterPlugin/BeatEdit.swift tests/beat/main.swift -o beatcheck
//   ./beatcheck                 its own checks
//   ./beatcheck plans.json      also the plans the web app made (tests/beat.test.mjs writes them): [{ track, drop, plan }]
import Foundation

var failures = 0, checks = 0
func check(_ ok: Bool, _ what: String) { checks += 1; if !ok { failures += 1; print("FAIL  " + what) } }

// ---- its own: a small plan by hand
let segs: [[String: Any]] = [
    ["i": 0, "t": 0.0, "out": 1.0, "from": 2.0, "len": 1.0, "mono": true, "z0": 1.4, "z1": 1.5],
    ["i": 1, "t": 1.0, "out": 1.0, "from": 8.0, "len": 0.5, "mono": false, "z0": 1.55, "z1": 1.35]
]
let fx: [[String: Any]] = [["t": 1.0, "k": "flash", "d": 0.3, "a": 0.8], ["t": 1.0, "k": "punch", "d": 0.45, "a": 0.2], ["t": 1.0, "k": "shake", "d": 0.45, "a": 0.7], ["t": 0.0, "k": "blur", "d": 0.5, "a": 1.0]]
if let plan = BeatPlan.parse(segs: segs, fx: fx, len: 2, outroAt: 1.5) {
    check(plan.seg(at: 0.5).i == 0 && plan.seg(at: 1.0).i == 1 && plan.seg(at: 1.9).i == 1, "each moment plays the stretch planned for it")
    check(plan.frame(at: 0.5).mono && !plan.frame(at: 1.2).mono, "black and white before the drop, colour after it")
    let start = plan.frame(at: 0), atHit = plan.frame(at: 1.0), after = plan.frame(at: 1.6)
    check(start.blur > 0.9 && plan.frame(at: 0.6).blur == 0, "it opens out of a blur")
    check(atHit.flash > 0.79 && after.flash == 0, "a flash on the hit, gone soon after")
    check(atHit.zoom > 1.55 * 1.19 && abs(after.zoom - (1.55 + (1.35 - 1.55) * (0.6 * 0.6 * (3 - 2 * 0.6)))) < 1e-9, "a punch-in on the hit, then the planned zoom")
    check(abs(plan.frame(at: 1.05).dx) > 0 && plan.frame(at: 1.5).dx == 0, "the picture shakes on the hit and then settles")
    check(abs(plan.frame(at: 0.0).zoom - 1.4) < 1e-9 && abs(plan.frame(at: 0.999).zoom - 1.5) < 0.001, "the zoom moves from z0 to z1 across a stretch")
} else { check(false, "a good plan is read") }
check(BeatPlan.parse(segs: [segs[0], ["i": 1, "t": 1.5, "out": 1.0, "from": 0.0, "len": 1.0]], fx: [], len: 2.5, outroAt: 2) == nil, "a plan with a gap in it is turned down")
check(BeatPlan.parse(segs: [], fx: [], len: 2, outroAt: 1) == nil, "so is an empty one")

// ---- the web app's own plans, as the plugin gets them
if CommandLine.arguments.count > 1, let data = FileManager.default.contents(atPath: CommandLine.arguments[1]),
   let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
    for entry in list {
        let name = entry["name"] as? String ?? "?"
        guard let raw = entry["plan"] as? [String: Any], let drop = (entry["drop"] as? NSNumber)?.doubleValue,
              let plan = BeatPlan.parse(segs: raw["segs"] as? [[String: Any]] ?? [], fx: raw["fx"] as? [[String: Any]] ?? [],
                                        len: (raw["len"] as? NSNumber)?.doubleValue ?? 0, outroAt: (raw["outroAt"] as? NSNumber)?.doubleValue ?? 0) else {
            check(false, name + ": the plan is read"); continue
        }
        check(plan.frame(at: drop - 0.05).mono && !plan.frame(at: drop + 0.01).mono, name + ": the colour comes in on the drop")
        check(plan.frame(at: drop + 0.01).flash > 0.9, name + ": with a big flash")
        var ok = true
        var t = 0.0
        while t < plan.len { let f = plan.frame(at: t); if !(f.zoom >= 1 && f.zoom < 2.5 && f.flash <= 1 && f.dx.isFinite && f.dy.isFinite) { ok = false }; t += 1.0 / 30 }
        check(ok, name + ": every frame is zoomed in (never showing past the picture's edge) and sensible")
    }
}
print(failures == 0 ? "beat edit plans: \(checks) checks passed" : "beat edit plans: \(failures) of \(checks) checks failed")
exit(failures == 0 ? 0 : 1)
