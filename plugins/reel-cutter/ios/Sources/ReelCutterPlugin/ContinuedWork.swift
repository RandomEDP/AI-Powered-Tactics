import Foundation
#if canImport(BackgroundTasks)
import BackgroundTasks
#endif

/// iOS's own progress card for a long job the person started, such as cutting a game's highlights (Ethan, October 2026:
/// "use a different app etc while it does that"). This is iOS 26's continued processing: while the card is up, iOS lets
/// Gaffer carry on with the app put away, and shows the title, the line under it and how far it's got as a Live Activity
/// on the Lock Screen and at the top of the screen, with a button to stop it. On an older iOS, or if iOS says no, nothing
/// shows and the work carries on as before, only while Gaffer is open (and a little after).
///
/// It only mirrors the work: the cut runs whether or not the card was given (as Apple's own engineers advise), so a card
/// that never starts can't hold anything up. When the card goes before the work is done, `onEnded` is called, and the work
/// carries on (only while Gaffer is open, as on an older iOS). iOS gives no way to tell the card's own stop button from iOS
/// taking the card back (it does that to a card whose progress stands still, or when it needs the phone for something
/// else), and Ethan lost a whole cut to the second (November 2026), so the card ending never throws the work away: Gaffer
/// has its own Stop for that.
///
/// The card's progress moves on a little every few seconds even when the work's own number doesn't (a long upload, the
/// commentary being made), so iOS never sees it standing still.
final class ContinuedWork {
    static let shared = ContinuedWork()
    private let lock = NSLock()
    private var task: AnyObject?          // the BGContinuedProcessingTask, once iOS has started it
    private var now: (title: String, subtitle: String, p: Double)?
    private var live = false
    private var beat: DispatchSourceTimer?
    private var lastShown = Date.distantPast
    var onEnded: (() -> Void)?
    /// Units the card's progress is counted in (fine enough to move on by one without anyone seeing it).
    static let units: Int64 = 100_000

    /// Asks iOS for the card; true if it was asked for (iOS 26 and later). `prefix` must match an entry in the app's
    /// BGTaskSchedulerPermittedIdentifiers (Info.plist: `$(PRODUCT_BUNDLE_IDENTIFIER).work.*`). Call it on the main thread.
    func start(prefix: String, title: String, subtitle: String) -> Bool {
        #if compiler(>=6.2) && canImport(BackgroundTasks)
        let allowed = Bundle.main.object(forInfoDictionaryKey: "BGTaskSchedulerPermittedIdentifiers") as? [String] ?? []
        guard allowed.contains(prefix + ".*") else { return false } // (iOS stops the app for a name the Info.plist doesn't allow)
        if #available(iOS 26.0, *) {
            end(ok: false) // (one at a time)
            let id = prefix + "." + String(Int64(Date().timeIntervalSince1970 * 1000)) // (a new name every time: the same one twice crashes)
            lock.lock(); live = true; now = (title, subtitle, 0); lock.unlock()
            let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: DispatchQueue.main) { [weak self] raw in
                guard let task = raw as? BGContinuedProcessingTask else { raw.setTaskCompleted(success: false); return }
                guard let self = self else { task.setTaskCompleted(success: false); return }
                self.lock.lock(); let still = self.live; if still { self.task = task }; let shown = self.now; self.lock.unlock()
                guard still else { task.setTaskCompleted(success: true); return } // (the work finished before iOS got to it)
                task.expirationHandler = { [weak self, weak task] in if let task = task { self?.expired(task) } }
                task.progress.totalUnitCount = ContinuedWork.units
                if let shown = shown { self.show(task, shown.title, shown.subtitle, shown.p) }
                self.heartbeat()
            }
            guard registered else { lock.lock(); live = false; now = nil; lock.unlock(); return false }
            let request = BGContinuedProcessingTaskRequest(identifier: id, title: title, subtitle: subtitle)
            request.strategy = .fail // (now or not at all: a card that turns up after the work has finished would only confuse)
            do { try BGTaskScheduler.shared.submit(request) } catch { lock.lock(); live = false; now = nil; lock.unlock(); return false }
            return true
        }
        #endif
        return false
    }

    /// What the card says and how far along it is (p from 0 to 1). A title of nil keeps the one it has.
    func update(title: String?, subtitle: String, p: Double) {
        lock.lock()
        guard live else { lock.unlock(); return }
        let t = title ?? now?.title ?? ""
        now = (t, subtitle, p)
        let current = task
        lock.unlock()
        #if compiler(>=6.2) && canImport(BackgroundTasks)
        if #available(iOS 26.0, *), let running = current as? BGContinuedProcessingTask {
            DispatchQueue.main.async { self.show(running, t, subtitle, p) }
        }
        #endif
    }

    /// The work is over: the card goes (ok: it finished; otherwise it stopped or failed).
    func end(ok: Bool) {
        lock.lock(); live = false; now = nil; let current = task; task = nil; let b = beat; beat = nil; lock.unlock()
        b?.cancel()
        #if compiler(>=6.2) && canImport(BackgroundTasks)
        if #available(iOS 26.0, *), let running = current as? BGContinuedProcessingTask {
            let close = {
                if ok { running.progress.completedUnitCount = running.progress.totalUnitCount }
                running.setTaskCompleted(success: ok)
            }
            if Thread.isMainThread { close() } else { DispatchQueue.main.async(execute: close) }
        }
        #endif
    }

    #if compiler(>=6.2) && canImport(BackgroundTasks)
    @available(iOS 26.0, *)
    private func show(_ task: BGContinuedProcessingTask, _ title: String, _ subtitle: String, _ p: Double) {
        task.updateTitle(title, subtitle: subtitle)
        task.progress.completedUnitCount = ContinuedWork.nextUnits(shown: task.progress.completedUnitCount, p: p)
        lastShown = Date()
    }

    /// Every 5 seconds: if nothing has moved the card on for 10, move it on by one unit (see the top).
    @available(iOS 26.0, *)
    private func heartbeat() {
        let t = DispatchSource.makeTimerSource(queue: .main)
        t.schedule(deadline: .now() + 5, repeating: 5)
        t.setEventHandler { [weak self] in
            guard let self = self else { return }
            self.lock.lock(); let running = self.task as? BGContinuedProcessingTask; let shown = self.now; self.lock.unlock()
            guard let task = running, let shown = shown, Date().timeIntervalSince(self.lastShown) >= 10 else { return }
            self.show(task, shown.title, shown.subtitle, shown.p)
        }
        lock.lock(); beat?.cancel(); beat = t; lock.unlock()
        t.resume()
    }

    @available(iOS 26.0, *)
    private func expired(_ task: BGContinuedProcessingTask) { // stopped from the card, or iOS needed the phone for something else
        lock.lock(); let mine = self.task === task; var b: DispatchSourceTimer?; if mine { live = false; now = nil; self.task = nil; b = beat; beat = nil }; lock.unlock()
        b?.cancel()
        task.setTaskCompleted(success: false)
        if mine { onEnded?() } // (the work carries on: see the top)
    }
    #endif

    /// Where the card's progress goes next: the work's own number when it's further on, else one unit on from where it is,
    /// never backwards and never full (only end() says it's finished). Plain arithmetic, tested in tests/continued.
    static func nextUnits(shown: Int64, p: Double) -> Int64 {
        let cap = units - units / 1000
        let want = Int64((max(0, min(1, p)) * Double(units)).rounded())
        return min(cap, max(want, shown + 1))
    }
}
