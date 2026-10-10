import Foundation
import UserNotifications
import WatchConnectivity
import WatchKit

/// The watch app's link to the phone and to the wrist. What the game *is* at any moment is decided in MatchLogic.swift (WatchBrain);
/// this class delivers messages, buzzes, schedules notifications and keeps the app on screen.
final class MatchModel: NSObject, ObservableObject, WCSessionDelegate, WKExtendedRuntimeSessionDelegate, UNUserNotificationCenterDelegate {
    @Published var state: MatchState?
    @Published var locked = false
    @Published var note = ""
    @Published var askSubs = false   // the "time for subs" sheet is showing

    private var unlock: DispatchWorkItem?
    private var clearNote: DispatchWorkItem?
    private var runtime: WKExtendedRuntimeSession?                    // keeps the app on screen during a game when the wrist drops
    private var brain = WatchBrain()
    private var ticker: Timer?
    private var askedToNotify = false
    private var scheduled = ""

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
            _ = brain.receive(json: json, sent: now, now: Date())
            state = brain.state
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

    /// Once a second: the watch's own check for a change coming due, and another go at anything the phone hasn't acknowledged.
    private func watchTheClock() {
        apply(brain.tick(now: Date()))
    }

    /// Puts the brain's verdict on screen and carries out what it asked for.
    private func apply(_ outcome: WatchBrain.Outcome) {
        if state != brain.state { state = brain.state }
        if outcome.becameDue { buzzForSubs() }
        if !(brain.state?.due ?? false) || !(brain.state?.live ?? false) { if askSubs { askSubs = false } }
        for json in outcome.send { deliver(json, first: false) }
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
        // (Int64: a watch's ordinary Int is too small to hold a time in milliseconds)
        let key = coming.map { "\($0.id)@\(Int64(game.t0))-\(Int64(game.base))" }.joined(separator: ",")
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
        guard let json = payload["state"] as? String else { return }
        let sent = (payload["sent"] as? NSNumber)?.doubleValue ?? 0
        DispatchQueue.main.async {
            self.apply(self.brain.receive(json: json, sent: sent, now: Date()))
            guard let game = self.state else { return }
            self.scheduleChanges(game)
            self.stayInFront()
            let left = game.lockUntil / 1000 - Date().timeIntervalSince1970
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

    /// Sends one event to the phone. A live message wakes the phone app; if that fails it is queued for when the app next runs.
    private func deliver(_ json: String, first: Bool) {
        guard WCSession.isSupported() else { return }
        let payload: [String: Any] = ["event": json]
        let session = WCSession.default
        if session.isReachable {
            if first { say("Sending…") }
            session.sendMessage(payload, replyHandler: { [weak self] answer in
                if first { DispatchQueue.main.async { self?.say("Sent") } }
                self?.take(answer)
            }, errorHandler: { [weak self] _ in
                guard first else { return }
                session.transferUserInfo(payload)
                DispatchQueue.main.async { self?.say("Saved. It sends when your iPhone is in reach.") }
            })
        } else if first {
            session.transferUserInfo(payload)
            say("Saved. It sends when your iPhone is in reach.")
        }
    }

    /// Carries out a press: shows its effect at once, sends it, and taps the wrist.
    private func press(_ outcome: WatchBrain.Outcome) {
        if state != brain.state { state = brain.state }
        for json in outcome.send { deliver(json, first: true) }
        if !outcome.send.isEmpty { WKInterfaceDevice.current().play(.success) }
        if outcome.becameDue { buzzForSubs() }
        if let game = state { scheduleChanges(game) }
    }

    func goal(us: Bool, scorer: Int?, assist: Int?) {
        guard !locked else { return }
        press(brain.pressGoal(us: us, scorer: scorer, assist: assist, now: Date()))
        lock(for: 8)
    }

    func highlight() {
        press(brain.pressHighlight(now: Date()))
    }

    /// Kick off, or start the second half, from the wrist. The clock starts here at once and the phone follows.
    func start() {
        press(brain.pressStart(now: Date()))
        stayInFront()
    }

    /// The players have swapped: stop asking here straight away, and keep telling the phone until it has taken it in.
    func subsDone() {
        askSubs = false
        press(brain.pressSubsDone(now: Date()))
    }
}
