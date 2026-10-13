import Foundation

// Everything the watch decides for itself about a game, with no screen, radio or clock of its own in here:
// the caller passes in the time and delivers the messages. That keeps it testable; tests/watch/main.swift
// plays whole games through it on every build.

/// The game in progress, as the iPhone app describes it. The watch never talks to the server:
/// the phone sends this whenever something changes, and the watch sends goals and other presses back.
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
    var gid: String = ""        // which game this is, so nothing from the last one is carried into the next
    var acks: [String] = []     // presses from this watch that the phone has dealt with
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
    var periods: Int = 2        // 1 = one period with no half time
    var lockUntil: Double = 0
    var changes: [Change] = []
    var players: [Player] = []

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        live = (try? c.decode(Bool.self, forKey: .live)) ?? false
        gid = (try? c.decode(String.self, forKey: .gid)) ?? ""
        acks = (try? c.decode([String].self, forKey: .acks)) ?? []
        due = (try? c.decode(Bool.self, forKey: .due)) ?? false
        team = (try? c.decode(String.self, forKey: .team)) ?? ""
        opp = (try? c.decode(String.self, forKey: .opp)) ?? ""
        us = (try? c.decode(Int.self, forKey: .us)) ?? 0
        them = (try? c.decode(Int.self, forKey: .them)) ?? 0
        phase = (try? c.decode(String.self, forKey: .phase)) ?? "pre"
        running = (try? c.decode(Bool.self, forKey: .running)) ?? false
        base = (try? c.decode(Double.self, forKey: .base)) ?? 0
        t0 = (try? c.decode(Double.self, forKey: .t0)) ?? 0
        half = min(max((try? c.decode(Int.self, forKey: .half)) ?? 15, 1), 200) // (kept small: minutes are multiplied up to seconds in a 32-bit Int)
        periods = (try? c.decode(Int.self, forKey: .periods)) ?? 2
        lockUntil = (try? c.decode(Double.self, forKey: .lockUntil)) ?? 0
        changes = ((try? c.decode([Change].self, forKey: .changes)) ?? []).filter { ($0.h == 0 || $0.h == 1) && $0.from >= 0 && $0.from <= 200 }
        players = (try? c.decode([Player].self, forKey: .players)) ?? []
    }

    /// Seconds on the current half's clock. (Worked out in Double and capped: a watch's ordinary Int is 32 bits,
    /// far too small for a time in milliseconds.)
    func seconds(at date: Date) -> Int {
        let now = date.timeIntervalSince1970 * 1000
        let seconds = (base + (running ? now - t0 : 0)) / 1000
        return seconds.isFinite ? Int(max(0, min(seconds, 360_000))) : 0
    }

    var halfIndex: Int { phase == "h2" || phase == "ft" ? 1 : 0 }
    /// Who a highlight can be for: the outfield players on the pitch now.
    var highlightPlayers: [Player] { players.filter { $0.on && !$0.gk } }
    var inPlay: Bool { phase == "h1" || phase == "h2" }
    var playing: Bool { live && running && inPlay }
    /// The whistle that ends this half is the final one.
    var lastHalf: Bool { phase == "h2" || periods == 1 }
    /// How far through the game a phase is: pre, first half, half time, second half, full time.
    static func order(_ phase: String) -> Int { ["pre": 0, "h1": 1, "ht": 2, "h2": 3, "ft": 4][phase] ?? 0 }
}

/// The watch's own judgement, kept apart from what the phone last said.
///
/// The phone can be asleep in a pocket for minutes at a time, and its updates can arrive late, twice or out of order.
/// So anything pressed on the watch takes effect here at once and stays in effect until the phone says it has dealt
/// with that press (it lists the presses it has taken in), and each press is sent again every few seconds until then.
struct WatchBrain: Codable {
    /// Something pressed on the watch that the phone hasn't yet shown it has taken in.
    struct Press: Codable, Equatable {
        var id: String
        var kind: String        // start, end, resume, subs, goal
        var json: String
        var made: Date
        var lastSent: Date
        var change: String?     // for "subs": the change that was confirmed
    }

    struct Outcome: Equatable {
        var becameDue = false   // a change has just come due: buzz and ask
        var timeUp = false      // the half has just run out: buzz
        var send: [String] = [] // events (JSON) to deliver to the phone now
    }

    private struct Held: Codable { var us: Int; var them: Int; var until: Date }  // the score after a goal logged here
    private struct Claim: Codable { var phase: String; var t0: Double }           // where the whistle pressed here has taken the game
    private struct Ending: Codable { var sent: Double; var at: Date }             // the phone said "no game" mid-game
    private struct Resumed: Codable { var phase: String; var base: Double; var t0: Double } // the clock restarted here after a stoppage

    private(set) var state: MatchState?
    private(set) var presses: [Press] = []
    private var newest = 0.0                // when the phone sent the newest update taken in
    private var gid = ""                    // the game all of this belongs to
    private var held: Held?                 // until the phone has counted the goal
    private var done: Set<String> = []      // changes confirmed on this watch, for the rest of the game
    private var called: Set<String> = []    // halves whose "time's up" buzz has been given
    private var claim: Claim?               // until the phone has caught up with the whistle
    private var ending: Ending?             // believed only when the phone says so again
    private var resumed: Resumed?           // until the phone's clock is running again too

    static let resendEvery: TimeInterval = 30 // (the phone keeps every press it receives, so this is only a safety net)
    static let believeAfter: TimeInterval = 20 // a lone "no game" that nothing has contradicted for this long is true
    static let giveUpAfter: TimeInterval = 3 * 60 * 60 // longer than any game: a phone asleep in a bag for a whole half still gets everything

    init() {}

    /// For the simulator's screenshots only.
    init(showing state: MatchState?) { self.state = state }

    // MARK: From the phone

    /// Takes in an update from the phone. `sent` is the phone's clock when it sent it (0 if unknown).
    mutating func receive(json: String, sent: Double, now: Date) -> Outcome {
        guard let data = json.data(using: .utf8), var game = try? JSONDecoder().decode(MatchState.self, from: data) else { return Outcome() }
        if sent > 0 && sent < newest { return Outcome() } // an older update that arrived late
        if sent > 0 { newest = sent }

        if !game.live {
            // "No game" in the middle of one is usually the phone app waking up before it has found its feet.
            // Believe it only when a second, later update says the same at least a few seconds on.
            if let current = state, current.live, current.inPlay || current.phase == "ht" || claim != nil {
                if let first = ending, first.sent != sent && now.timeIntervalSince(first.at) >= 3 || now.timeIntervalSince(first.at) >= WatchBrain.believeAfter {
                    // confirmed: fall through and clear everything
                } else {
                    if ending == nil { ending = Ending(sent: sent, at: now) }
                    return Outcome()
                }
            }
            forgetGame()
            gid = ""
            state = game
            return Outcome()
        }
        ending = nil

        // A different game from the one this watch was following: nothing carries over.
        if !game.gid.isEmpty && game.gid != gid {
            forgetGame()
            gid = game.gid
        }

        // The phone lists the presses it has dealt with. Those are finished, whatever it did with them.
        if !game.acks.isEmpty {
            let acked = Set(game.acks)
            presses.removeAll { acked.contains($0.id) }
        }
        game.acks = []

        // A whistle pressed here (kick-off, half time, second half, full time): the watch's word stands until
        // the phone has caught up, or has dealt with every one of those presses and still says otherwise.
        if let mine = claim {
            if MatchState.order(game.phase) >= MatchState.order(mine.phase) || !presses.contains(where: { $0.kind == "start" || $0.kind == "end" }) {
                claim = nil
                presses.removeAll { $0.kind == "start" || $0.kind == "end" }
            } else {
                move(&game, to: mine.phase, t0: mine.t0)
            }
        }
        // The clock restarted here after a stoppage: it keeps running until the phone has restarted its own (or has moved on).
        if let mine = resumed {
            if game.phase != mine.phase || game.running || game.base != mine.base || !presses.contains(where: { $0.kind == "resume" }) {
                resumed = nil
                presses.removeAll { $0.kind == "resume" }
            } else {
                game.running = true
                game.t0 = mine.t0
            }
        }
        if game.phase == "pre" { done = []; called = [] } // not started, or started again from scratch

        // A goal logged here shows straight away. Until the phone has dealt with it, an older score doesn't undo it.
        if let mine = held {
            let waiting = presses.contains { $0.kind == "goal" }
            if !waiting || now > mine.until || game.us + game.them >= mine.us + mine.them {
                held = nil
                presses.removeAll { $0.kind == "goal" }
            } else {
                game.us = max(game.us, mine.us)
                game.them = max(game.them, mine.them)
            }
        }

        // Changes confirmed here stay confirmed, whatever an out-of-date phone still lists.
        let listed = Set(game.changes.map { $0.id })
        presses.removeAll { $0.kind == "subs" && !listed.contains($0.change ?? "") } // the phone has moved past them
        if let first = game.changes.first, done.contains(first.id) { game.due = false }
        game.changes.removeAll { done.contains($0.id) }

        let wasDue = state?.due ?? false
        judgeDue(&game, now: now)
        // time already up when the watch first hears of this half: the moment has passed, so no buzz for it
        if game.inPlay, game.seconds(at: now) >= game.half * 60 + 30 { called.insert(game.phase) }
        state = game
        return Outcome(becameDue: game.due && !wasDue)
    }

    // MARK: The watch's own clock

    /// Call once a second. Notices a change coming due and the half running out without any help from the phone,
    /// and says which presses to send again.
    mutating func tick(now: Date) -> Outcome {
        var outcome = Outcome()
        if let first = ending, now.timeIntervalSince(first.at) >= WatchBrain.believeAfter, let none = try? JSONDecoder().decode(MatchState.self, from: Data("{\"live\":false}".utf8)) {
            forgetGame()
            gid = ""
            state = none
        }
        if var game = state, game.live {
            let wasDue = game.due
            judgeDue(&game, now: now)
            if game.due != wasDue { state = game }
            outcome.becameDue = game.due && !wasDue
            if game.playing, !called.contains(game.phase), game.seconds(at: now) >= game.half * 60 {
                called.insert(game.phase)
                outcome.timeUp = true
            }
        }
        presses.removeAll { now.timeIntervalSince($0.made) > WatchBrain.giveUpAfter }
        for index in presses.indices where now.timeIntervalSince(presses[index].lastSent) >= WatchBrain.resendEvery {
            presses[index].lastSent = now
            outcome.send.append(presses[index].json)
        }
        return outcome
    }

    private func judgeDue(_ game: inout MatchState, now: Date) {
        if !game.due, game.playing, let first = game.changes.first, first.h == game.halfIndex, game.seconds(at: now) >= first.from * 60 {
            game.due = true
        }
        if game.due && (game.changes.isEmpty || !game.inPlay || game.changes[0].h != game.halfIndex) { game.due = false }
    }

    /// Puts the game into a phase the whistle on this watch has started.
    private func move(_ game: inout MatchState, to phase: String, t0: Double) {
        game.phase = phase
        game.base = 0
        game.t0 = t0
        game.running = phase == "h1" || phase == "h2"
        game.due = false
        if phase == "ft" { game.changes = [] }
        if phase == "ht" || phase == "h2" { game.changes.removeAll { $0.h == 0 } } // the first half's changes are behind us
    }

    // MARK: Presses on the watch

    /// Kick off, or start the second half. The clock starts here at once.
    mutating func pressStart(now: Date) -> Outcome {
        guard var game = state, game.live, game.phase == "pre" || game.phase == "ht" else { return Outcome() }
        let next = game.phase == "pre" ? "h1" : "h2"
        let t0 = (now.timeIntervalSince1970 * 1000).rounded()
        move(&game, to: next, t0: t0)
        if next == "h1" { done = [] }
        called.remove(next)
        // a change listed for the very start of this half is made by starting it, so it is never asked for
        for change in game.changes where change.h == game.halfIndex && change.from == 0 { done.insert(change.id) }
        game.changes.removeAll { done.contains($0.id) }
        claim = Claim(phase: next, t0: t0)
        state = game
        return Outcome(send: [remember("start", ["type": "start", "to": next], now: now)])
    }

    /// The whistle: half time, or full time if this is the last half. The clock stops here at once.
    mutating func pressEnd(now: Date) -> Outcome {
        guard var game = state, game.live, game.inPlay else { return Outcome() }
        let from = game.phase
        let next = game.lastHalf ? "ft" : "ht"
        move(&game, to: next, t0: 0)
        claim = Claim(phase: next, t0: 0)
        resumed = nil
        presses.removeAll { $0.kind == "subs" } // a change nobody made before the whistle is no longer wanted
        state = game
        return Outcome(send: [remember("end", ["type": "end", "from": from], now: now)])
    }

    /// The clock was stopped (on the phone) and play has started again: set it running from the wrist.
    mutating func pressResume(now: Date) -> Outcome {
        guard var game = state, game.live, game.inPlay, !game.running else { return Outcome() }
        let t0 = (now.timeIntervalSince1970 * 1000).rounded()
        game.running = true
        game.t0 = t0
        resumed = Resumed(phase: game.phase, base: game.base, t0: t0)
        state = game
        return Outcome(send: [remember("resume", ["type": "resume"], now: now)])
    }

    /// The players have swapped.
    mutating func pressSubsDone(now: Date) -> Outcome {
        guard var game = state, game.live, game.due, let first = game.changes.first else { return Outcome() }
        done.insert(first.id)
        game.changes.removeAll { $0.id == first.id }
        game.due = false
        judgeDue(&game, now: now) // the one after may already be due as well
        state = game
        return Outcome(becameDue: game.due, send: [remember("subs", ["type": "subs", "change": first.id], now: now, change: first.id)])
    }

    /// A goal. The score moves here at once. (Only while a half is being played: before kick-off the clock has to be started first.)
    mutating func pressGoal(us: Bool, scorer: Int?, assist: Int?, now: Date) -> Outcome {
        guard var game = state, game.live, game.inPlay else { return Outcome() }
        if us { game.us += 1 } else { game.them += 1 }
        held = Held(us: game.us, them: game.them, until: now.addingTimeInterval(WatchBrain.giveUpAfter))
        state = game
        var event: [String: Any] = ["type": "goal", "us": us]
        if let scorer = scorer { event["p"] = scorer }
        if let assist = assist { event["a"] = assist }
        return Outcome(send: [remember("goal", event, now: now)])
    }

    /// A highlight. Sent once: the phone queues it if it can't take it straight away.
    /// From the watch's own screen it is timed when Highlight was tapped (`at`), and says whose it was once that's been
    /// picked (`chose`: a player, or nil for no one). From the Action button there's no screen to ask on, so neither is set.
    mutating func pressHighlight(now: Date, at: Date? = nil, chose: Int?? = .none) -> Outcome {
        guard let game = state, game.live else { return Outcome() }
        let when = at.map { min($0, now) } ?? now
        // (tapped while the half was on: still counts if the whistle has gone while the player was being picked)
        guard game.inPlay || (at != nil && game.phase != "pre" && now.timeIntervalSince(when) < 120) else { return Outcome() }
        var fields: [String: Any] = ["type": "hl"]
        if case .some(let who) = chose {
            fields["pick"] = true
            if let who = who { fields["p"] = who }
        }
        return Outcome(send: [event(fields, id: UUID().uuidString, now: when)])
    }

    /// What the watch says after a highlight is marked without the app on screen (the Action button, Siri or a shortcut),
    /// where there's no screen to show it: when in the half it was marked, or why nothing was.
    func highlightSaid(_ outcome: Outcome, now: Date) -> String {
        guard !outcome.send.isEmpty, let game = state else {
            guard let game = state, game.live else { return "No game on, so nothing was marked." }
            return game.phase == "pre" ? "The game hasn't kicked off yet, so nothing was marked."
                : game.phase == "ht" ? "It's half time, so nothing was marked." : "The game's over, so nothing was marked."
        }
        let s = game.seconds(at: now)
        return "Highlight marked at \(s / 60):\(s % 60 < 10 ? "0" : "")\(s % 60)\(game.periods == 1 ? "" : game.phase == "h1" ? " in the first half" : " in the second half")."
    }

    // MARK: Bookkeeping

    private mutating func forgetGame() {
        held = nil
        done = []
        called = []
        claim = nil
        resumed = nil
        ending = nil
        presses = []
    }

    private mutating func remember(_ kind: String, _ fields: [String: Any], now: Date, change: String? = nil) -> String {
        let id = UUID().uuidString
        let json = event(fields, id: id, now: now)
        presses.append(Press(id: id, kind: kind, json: json, made: now, lastSent: now, change: change))
        return json
    }

    private func event(_ fields: [String: Any], id: String, now: Date) -> String {
        var event = fields
        event["id"] = id
        event["at"] = (now.timeIntervalSince1970 * 1000).rounded()
        if !gid.isEmpty { event["gid"] = gid }
        guard let data = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]), let json = String(data: data, encoding: .utf8) else { return "{}" }
        return json
    }
}
