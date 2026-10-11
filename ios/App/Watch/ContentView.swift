import SwiftUI
import WatchKit

enum Step: Hashable {
    case scorer
    case assist(Int)
}

struct ContentView: View {
    @EnvironmentObject var model: MatchModel
    @State private var path: [Step] = []

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if let state = model.state, state.live {
                    MatchView(state: state, path: $path)
                } else {
                    IdleView()
                }
            }
            .navigationDestination(for: Step.self) { step in
                if let state = model.state {
                    switch step {
                    case .scorer:
                        ScorerList(state: state, path: $path)
                    case .assist(let scorer):
                        AssistList(state: state, scorer: scorer, path: $path)
                    }
                }
            }
        }
    }
}

struct IdleView: View {
    @EnvironmentObject var model: MatchModel

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "sportscourt")
                .font(.title2)
                .foregroundStyle(.green)
            Text("Start a game on your iPhone")
                .font(.headline)
                .multilineTextAlignment(.center)
            Text("Set the game up there, then kick off from here.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
        .task { // keep asking while waiting, so the game appears within a few seconds of being set up
            while !Task.isCancelled {
                model.refresh()
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }
}

/// One scrolling page: the clock and score first, then the next changes, then the buttons for logging.
struct MatchView: View {
    @EnvironmentObject var model: MatchModel
    let state: MatchState
    @Binding var path: [Step]
    @State private var confirmThem = false
    @State private var confirmEnd = false

    var body: some View {
        ScrollViewReader { reader in
        ScrollView {
            VStack(spacing: 14) {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Glance(state: state, now: context.date)
                }
                .frame(minHeight: WKInterfaceDevice.current().screenBounds.height * (state.phase == "pre" || state.phase == "ht" ? 0.5 : 0.78))

                if state.phase == "pre" || state.phase == "ht" {
                    Button {
                        model.start()
                    } label: {
                        Text(state.phase == "pre" ? "Kick off" : "Start 2nd half").font(.headline).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                }

                if state.inPlay && !state.running { // stopped on the phone (for an injury, or by a stray touch in a pocket)
                    Button {
                        model.resume()
                    } label: {
                        Text("Restart the clock").font(.headline).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                }

                if state.inPlay { // once time is up the whistle is the next thing wanted, so it sits right under the clock
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        if state.seconds(at: context.date) >= state.half * 60 {
                            Button {
                                confirmEnd = true
                            } label: {
                                Label(state.lastHalf ? "Full time" : "Half time", systemImage: "flag.checkered").font(.headline).frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.orange)
                        }
                    }
                }

                if state.due, let change = state.changes.first { // also asked in a sheet when it comes due; this stays until it's done
                    VStack(alignment: .leading, spacing: 4) {
                        Label("Subs due", systemImage: "arrow.left.arrow.right")
                            .font(.headline)
                            .foregroundStyle(.orange)
                        if !change.off.isEmpty {
                            Text("Off: " + change.off.joined(separator: ", ")).font(.footnote.weight(.semibold))
                        }
                        if !change.on.isEmpty {
                            Text("On: " + change.on.joined(separator: ", ")).font(.footnote.weight(.semibold))
                        }
                        Button {
                            model.subsDone()
                        } label: {
                            Text("Subs done").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.green)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                // What the phone hasn't yet taken in. It keeps everything the watch sends, but only shows and saves it once
                // the Gaffer app is opened there, so at the end of the game this says whether that has happened.
                if state.phase == "ft" && model.waiting > 0 {
                    Text("Open Gaffer on your iPhone to save the game. \(model.waiting) to send.")
                        .font(.footnote)
                        .foregroundStyle(.yellow)
                        .multilineTextAlignment(.center)
                } else if state.phase == "ft" {
                    Text("All on your iPhone. Finish the game there.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                } else if !state.inPlay && model.waiting > 0 {
                    Text("\(model.waiting) still to reach your iPhone. Open Gaffer there when you can.")
                        .font(.footnote)
                        .foregroundStyle(.yellow)
                        .multilineTextAlignment(.center)
                }

                Changes(state: state)
                    .id("changes")

                VStack(spacing: 8) {
                    Button {
                        path = [.scorer]
                    } label: {
                        Text("Goal \(state.team)").frame(maxWidth: .infinity)
                    }
                    .tint(.green)
                    .disabled(model.locked || !state.inPlay)

                    Button {
                        confirmThem = true
                    } label: {
                        Text("Goal \(state.opp)").frame(maxWidth: .infinity)
                    }
                    .tint(.red)
                    .disabled(model.locked || !state.inPlay)

                    Button {
                        model.highlight()
                    } label: {
                        Label("Highlight", systemImage: "star.fill").frame(maxWidth: .infinity)
                    }
                    .disabled(!state.inPlay)

                    if state.inPlay {
                        Button {
                            confirmEnd = true
                        } label: {
                            Label(state.lastHalf ? "Full time" : "Half time", systemImage: "flag.checkered").frame(maxWidth: .infinity)
                        }
                        .tint(.gray)
                    }

                    if model.locked {
                        Text("Score locked for 8 seconds")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    if !model.note.isEmpty {
                        Text(model.note)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                }
                .buttonStyle(.borderedProminent)
                .id("buttons")
            }
            .padding(.horizontal, 4)
        }
        .onAppear {
            if model.demoPage == 1 { reader.scrollTo("changes", anchor: .top) }
            if model.demoPage == 2 { reader.scrollTo("buttons", anchor: .top) }
            if model.demoPage == 3 { path = [.scorer] }
        }
        }
        .sheet(isPresented: $model.askSubs) {
            SubsSheet(state: state)
        }
        .confirmationDialog(state.lastHalf ? "Blow for full time?" : "Blow for half time?", isPresented: $confirmEnd, titleVisibility: .visible) {
            Button(state.lastHalf ? "Full time" : "Half time") { model.endHalf() }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Goal for \(state.opp)?", isPresented: $confirmThem, titleVisibility: .visible) {
            Button("Log the goal") { model.goal(us: false, scorer: nil, assist: nil) }
            Button("Cancel", role: .cancel) {}
        }
    }
}

/// Shown when a change comes due. Closing it leaves the change waiting; "Subs done" makes it.
struct SubsSheet: View {
    @EnvironmentObject var model: MatchModel
    let state: MatchState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text("Time for subs").font(.headline)
                if let change = state.changes.first {
                    if !change.off.isEmpty {
                        Text("Off").font(.caption2.weight(.bold)).foregroundStyle(.orange)
                        Text(change.off.joined(separator: ", ")).font(.body.weight(.semibold))
                    }
                    if !change.on.isEmpty {
                        Text("On").font(.caption2.weight(.bold)).foregroundStyle(.green)
                        Text(change.on.joined(separator: ", ")).font(.body.weight(.semibold))
                    }
                }
                Button {
                    model.subsDone()
                } label: {
                    Text("Subs done").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                Button {
                    model.askSubs = false
                } label: {
                    Text("Not yet").frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
        }
    }
}

struct Glance: View {
    let state: MatchState
    let now: Date

    private var phaseName: String {
        switch state.phase {
        case "pre": return "Before kick-off"
        case "h1": return state.periods == 1 ? (state.running ? "In play" : "Paused") : (state.running ? "First half" : "First half, paused")
        case "ht": return "Half time"
        case "h2": return state.running ? "Second half" : "Second half, paused"
        default: return "Full time"
        }
    }

    private func clock(_ seconds: Int) -> String {
        String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    private var nextLine: String? {
        guard let next = state.changes.first else { return nil }
        if next.h != state.halfIndex || state.phase == "pre" || state.phase == "ht" {
            return state.phase == "pre" || state.periods == 1 ? nil : "Change at half time"
        }
        let left = next.from * 60 - state.seconds(at: now)
        return left > 0 ? "Change in \(clock(left))" : "Change now"
    }

    var body: some View {
        VStack(spacing: 4) {
            Text(phaseName)
                .font(.footnote)
                .foregroundStyle(.secondary)
            Text(state.phase == "pre" || state.phase == "ht" ? "0:00" : clock(state.seconds(at: now)))
                .font(.system(size: 46, weight: .bold, design: .rounded))
                .monospacedDigit()
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(state.team).lineLimit(1).minimumScaleFactor(0.6)
                Text("\(state.us) – \(state.them)").font(.title3.weight(.heavy)).monospacedDigit().layoutPriority(1)
                Text(state.opp).lineLimit(1).minimumScaleFactor(0.6)
            }
            .font(.footnote.weight(.semibold))
            if let nextLine = nextLine {
                Text(nextLine)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.yellow)
                    .monospacedDigit()
            }
        }
        .frame(maxWidth: .infinity)
    }
}

struct Changes: View {
    let state: MatchState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Next changes")
                .font(.headline)
            if state.changes.isEmpty {
                Text("No more changes")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            ForEach(state.changes.prefix(3)) { change in
                VStack(alignment: .leading, spacing: 2) {
                    Text(state.periods == 1 ? "\(change.from):00" : "\(change.from):00, \(change.h == 0 ? "first" : "second") half")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if !change.on.isEmpty {
                        Label(change.on.joined(separator: ", "), systemImage: "arrow.up")
                            .foregroundStyle(.green)
                    }
                    if !change.off.isEmpty {
                        Label(change.off.joined(separator: ", "), systemImage: "arrow.down")
                            .foregroundStyle(.orange)
                    }
                }
                .font(.body.weight(.semibold))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct ScorerList: View {
    let state: MatchState
    @Binding var path: [Step]
    @EnvironmentObject var model: MatchModel

    var body: some View {
        List {
            ForEach(state.players) { player in // the phone sends them likeliest scorer first, keeper last
                Button(player.gk ? player.name + " (keeper)" : player.name) { path = [.scorer, .assist(player.id)] }
                    .foregroundStyle(player.on ? .primary : .secondary)
            }
            Button("Own goal or not sure") {
                model.goal(us: true, scorer: nil, assist: nil)
                path = []
            }
            .foregroundStyle(.secondary)
        }
        .navigationTitle("Who scored?")
    }
}

struct AssistList: View {
    let state: MatchState
    let scorer: Int
    @Binding var path: [Step]
    @EnvironmentObject var model: MatchModel

    var body: some View {
        List {
            Button("No assist") {
                model.goal(us: true, scorer: scorer, assist: nil)
                path = []
            }
            ForEach(state.players.filter { $0.id != scorer }) { player in
                Button(player.gk ? player.name + " (keeper)" : player.name) {
                    model.goal(us: true, scorer: scorer, assist: player.id)
                    path = []
                }
                .foregroundStyle(player.on ? .primary : .secondary)
            }
        }
        .navigationTitle("Who set it up?")
    }
}
