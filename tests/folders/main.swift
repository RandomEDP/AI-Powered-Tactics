// Each reel being joined gets its own folder (WorkFolders.swift, the code that ships), checked off the phone.
//   swiftc plugins/reel-cutter/ios/Sources/ReelCutterPlugin/WorkFolders.swift tests/folders/main.swift -o folders && ./folders
// Ethan's game's one video never finished: joining the copy with commentary cleared the folder holding the copy
// without it, so its upload had no file. A second join must never touch the first one's video.
import Foundation

var failures = 0, checks = 0
func check(_ ok: Bool, _ what: String) { checks += 1; if !ok { failures += 1; print("FAIL  " + what) } }
let files = FileManager.default
let base = files.temporaryDirectory.appendingPathComponent("folders-\(UUID().uuidString)", isDirectory: true)


do {
    // the game's one video: first without commentary, then with it, as mhMake asks
    let first = try WorkFolders.fresh("reel", in: base)
    let clean = first.appendingPathComponent("2026-10-12_dog-squad-reel.mp4")
    try Data("clean".utf8).write(to: clean)
    try Data("clip".utf8).write(to: first.appendingPathComponent("clip_000.mp4"))
    WorkFolders.tidy(first, keeping: [clean])
    check(files.fileExists(atPath: clean.path), "a join keeps the video it hands back")
    check(!files.fileExists(atPath: first.appendingPathComponent("clip_000.mp4").path), "and clears the clips it fetched")

    let second = try WorkFolders.fresh("reel", in: base)
    check(second != first, "the next join gets a folder of its own")
    let voiced = second.appendingPathComponent("2026-10-12_dog-squad-reelv.mp4")
    try Data("voiced".utf8).write(to: voiced)
    check(files.fileExists(atPath: clean.path), "joining the copy with commentary leaves the copy without it, still to be uploaded")
    check((try? String(contentsOf: clean, encoding: .utf8)) == "clean", "untouched")

    // a player's reel made while the game's one is waiting to go up
    let third = try WorkFolders.fresh("reel", in: base)
    check(files.fileExists(atPath: clean.path) && files.fileExists(atPath: voiced.path), "a player's reel made meanwhile doesn't touch either")
    check(files.fileExists(atPath: third.path) && ((try? files.contentsOfDirectory(atPath: third.path)) ?? ["x"]).isEmpty, "and starts empty")

    // a day on, the old ones go
    let later = try WorkFolders.fresh("reel", in: base, now: Date().addingTimeInterval(25 * 3600))
    check(!files.fileExists(atPath: first.path) && !files.fileExists(atPath: second.path) && !files.fileExists(atPath: third.path), "folders more than a day old are cleared")
    check(files.fileExists(atPath: later.path), "but not the new one")

    // a folder left by an older build (everything straight in reel/) goes the same way, once old
    let parent = base.appendingPathComponent("reel", isDirectory: true)
    let stray = parent.appendingPathComponent("clip_007.mp4")
    try Data("old".utf8).write(to: stray)
    _ = try WorkFolders.fresh("reel", in: base)
    check(files.fileExists(atPath: stray.path), "a file from earlier today stays")
    _ = try WorkFolders.fresh("reel", in: base, now: Date().addingTimeInterval(25 * 3600))
    check(!files.fileExists(atPath: stray.path), "and goes once it's a day old")
} catch {
    check(false, "it works with real folders: \(error)")
}

try? files.removeItem(at: base)
print(failures == 0 ? "all \(checks) folder checks passed" : "\(failures) of \(checks) folder checks failed")
exit(failures == 0 ? 0 : 1)
