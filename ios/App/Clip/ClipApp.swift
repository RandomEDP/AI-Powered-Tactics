import AVKit
import StoreKit
import SwiftUI

/// Gaffer's App Clip: a friendly's personal link on an iPhone without Gaffer. It shows that player's games and clips,
/// and "Get Gaffer" brings up the full app's App Store card. The link is kept for the full app, so the first time it
/// opens their game and highlights are there (and go on their profile once they've made an account).
@main
struct GafferClip: App {
    @StateObject private var model = ClipModel()

    var body: some Scene {
        WindowGroup {
            ClipScreen(model: model)
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL { model.open(url) }
                }
                .onOpenURL { model.open($0) }
        }
    }
}

@MainActor
final class ClipModel: ObservableObject {
    enum State: Equatable { case waiting, loading, ready(Preview), failed(String) }

    @Published var state: State = .waiting
    @Published var playing: Preview.Clip?
    @Published var store = false
    private(set) var link: ClipLink?

    init() {
        // Opened from Xcode or TestFlight with no link after a moment: say how to use it, rather than spin.
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            if self?.state == .waiting { self?.state = .failed(ClipText.noLink) }
        }
    }

    func open(_ url: URL) {
        guard let l = ClipLink.parse(url) else {
            if link == nil { state = .failed(ClipText.noLink) }
            return
        }
        link = l
        l.keep(in: UserDefaults(suiteName: ClipConfig.group))
        load()
    }

    func load() {
        guard let l = link else { return }
        state = .loading
        Task {
            do {
                let (data, response) = try await URLSession.shared.data(for: ClipNet.request(token: l.token))
                guard (response as? HTTPURLResponse)?.statusCode == 200, let p = ClipNet.decode(data) else {
                    state = .failed(ClipText.offline); return
                }
                if p.status != "ok" { state = .failed(ClipText.missing); return }
                state = .ready(p)
                if playing == nil { playing = p.clips?.first }
            } catch {
                state = .failed(ClipText.offline)
            }
        }
    }
}

struct ClipScreen: View {
    @ObservedObject var model: ClipModel

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(title)
                .safeAreaInset(edge: .bottom) { getButton }
        }
        .tint(Color(hex: kit) ?? .green)
        .appStoreOverlay(isPresented: $model.store) { SKOverlay.AppClipConfiguration(position: .bottom) }
    }

    private var title: String { if case .ready(let p) = model.state { return ClipText.heading(p) }; return "Gaffer" }
    private var kit: String? { if case .ready(let p) = model.state { return p.color }; return nil }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .waiting, .loading:
            ProgressView("Getting your highlights…").frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let why):
            VStack(spacing: 16) {
                Text(why).multilineTextAlignment(.center).foregroundStyle(.secondary)
                if model.link != nil, why == ClipText.offline { Button("Try again") { model.load() }.buttonStyle(.bordered) }
            }
            .padding(24).frame(maxWidth: .infinity, maxHeight: .infinity)
        case .ready(let p):
            ready(p)
        }
    }

    private func ready(_ p: Preview) -> some View {
        List {
            if let c = model.playing, let url = ClipNet.url(c) {
                Section {
                    ClipPlayer(url: url).aspectRatio(16 / 9, contentMode: .fit)
                        .listRowInsets(EdgeInsets())
                } footer: { Text(c.label) }
            }
            ForEach(p.games ?? []) { g in
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(ClipText.score(g)).font(.headline)
                        Text([ClipText.result(g), ClipText.contribution(goals: g.goals, assists: g.assists)].compactMap { $0 }.joined(separator: " · "))
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    let mine = (p.clips ?? []).filter { $0.game == g.id }
                    ForEach(mine) { c in
                        Button { model.playing = c } label: {
                            Label(c.label.isEmpty ? "Highlight" : c.label, systemImage: model.playing == c ? "play.circle.fill" : "play.circle")
                        }
                        .accessibilityAddTraits(model.playing == c ? .isSelected : [])
                    }
                } header: { Text(p.team ?? "Friendly") }
            }
            if (p.clips ?? []).isEmpty {
                Section { Text(ClipText.empty(p)).foregroundStyle(.secondary) }
            }
            Section { Text(ClipText.pitch).font(.footnote).foregroundStyle(.secondary) }
        }
    }

    private var getButton: some View {
        Button { model.store = true } label: {
            Text("Get Gaffer").font(.headline).frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.borderedProminent)
        .padding(.horizontal, 16).padding(.vertical, 8)
        .background(.bar)
    }
}

/// One clip at a time, with the system's own controls.
struct ClipPlayer: View {
    let url: URL
    @State private var player = AVPlayer()

    var body: some View {
        VideoPlayer(player: player)
            .onAppear { swap() }
            .onChange(of: url) { _ in swap() }
            .onDisappear { player.pause() }
    }

    private func swap() {
        player.replaceCurrentItem(with: AVPlayerItem(url: url))
        player.play()
    }
}

extension Color {
    /// The team's colour, from "#5629d7".
    init?(hex: String?) {
        guard let h = hex?.trimmingCharacters(in: CharacterSet(charactersIn: "#")), h.count == 6, let v = UInt32(h, radix: 16) else { return nil }
        self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
}
