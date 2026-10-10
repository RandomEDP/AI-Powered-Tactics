import Capacitor
import EventKit
import EventKitUI
import Foundation
import UIKit

/// Opens the system "new event" sheet, filled in with a game's details, so the person can add it to their calendar.
///
///   addEvent({ title, start, end, location, notes })  -> { saved }     start and end are milliseconds since 1970
@objc(GameCalendarPlugin)
public class GameCalendarPlugin: CAPPlugin, CAPBridgedPlugin, EKEventEditViewDelegate {
    public let identifier = "GameCalendarPlugin"
    public let jsName = "GameCalendar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "addEvent", returnType: CAPPluginReturnPromise)
    ]

    private let store = EKEventStore()
    private var eventCall: CAPPluginCall?

    @objc public func addEvent(_ call: CAPPluginCall) {
        guard let start = call.getDouble("start") else {
            call.reject("The game has no kick-off time")
            return
        }
        let end = call.getDouble("end") ?? start + 3_600_000
        let title = call.getString("title") ?? "Game"
        let location = call.getString("location") ?? ""
        let notes = call.getString("notes") ?? ""

        let present = {
            DispatchQueue.main.async {
                guard let host = self.bridge?.viewController else {
                    call.reject("Couldn't open your calendar")
                    return
                }
                let event = EKEvent(eventStore: self.store)
                event.title = title
                event.startDate = Date(timeIntervalSince1970: start / 1000)
                event.endDate = Date(timeIntervalSince1970: end / 1000)
                if !location.isEmpty { event.location = location }
                if !notes.isEmpty { event.notes = notes }
                let editor = EKEventEditViewController()
                editor.eventStore = self.store
                editor.event = event
                editor.editViewDelegate = self
                self.eventCall = call
                host.present(editor, animated: true)
            }
        }

        if #available(iOS 17.0, *) {
            present() // the sheet runs outside the app from iOS 17, so no calendar permission is needed
        } else {
            store.requestAccess(to: .event) { granted, _ in
                if granted {
                    present()
                } else {
                    call.reject("Allow calendar access in Settings to add games")
                }
            }
        }
    }

    public func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
        controller.dismiss(animated: true)
        eventCall?.resolve(["saved": action == .saved])
        eventCall = nil
    }
}
