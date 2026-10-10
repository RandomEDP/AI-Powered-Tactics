import Foundation
import UserNotifications
import WatchConnectivity
import WatchKit

/// The game in progress, as the iPhone app describes it. The watch never talks to the server:
/// the phone sends this whenever something changes, and the watch sends goals and highlights back.
struct MatchState: Codable, Equatable {
    struct Change: Codable, Equatable, Identifiable {
        var h: Int          // 0 = first half, 1 = second half
        var from: Int       // minute of that half
        var on: [String]
        var off: [String]
        var id: String { "\(h)-\(from)" }
    }

    struct Player: Codable, Equatable, Identifiable {
        var id: Int
        var name: String
        var on: Bool
        var gk: Bool = false

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(Int.self, forKey: .id)
            name = (try? c.decode(String.self, forKey: .name)) ?? ""
            on = (try? c.decode(Bool.self, forKey: .on)) ?? false
            gk = (try? c.decode(Bool.self, forKey: .gk)) ?? false
        }
    }

    var live: Bool
    var due: Bool = false       // the first change in `changes` is waiting to be made
    var team: String = ""
    var opp: String = ""
    var us: Int = 0
    var them: Int = 0
    var phase: String = "pre"   // pre, h1, ht, h2, ft
    var running: Bool = false
    var base: Double = 0        // milliseconds on the half's clock when it was last started or stopped
    var t0: Double = 0          // when the clock was last started, in milliseconds since 1970
    var half: Int = 15
    var periods: Int = 2       // 1 = one period with no half time
    var lockUntil: Double = 0
    var changes: [Change] = []
    var players: [Player] = []

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        live = (try? c.decode(Bool.self, forKey: .live)) ?? false
        due = (try? c.decode(Bool.self, forKey: .due)) ?? false
        team = (try? c.decode(String.self, forKey: .team)) ?? ""
        opp = (try? c.decode(String.self, forKey: .opp)) ?? ""
        us = (try? c.decode(Int.self, forKey: .us)) ?? 0
        them = (try? c.decode(Int.self, forKey: .them)) ?? 0
        phase = (try? c.decode(String.self, forKey: .phase)) ?? "pre"
        running = (try? c.decode(Bool.self, forKey: .running)) ?? false
        base = (try? c.decode(Double.self, forKey: .base)) ?? 0
        t0 = (try? c.decode(Double.self, forKey: .t0)) ?? 0
        half = (try? c.decode(Int.self, forKey: .half)) ?? 15
        periods = (try? c.decode(Int.self, forKey: .periods)) ?? 2
        lockUntil = (try? c.decode(Double.self, forKey: .lockUntil)) ?? 0
        changes = (try? c.decode([Change].self, forKey: .changes)) ?? []
        players = (try? c.decode([Player].self, forKey: .players)) ?? []
    }

    /// Seconds on the current half's clock.
    func seconds(at date: Date) -> Int {
        let now = date.timeIntervalSince1970 * 1000
        return max(0, Int((base + (running ? now - t0 : 0)) / 1000))
    }

    var halfIndex: Int { phase == "h2" || phase == "ft" ? 1 : 0 }
}

final class MatchModel: NSObject, ObservableObject, WCSessionDelegate, WKExtendedRuntimeSessionDelegate, UNUserNotificationCenterDelegate {
    @Published var state: MatchState?
    @Published var locked = false
    @Published var note = ""
    @Published var askSubs = false   // the "time for subs" sheet is showing

    private var unlock: DispatchWorkItem?
    private var clearNote: DispatchWorkItem?
    private var runtime: WKExtendedRuntimeSession?                    // keeps the app on screen during a game when the wrist drops
    private var confirmed: (id: String, at: Date)?                    // a change marked done on this watch, until the phone agrees
    private var ticker: Timer?
    private var askedToNotify = false
    private var scheduled = ""
    private var startedHere: Date?                                    // kick-off pressed on this watch, until the phone agrees
    private var newest = 0.0                                          // when the phone sent the game now showing
    private var hold: (us: Int, them: Int, until: Date)?              // a goal logged here that the phone hasn't counted yet

    /// Set only in the simulator, to take the App Store screenshots: which part of the screen to show.
    @Published var demoPage: Int?

    override init() {
        super.init()
        #if targetEnvironment(simulator)
        if let page = ProcessInfo.processInfo.environment["TACTICS_DEMO"] {
            let now = Date().timeIntervalSince1970 * 1000
            let json = "{\"live\":true,\"team\":\"SOP FC\",\"opp\":\"Borussia Teeth\",\"us\":2,\"them\":1,\"phase\":\"h1\",\"running\":true,\"base\":0,\"t0\":\(now - 464000),\"half\":15,\"lockUntil\":0,"
                + "\"changes\":[{\"h\":0,\"from\":10,\"on\":[\"Tobi\",\"Dev\"],\"off\":[\"Kofi\",\"Ezra\"]},{\"h\":1,\"from\":0,\"on\":[\"Kofi\",\"Ezra\"],\"off\":[\"Luca\",\"Ash\"]}],"
                + "\"players\":[{\"id\":8,\"name\":\"Ezra\",\"on\":true},{\"id\":4,\"name\":\"Kofi\",\"on\":true},{\"id\":5,\"name\":\"Luca\",\"on\":true},{\"id\":6,\"name\":\"Ash\",\"on\":true},{\"id\":2,\"name\":\"Tobi\",\"on\":false},{\"id\":3,\"name\":\"Dev\",\"on\":false}]}"
            state = try? JSONDecoder().decode(MatchState.self, from: Data(json.utf8))
            demoPage = Int(page) ?? 0
            return
        }
        #endif
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
        UNUserNotificationCenter.current().delegate = self
        // The watch keeps its own eye on the clock, so a change still buzzes the wrist when the phone app is asleep in a pocket.
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.watchTheClock() }
        RunLoop.main.add(timer, forMode: .common)
        ticker = timer
    }

    // MARK: - Changes coming due

    /// Works out for itself whether the next change is due, and forgets one that has already been marked done here.
    private func settle(_ game: inout MatchState) {
        if let done = confirmed {
            if let first = game.changes.first, first.id == done.id, Date().timeIntervalSince(done.at) < 180 {
                game.changes.removeFirst()
                game.due = false
            } else {
                confirmed = nil
            }
        }
        if !game.due, game.live, game.running, game.phase == "h1" || game.phase == "h2",
           let first = game.changes.first, first.h == game.halfIndex, game.seconds(at: Date()) >= first.from * 60 {
            game.due = true
        }
    }

    private func watchTheClock() {
        guard var game = state, game.live else { return }
        let was = game.due
        settle(&game)
        if game.due && !was {
            state = game
            buzzForSubs()
        }
    }

    /// Three firm taps, so it's felt mid-game, and the sheet asking for the change.
    private func buzzForSubs() {
        askSubs = true
        for step in 0..<3 {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(step) * 0.7) { WKInterfaceDevice.current().play(.notification) }
        }
    }

    /// A notification on the watch itself at each change still to come this half, for when the app isn't on screen.
    private func scheduleChanges(_ game: MatchState) {
        let center = UNUserNotificationCenter.current()
        let live = game.live && game.running && (game.phase == "h1" || game.phase == "h2")
        let now = game.seconds(at: Date())
        let coming = live ? game.changes.filter { $0.h == game.halfIndex && $0.from * 60 - now > 3 } : []
        let key = coming.map { "\($0.id)@\(Int(game.t0))-\(Int(game.base))" }.joined(separator: ",")
        if key == scheduled { return }
        scheduled = key
        center.removeAllPendingNotificationRequests()
        guard !coming.isEmpty else { return }
        if !askedToNotify {
            askedToNotify = true
            center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
        }
        for change in coming {
            let content = UNMutableNotificationContent()
            content.title = "Time for subs"
            content.body = "Off: \(change.off.joined(separator: ", ")). On: \(change.on.joined(separator: ", "))."
            content.sound = .default
            let wait = TimeInterval(change.from * 60 - now)
            center.add(UNNotificationRequest(identifier: "change-\(change.id)", content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: wait, repeats: false)))
        }
    }

    /// With the app on screen the sheet and the taps do the job, so the banner stays away.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([])
    }

    // MARK: - From the phone

    private func take(_ payload: [String: Any]) {
        guard let json = payload["state"] as? String, let data = json.data(using: .utf8),
              var decoded = try? JSONDecoder().decode(MatchState.self, from: data) else { return }
        let sent = (payload["sent"] as? NSNumber)?.doubleValue ?? 0
        DispatchQueue.main.async {
            if sent > 0 && sent < self.newest { return } // an older update that arrived late
            if sent > 0 { self.newest = sent }
            // Kick-off pressed here: until the phone has caught up, don't fall back to "before kick-off".
            if let pressed = self.startedHere {
                if decoded.phase == "pre" || decoded.phase == "ht", Date().timeIntervalSince(pressed) < 30, let mine = self.state { decoded.phase = mine.phase; decoded.base = mine.base; decoded.t0 = mine.t0; decoded.running = mine.running } else { self.startedHere = nil }
            }
            // A goal logged on this watch shows straight away. Until the phone has counted it, don't let an older score undo it.
            if let hold = self.hold {
                if !decoded.live || Date() > hold.until || decoded.us + decoded.them >= hold.us + hold.them { self.hold = nil } else {
                    decoded.us = max(decoded.us, hold.us)
                    decoded.them = max(decoded.them, hold.them)
                }
            }
            let wasDue = self.state?.due ?? false
            self.settle(&decoded)
            self.state = decoded
            self.scheduleChanges(decoded)
            if decoded.live && decoded.due && !wasDue { // a change has just come due: tap the wrist and ask
                self.buzzForSubs()
            } else if !decoded.due || !decoded.live {
                self.askSubs = false
            }
            self.stayInFront()
            let left = decoded.lockUntil / 1000 - Date().timeIntervalSince1970
            if left > 0 { self.lock(for: min(left, 8)) }
        }
    }

    // MARK: - Staying on screen

    /// During a game the app stays in front when the wrist is lowered, so a glance always shows the clock. One session lasts up to an hour.
    func stayInFront() {
        let wanted = (state?.live ?? false) && state?.phase != "ft"
        if !wanted {
            runtime?.invalidate()
            runtime = nil
            return
        }
        if let running = runtime, running.state == .running || running.state == .scheduled { return }
        guard WKApplication.shared().applicationState == .active else { return } // can only be started with the app on screen
        let session = WKExtendedRuntimeSession()
        session.delegate = self
        session.start()
        runtime = session
    }

    func extendedRuntimeSessionDidStart(_ extendedRuntimeSession: WKExtendedRuntimeSession) {}
    func extendedRuntimeSessionWillExpire(_ extendedRuntimeSession: WKExtendedRuntimeSession) {}
    func extendedRuntimeSession(_ extendedRuntimeSession: WKExtendedRuntimeSession, didInvalidateWith reason: WKExtendedRuntimeSessionInvalidationReason, error: Error?) {
        DispatchQueue.main.async { if self.runtime === extendedRuntimeSession { self.runtime = nil } }
    }

    /// Ask the phone for the game as it stands now. Called when the watch app opens or comes back to the front.
    func refresh() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        DispatchQueue.main.async { self.stayInFront() }
        take(session.receivedApplicationContext)
        if session.isReachable {
            session.sendMessage(["event": "{\"type\":\"hello\"}"], replyHandler: { [weak self] answer in self?.take(answer) }, errorHandler: nil)
        }
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        refresh()
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        take(applicationContext)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        take(message)
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        refresh()
    }

    // MARK: - To the phone

    private func lock(for seconds: Double) {
        locked = true
        unlock?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.locked = false }
        unlock = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    private func say(_ text: String) {
        note = text
        clearNote?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.note = "" }
        clearNote = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 6, execute: work)
    }

    private func send(_ event: [String: Any]) {
        var event = event
        event["id"] = UUID().uuidString
        event["at"] = Date().timeIntervalSince1970 * 1000
        guard let data = try? JSONSerialization.data(withJSONObject: event), let json = String(data: data, encoding: .utf8) else { return }
        let payload: [String: Any] = ["event": json]
        let session = WCSession.default
        if session.isReachable {
            say("Sending…")
            session.sendMessage(payload, replyHandler: { [weak self] answer in
                DispatchQueue.main.async { self?.say("Sent") }
                self?.take(answer)
            }, errorHandler: { [weak self] _ in
                session.transferUserInfo(payload) // queued, and delivered when the phone app is next running
                DispatchQueue.main.async { self?.say("Saved. It sends when your iPhone is in reach.") }
            })
        } else {
            session.transferUserInfo(payload)
            say("Saved. It sends when your iPhone is in reach.")
        }
        WKInterfaceDevice.current().play(.success)
    }

    func goal(us: Bool, scorer: Int?, assist: Int?) {
        guard !locked else { return }
        var event: [String: Any] = ["type": "goal", "us": us]
        if let scorer = scorer { event["p"] = scorer }
        if let assist = assist { event["a"] = assist }
        send(event)
        if var shown = state { // show it now; the phone's count catches up
            if us { shown.us += 1 } else { shown.them += 1 }
            hold = (us: shown.us, them: shown.them, until: Date().addingTimeInterval(90))
            state = shown
        }
        lock(for: 8)
    }

    func highlight() {
        send(["type": "hl"])
    }

    /// Kick off, or start the second half, from the wrist. The clock starts here at once and the phone follows.
    func start() {
        guard var shown = state, shown.phase == "pre" || shown.phase == "ht" else { return }
        shown.phase = shown.phase == "pre" ? "h1" : "h2"
        shown.base = 0
        shown.t0 = Date().timeIntervalSince1970 * 1000
        shown.running = true
        state = shown
        startedHere = Date()
        send(["type": "start"])
    }

    /// The players have swapped: tell the phone, and stop asking here straight away.
    func subsDone() {
        askSubs = false
        if var shown = state {
            if let first = shown.changes.first { confirmed = (id: first.id, at: Date()); shown.changes.removeFirst() }
            shown.due = false
            state = shown
        }
        send(["type": "subs"])
    }
}
