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
    @Published var waiting = 0       // presses the phone hasn't yet said it has dealt with

    private var unlock: DispatchWorkItem?
    private var clearNote: DispatchWorkItem?
    private var runtime: WKExtendedRuntimeSession?                    // keeps the app running during a game when the wrist drops
    private var runtimeNotBefore = Date.distantPast                   // so a session that won't start isn't tried again every second
    private var runtimeSince = Date.distantPast                       // when the session now running was started
    private var renewing = false                                      // the old session is being ended so a fresh one can take over
    private var brain = WatchBrain()
    private var ticker: Timer?
    private var askedToNotify = false
    private var scheduled = ""
    private let savedBrain = "watch.brain"

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
        restore()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
        UNUserNotificationCenter.current().delegate = self
        // The watch keeps its own eye on the clock, so a change still buzzes the wrist when the phone app is asleep in a pocket.
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.watchTheClock() }
        RunLoop.main.add(timer, forMode: .common)
        ticker = timer
    }

    // MARK: - Surviving a restart

    /// watchOS can close the app mid-game (or it can crash). What the watch knew, and what it was still waiting to tell the phone,
    /// is kept so it carries straight on when it reopens.
    private func keep() {
        guard let data = try? JSONEncoder().encode(brain) else { return }
        UserDefaults.standard.set(data, forKey: savedBrain)
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: savedBrain + ".at")
    }

    private func restore() {
        let store = UserDefaults.standard
        // If the app has died three times running within moments of opening, what was saved is the likeliest cause: start clean.
        // (Three, and a short wait, so that being opened in the background and put straight back to sleep never counts.)
        let strikesKey = savedBrain + ".strikes"
        let strikes = store.integer(forKey: strikesKey)
        store.set(strikes + 1, forKey: strikesKey)
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { store.set(0, forKey: strikesKey) } // it got going fine
        if strikes >= 3 {
            store.removeObject(forKey: savedBrain)
            return
        }
        let age = Date().timeIntervalSince1970 - store.double(forKey: savedBrain + ".at")
        guard age >= 0, age < 3 * 60 * 60, let data = store.data(forKey: savedBrain), let old = try? JSONDecoder().decode(WatchBrain.self, from: data) else { return }
        brain = old
        state = old.state
        waiting = old.presses.count
    }

    // MARK: - Changes coming due

    /// Once a second: the watch's own check for a change coming due, and another go at anything the phone hasn't acknowledged.
    private func watchTheClock() {
        apply(brain.tick(now: Date()))
        stayInFront() // (does nothing unless a session is wanted and missing, or its hour is running out)
    }

    /// Puts the brain's verdict on screen and carries out what it asked for.
    private func apply(_ outcome: WatchBrain.Outcome, save: Bool = false) {
        let changed = state != brain.state
        if changed { state = brain.state }
        if changed || save || outcome.becameDue || outcome.timeUp { keep() }
        if outcome.becameDue { buzzForSubs() }
        if outcome.timeUp { buzzForTime() }
        if !(brain.state?.due ?? false) || !(brain.state?.live ?? false) { if askSubs { askSubs = false } }
        if waiting != brain.presses.count { waiting = brain.presses.count }
        for json in outcome.send { deliver(json, first: false) }
    }

    /// Three firm taps, so it's felt mid-game, and the sheet asking for the change.
    private func buzzForSubs() {
        askSubs = true
        for step in 0..<3 {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(step) * 0.7) { WKInterfaceDevice.current().play(.notification) }
        }
    }

    /// The half has run out: two long taps, different from the three for subs. The clock carries on until the whistle is pressed.
    private func buzzForTime() {
        for step in 0..<2 {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(step) * 0.9) { WKInterfaceDevice.current().play(.stop) }
        }
        say("Time's up")
    }

    /// A notification on the watch itself at each change still to come this half, for when the app isn't on screen.
    private func scheduleChanges(_ game: MatchState) {
        let center = UNUserNotificationCenter.current()
        if game.live && !askedToNotify { // asked once, when a game first shows, so the question never arrives in the middle of kick-off
            askedToNotify = true
            center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
        }
        let live = game.live && game.running && (game.phase == "h1" || game.phase == "h2")
        let now = game.seconds(at: Date())
        let coming = live ? game.changes.filter { $0.h == game.halfIndex && $0.from * 60 - now > 3 } : []
        // (the times go into the key as they are: a watch's ordinary Int is too small to hold a time in milliseconds)
        let whistle = live ? game.half * 60 - now : 0 // seconds until the half runs out
        let key = coming.map { "\($0.id)@\(game.t0)-\(game.base)" }.joined(separator: ",") + (whistle > 3 ? "|end@\(game.t0)-\(game.base)" : "")
        if key == scheduled { return }
        scheduled = key
        center.removeAllPendingNotificationRequests()
        guard !coming.isEmpty || whistle > 3 else { return }
        for change in coming {
            let content = UNMutableNotificationContent()
            content.title = "Time for subs"
            content.body = "Off: \(change.off.joined(separator: ", ")). On: \(change.on.joined(separator: ", "))."
            content.sound = .default
            let wait = TimeInterval(change.from * 60 - now)
            center.add(UNNotificationRequest(identifier: "change-\(change.id)", content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: wait, repeats: false)))
        }
        if whistle > 3 {
            let content = UNMutableNotificationContent()
            content.title = "Time's up"
            content.body = game.lastHalf ? "Blow for full time when you're ready." : "Blow for half time when you're ready."
            content.sound = .default
            center.add(UNNotificationRequest(identifier: "time-up", content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: TimeInterval(whistle), repeats: false)))
        }
    }

    /// Looking at the app, the sheet and the taps do the job, so the banner stays away. With the wrist down the app's own taps
    /// may not be felt, so then the watch shows the notification and buzzes for it itself.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        DispatchQueue.main.async {
            completionHandler(WKApplication.shared().applicationState == .active ? [] : [.banner, .sound, .list])
        }
    }

    // MARK: - From the phone

    private func take(_ payload: [String: Any]) {
        guard let json = payload["state"] as? String else { return }
        let sent = (payload["sent"] as? NSNumber)?.doubleValue ?? 0
        DispatchQueue.main.async {
            let before = self.state?.phase
            self.apply(self.brain.receive(json: json, sent: sent, now: Date()), save: true)
            guard let game = self.state else { return }
            self.scheduleChanges(game)
            self.stayInFront()
            // a half started on the phone while this app is on screen: the same fresh hour as starting it from here
            if game.inPlay, game.running, before == "pre" || before == "ht", WKApplication.shared().applicationState == .active { self.renewIfShort() }
            let left = game.lockUntil / 1000 - Date().timeIntervalSince1970
            if left > 0 { self.lock(for: min(left, 8)) }
        }
    }

    // MARK: - Staying on screen

    /// During a game the app keeps running when the wrist is lowered, so its own clock can buzz for a change and a glance shows
    /// the time. A session lasts up to an hour and can only be started with the app on screen; if it has ended (or never
    /// started), the next moment the app is on screen starts another. Called every second, so it mends itself.
    func stayInFront() {
        let wanted = (state?.live ?? false) && state?.phase != "ft"
        guard wanted else {
            runtime?.invalidate()
            runtime = nil
            return
        }
        // One under way, or about to be: leave it. (Starting a second alongside it is refused, and both can be lost.)
        if let current = runtime, current.state != .invalid { return }
        guard WKApplication.shared().applicationState == .active, Date() >= runtimeNotBefore else { return }
        runtimeNotBefore = Date().addingTimeInterval(5) // one that won't start isn't tried again every second
        let session = WKExtendedRuntimeSession()
        session.delegate = self
        session.start()
        runtime = session
        runtimeSince = Date()
    }

    /// A session lasts an hour from when it started, which may have been when the game was set up, well before kick-off.
    /// Called when a half is started from the wrist (so the app is on screen): if the hour wouldn't see the game out,
    /// the session is ended and a fresh one started in its place.
    private func renewIfShort() {
        guard let current = runtime, current.state == .running, let game = state, !renewing else { return }
        let toPlay = Double(game.half) * 60 * (game.phase == "h1" && game.periods != 1 ? 2 : 1) + (game.phase == "h1" && game.periods != 1 ? 10 * 60 : 0) + 8 * 60
        guard Date().timeIntervalSince(runtimeSince) + toPlay > 58 * 60 else { return }
        renewing = true
        runtimeNotBefore = Date.distantPast
        current.invalidate() // the fresh one is started when this one reports it has ended (below), or by the next second's check
    }

    func extendedRuntimeSessionDidStart(_ extendedRuntimeSession: WKExtendedRuntimeSession) {}
    func extendedRuntimeSessionWillExpire(_ extendedRuntimeSession: WKExtendedRuntimeSession) {}
    func extendedRuntimeSession(_ extendedRuntimeSession: WKExtendedRuntimeSession, didInvalidateWith reason: WKExtendedRuntimeSessionInvalidationReason, error: Error?) {
        DispatchQueue.main.async {
            if self.runtime === extendedRuntimeSession { self.runtime = nil }
            if self.renewing { self.renewing = false; self.runtimeNotBefore = Date.distantPast; self.stayInFront() }
        }
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
        if waiting != brain.presses.count { waiting = brain.presses.count }
        keep()
        for json in outcome.send { deliver(json, first: true) }
        if !outcome.send.isEmpty { WKInterfaceDevice.current().play(.success) }
        if outcome.becameDue { buzzForSubs() }
        if let game = state { scheduleChanges(game) }
    }

    func goal(us: Bool, scorer: Int?, assist: Int?) {
        guard !locked else {
            say("Not logged: a goal went in on the score a moment ago.") // (the lock is there so one goal isn't counted twice)
            return
        }
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
        renewIfShort()
    }

    /// The clock was stopped on the phone and play is back on: start it again from the wrist.
    func resume() {
        press(brain.pressResume(now: Date()))
    }

    /// The whistle, from the wrist: half time, or full time in the last half.
    func endHalf() {
        askSubs = false
        press(brain.pressEnd(now: Date()))
        stayInFront()
    }

    /// The players have swapped: stop asking here straight away, and keep telling the phone until it has taken it in.
    func subsDone() {
        askSubs = false
        press(brain.pressSubsDone(now: Date()))
    }
}
