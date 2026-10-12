import AppIntents

/// "Mark a highlight", for the Action button on Apple Watch Ultra: in the Watch app on the iPhone, Action Button, choose
/// Shortcut, then Gaffer's "Mark a highlight". Siri and the Shortcuts app can run it too. It does what the Highlight
/// button on the watch does, without the app having to be on screen, and says when in the half it was marked.
@available(watchOS 9.0, *)
struct MarkHighlightIntent: AppIntent {
    static var title: LocalizedStringResource = "Mark a highlight"
    static var description = IntentDescription("Marks this moment of the game as a highlight, as the Highlight button in Gaffer does.")
    static var openAppWhenRun = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let said = await MatchModel.shared.highlightFromButton()
        return .result(dialog: IntentDialog(stringLiteral: said))
    }
}

/// Makes "Mark a highlight" ready to pick for the Action button, and to say to Siri, with nothing to set up in Shortcuts.
@available(watchOS 9.0, *)
struct GafferShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: MarkHighlightIntent(), phrases: [
            "Mark a highlight in \(.applicationName)",
            "\(.applicationName) highlight",
        ])
    }
}
