import SwiftUI

@main
struct CukornaploAlarmApp: App {
    @StateObject private var engine = AlarmEngine.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(engine)
        }
    }
}
