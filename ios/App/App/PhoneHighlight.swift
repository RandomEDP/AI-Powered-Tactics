import Foundation

/// "Mark a highlight" from the iPhone's side, for Siri, the Shortcuts app and the Action button on Apple Watch Ultra.
/// The Action button can only run shortcuts from the Shortcuts app, and those are made on the iPhone from the iPhone app's
/// actions, so the iPhone app has the action too (PhoneHighlightIntent.swift). When it runs from the watch, iOS runs it here.
///
/// It makes the same press the watch's Highlight button makes, from the last game the web app sent to the watch (kept by
/// the watch link as "watchlink.latest"), and hands it to the watch link's store of presses. The web app deals with it,
/// once, like any press from the watch. Plain Foundation, so tests/plugin can run it.
enum PhoneHighlight {
    /// Posted with an NSMutableDictionary { event }; the watch link, if it's running, takes the press and sets "handled".
    static let note = Notification.Name("gaffer.phonePress")

    /// The press to make (nil when there's nothing to mark) and what to say.
    static func press(state: String?, now: Date, id: String = UUID().uuidString) -> (event: String?, said: String) {
        guard let state = state, let data = state.data(using: .utf8),
              let game = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              game["live"] as? Bool == true else { return (nil, "No game on in Gaffer, so nothing was marked.") }
        let phase = game["phase"] as? String ?? ""
        switch phase {
        case "h1", "h2": break
        case "pre": return (nil, "The game hasn't kicked off yet, so nothing was marked.")
        case "ht": return (nil, "It's half time, so nothing was marked.")
        default: return (nil, "The game's over, so nothing was marked.")
        }
        let ms = now.timeIntervalSince1970 * 1000
        var fields: [String: Any] = ["type": "hl", "id": id, "at": ms.rounded()]
        if let gid = game["gid"] as? String, !gid.isEmpty { fields["gid"] = gid }
        guard let out = try? JSONSerialization.data(withJSONObject: fields, options: [.sortedKeys]),
              let event = String(data: out, encoding: .utf8) else { return (nil, "Couldn't mark that. Try again.") }
        let base = (game["base"] as? Double) ?? 0, t0 = (game["t0"] as? Double) ?? 0
        let running = game["running"] as? Bool == true
        let raw = (base + (running ? ms - t0 : 0)) / 1000
        let s = raw.isFinite ? Int(max(0, min(raw, 360_000))) : 0
        let half = (game["periods"] as? Int) == 1 ? "" : phase == "h1" ? " in the first half" : " in the second half"
        return (event, "Highlight marked at \(s / 60):\(s % 60 < 10 ? "0" : "")\(s % 60)\(half).")
    }

    /// Hands the press to the watch link while the app is running; otherwise (the app was started just to run this) puts it
    /// straight into the watch link's store on disk, where the web app finds it when it next wakes. Returns true if the
    /// watch link took it there and then.
    @discardableResult
    static func deliver(_ event: String, now: Date, store: UserDefaults = .standard, center: NotificationCenter = .default) -> Bool {
        let box = NSMutableDictionary(dictionary: ["event": event])
        center.post(name: note, object: box)
        if box["handled"] as? Bool == true { return true }
        guard let data = event.data(using: .utf8),
              let fields = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let id = fields["id"] as? String else { return false }
        var inbox = (store.array(forKey: "watchlink.inbox") as? [[String: Any]]) ?? []
        if !inbox.contains(where: { ($0["id"] as? String) == id }) {
            inbox.append(["id": id, "event": event, "got": now.timeIntervalSince1970 * 1000])
            store.set(inbox, forKey: "watchlink.inbox")
        }
        return false
    }
}
