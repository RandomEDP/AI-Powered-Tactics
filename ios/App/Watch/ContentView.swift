import SwiftUI

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
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "sportscourt")
                .font(.title2)
                .foregroundStyle(.green)
            Text("Start a game on your iPhone")
                .font(.headline)
                .multilineTextAlignment(.center)
            Text("The clock, score and subs appear here.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }
}

/// One scrolling page: the clock and score first, then the next changes, then the buttons for logging.
struct MatchView: View {
    @EnvironmentObject var model: MatchModel
    let state: MatchState
    @Binding var path: [Step]
    @State private var confirmThem = false

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Glance(state: state, now: context.date)
                }
                .containerRelativeFrame(.vertical)

                Changes(state: state)

                VStack(spacing: 8) {
                    Button {
                        path = [.scorer]
                    } label: {
                        Text("Goal \(state.team)").frame(maxWidth: .infinity)
                    }
                    .tint(.green)
                    .disabled(model.locked || state.phase == "ft")

                    Button {
                        confirmThem = true
                    } label: {
                        Text("Goal \(state.opp)").frame(maxWidth: .infinity)
                    }
                    .tint(.red)
                    .disabled(model.locked || state.phase == "ft")

                    Button {
                        model.highlight()
                    } label: {
                        Label("Highlight", systemImage: "star.fill").frame(maxWidth: .infinity)
                    }
                    .disabled(state.phase == "pre" || state.phase == "ft")

                    if model.locked {
                        Text("Score locked for 10 seconds")
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
            }
            .padding(.horizontal, 4)
        }
        .confirmationDialog("Goal for \(state.opp)?", isPresented: $confirmThem, titleVisibility: .visible) {
            Button("Log the goal") { model.goal(us: false, scorer: nil, assist: nil) }
            Button("Cancel", role: .cancel) {}
        }
    }
}

struct Glance: View {
    let state: MatchState
    let now: Date

    private var phaseName: String {
        switch state.phase {
        case "pre": return "Before kick-off"
        case "h1": return state.running ? "First half" : "First half, paused"
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
            return state.phase == "pre" ? nil : "Change at half time"
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
                    Text("\(change.from):00, \(change.h == 0 ? "first" : "second") half")
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
            ForEach(state.players.filter { $0.on } + state.players.filter { !$0.on }) { player in
                Button(player.name) { path = [.scorer, .assist(player.id)] }
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
            ForEach((state.players.filter { $0.on } + state.players.filter { !$0.on }).filter { $0.id != scorer }) { player in
                Button(player.name) {
                    model.goal(us: true, scorer: scorer, assist: player.id)
                    path = []
                }
                .foregroundStyle(player.on ? .primary : .secondary)
            }
        }
        .navigationTitle("Who set it up?")
    }
}
