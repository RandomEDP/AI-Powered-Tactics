import SwiftUI

@main
struct TacticsWatchApp: App {
    @StateObject private var model = MatchModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active { model.refresh() } // raised wrist or reopened: catch up with the phone
        }
    }
}
