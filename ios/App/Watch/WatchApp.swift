import SwiftUI

@main
struct TacticsWatchApp: App {
    @StateObject private var model = MatchModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
        }
    }
}
