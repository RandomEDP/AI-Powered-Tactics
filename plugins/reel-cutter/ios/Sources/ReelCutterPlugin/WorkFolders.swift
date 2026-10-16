import Foundation

/// Each reel being joined gets a folder of its own, so making one never deletes another's finished video before it has
/// been uploaded or shared. Every join used to clear one shared "reel" folder first, so a game's one video with
/// commentary deleted the copy without it before it went up, and the phone made it again, and again (Ethan, October
/// 2026: "every time I open the highlights for a game it does making it one video but seems to never do it").
/// Plain Foundation, so it's checked off the phone (tests/folders/main.swift).
enum WorkFolders {
    /// A new, empty folder for one job inside `base/kind`. Folders left there by earlier jobs are cleared once they're
    /// more than `keep` seconds old (their videos have long since been uploaded or shared by then; an upload copies its
    /// file before it starts).
    static func fresh(_ kind: String, in base: URL, keep: TimeInterval = 24 * 3600, now: Date = Date()) throws -> URL {
        let parent = base.appendingPathComponent(kind, isDirectory: true)
        let files = FileManager.default
        try files.createDirectory(at: parent, withIntermediateDirectories: true)
        for old in (try? files.contentsOfDirectory(at: parent, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [] {
            let made = (try? old.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
            if now.timeIntervalSince(made) > keep { try? files.removeItem(at: old) }
        }
        let dir = parent.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try files.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Clears everything in a job's folder except the files it's handing back (the clips it fetched and the spoken lines
    /// are only needed while it joins them).
    static func tidy(_ dir: URL, keeping: [URL]) {
        let keep = Set(keeping.map { $0.standardizedFileURL.path })
        for item in (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? [] where !keep.contains(item.standardizedFileURL.path) {
            try? FileManager.default.removeItem(at: item)
        }
    }
}
