import AppIntents
import Foundation

/// "Mark a highlight" in the iPhone's Shortcuts app, so it can be put on the Action button of an Apple Watch Ultra (which
/// only offers shortcuts from the Shortcuts app). Run from the watch, iOS runs it here on the iPhone. Siri can run it too.
/// The work is in PhoneHighlight.swift.
@available(iOS 16.0, *)
struct MarkHighlightOnPhoneIntent: AppIntent {
    static var title: LocalizedStringResource = "Mark a highlight"
    static var description = IntentDescription("Marks this moment of the game that's on in Gaffer as a highlight, as the Highlight button does.")
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let now = Date()
        let made = PhoneHighlight.press(state: UserDefaults.standard.string(forKey: "watchlink.latest"), now: now)
        if let event = made.event {
            await MainActor.run { _ = PhoneHighlight.deliver(event, now: now) }
        }
        return .result(dialog: IntentDialog(stringLiteral: made.said))
    }
}

/// Puts "Mark a highlight" in the Shortcuts app under Gaffer, ready to add, and lets Siri run it by name.
@available(iOS 16.0, *)
struct GafferPhoneShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: MarkHighlightOnPhoneIntent(), phrases: [
            "Mark a highlight in \(.applicationName)",
            "\(.applicationName) highlight",
        ])
    }
}
