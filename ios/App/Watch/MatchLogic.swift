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

    /// Seconds on the current half's clock. (Worked out in Double and capped: a watch's ordinary Int is 32 bits,
    /// far too small for a time in milliseconds.)
    func seconds(at date: Date) -> Int {
        let now = date.timeIntervalSince1970 * 1000
        let seconds = (base + (running ? now - t0 : 0)) / 1000
        return seconds.isFinite ? Int(max(0, min(seconds, 360_000))) : 0
    }

    var halfIndex: Int { phase == "h2" || phase == "ft" ? 1 : 0 }
    var playing: Bool { live && running && (phase == "h1" || phase == "h2") }
}

/// The watch's own judgement, kept apart from what the phone last said.
///
/// The phone can be asleep in a pocket for minutes at a time, and its updates can arrive late, twice or out of order.
/// So anything pressed on the watch takes effect here at once and stays in effect until the phone's own account agrees,
/// and each press is sent again every few seconds until then.
struct WatchBrain {
    /// Something pressed on the watch that the phone hasn't yet shown it has taken in.
    struct Press: Equatable {
        var id: String
        var kind: String        // start, subs, goal, hl
        var json: String
        var made: Date
        var lastSent: Date
        var change: String?     // for "subs": the change that was confirmed
    }

    struct Outcome: Equatable {
        var becameDue = false   // a change has just come due: buzz and ask
        var send: [String] = [] // events (JSON) to deliver to the phone now
    }

    private(set) var state: MatchState?
    private(set) var presses: [Press] = []
    private var newest = 0.0                                    // when the phone sent the newest update taken in
    private var hold: (us: Int, them: Int, until: Date)?        // the score after a goal logged here, until the phone has counted it
    private var done: Set<String> = []                          // changes confirmed on this watch, for the rest of the game
    private var started: (phase: String, t0: Double)?           // kick-off or second half pressed here, until the phone agrees
    private var ending: (sent: Double, at: Date)?               // the phone said "no game" mid-game: believed only when it says so again

    static let resendEvery: TimeInterval = 10
    static let giveUpAfter: TimeInterval = 15 * 60

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
            if let current = state, current.playing || started != nil {
                if let first = ending, first.sent != sent, now.timeIntervalSince(first.at) >= 3 {
                    // confirmed: fall through and clear everything
                } else {
                    if ending == nil { ending = (sent: sent, at: now) }
                    return Outcome()
                }
            }
            forgetGame()
            state = game
            return Outcome()
        }
        ending = nil

        // Kick-off (or the second half) pressed here: the clock is ours until the phone has started its own.
        if let mine = started {
            let before = mine.phase == "h1" ? "pre" : "ht"
            if game.phase == before {
                game.phase = mine.phase
                game.base = 0
                game.t0 = mine.t0
                game.running = true
            } else {
                started = nil
                presses.removeAll { $0.kind == "start" }
            }
        }
        if game.phase == "pre" { done = [] } // a new game

        // A goal logged here shows straight away. Until the phone has counted it, an older score doesn't undo it.
        if let mine = hold {
            if now > mine.until || game.us + game.them >= mine.us + mine.them {
                hold = nil
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
        state = game
        return Outcome(becameDue: game.due && !wasDue)
    }

    // MARK: The watch's own clock

    /// Call once a second. Notices a change coming due without any help from the phone, and says which presses to send again.
    mutating func tick(now: Date) -> Outcome {
        var outcome = Outcome()
        if var game = state, game.live {
            let wasDue = game.due
            judgeDue(&game, now: now)
            if game.due != wasDue { state = game }
            outcome.becameDue = game.due && !wasDue
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
        if game.due && (game.changes.isEmpty || !game.playing && game.phase != "h1" && game.phase != "h2") { game.due = false }
    }

    // MARK: Presses on the watch

    /// Kick off, or start the second half. The clock starts here at once.
    mutating func pressStart(now: Date) -> Outcome {
        guard var game = state, game.live, game.phase == "pre" || game.phase == "ht" else { return Outcome() }
        game.phase = game.phase == "pre" ? "h1" : "h2"
        game.base = 0
        game.t0 = now.timeIntervalSince1970 * 1000
        game.running = true
        game.due = false
        // a change listed for the very start of this half is made by starting it, so it is never asked for
        for change in game.changes where change.h == game.halfIndex && change.from == 0 { done.insert(change.id) }
        game.changes.removeAll { done.contains($0.id) }
        started = (phase: game.phase, t0: game.t0)
        state = game
        return Outcome(send: [remember("start", ["type": "start"], now: now)])
    }

    /// The players have swapped.
    mutating func pressSubsDone(now: Date) -> Outcome {
        guard var game = state, game.live, let first = game.changes.first else { return Outcome() }
        done.insert(first.id)
        game.changes.removeFirst()
        game.due = false
        judgeDue(&game, now: now) // the one after may already be due as well
        state = game
        return Outcome(becameDue: game.due, send: [remember("subs", ["type": "subs", "change": first.id], now: now, change: first.id)])
    }

    /// A goal. The score moves here at once.
    mutating func pressGoal(us: Bool, scorer: Int?, assist: Int?, now: Date) -> Outcome {
        guard var game = state, game.live else { return Outcome() }
        if us { game.us += 1 } else { game.them += 1 }
        hold = (us: game.us, them: game.them, until: now.addingTimeInterval(90))
        state = game
        var event: [String: Any] = ["type": "goal", "us": us]
        if let scorer = scorer { event["p"] = scorer }
        if let assist = assist { event["a"] = assist }
        return Outcome(send: [remember("goal", event, now: now)])
    }

    /// A highlight. Sent once: the phone queues it if it can't take it straight away.
    mutating func pressHighlight(now: Date) -> Outcome {
        Outcome(send: [WatchBrain.event(["type": "hl"], id: UUID().uuidString, now: now)])
    }

    // MARK: Bookkeeping

    private mutating func forgetGame() {
        hold = nil
        done = []
        started = nil
        ending = nil
        presses = []
    }

    private mutating func remember(_ kind: String, _ fields: [String: Any], now: Date, change: String? = nil) -> String {
        let id = UUID().uuidString
        let json = WatchBrain.event(fields, id: id, now: now)
        presses.append(Press(id: id, kind: kind, json: json, made: now, lastSent: now, change: change))
        return json
    }

    private static func event(_ fields: [String: Any], id: String, now: Date) -> String {
        var event = fields
        event["id"] = id
        event["at"] = (now.timeIntervalSince1970 * 1000).rounded()
        guard let data = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]), let json = String(data: data, encoding: .utf8) else { return "{}" }
        return json
    }
}
