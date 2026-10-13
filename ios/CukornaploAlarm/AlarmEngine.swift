import Foundation
import AVFoundation
import UserNotifications
import UIKit

/// A szerver /api/alarm válasza (a Cukornapló előrejelzéséből).
struct AlarmGlucose: Decodable {
    let v: Double
    let ageMin: Double
    let arrow: String
}

struct AlarmResponse: Decodable {
    let ok: Bool
    let error: String?
    let glucose: AlarmGlucose?
    let low: Double?
    let high: Double?
    let predicted: Bool?
    let risk: Bool?
    let currentLow: Bool?
    let treated: Bool?
    let nadir: Double?
    let nadirIn: Double?
    let carbsNeeded: Double?
    let insulinNeeded: Double?
    let iob: Double?
    let cob: Double?
    let repeatMin: Double?
    let horizon: Double?
}

/// Háttérben futó riasztó: csendes hanggal életben tartja az appot, percenként lekérdezi a szervert,
/// és hipó-veszélynél hangot játszik (a némító kapcsolón is átszól, mert hanglejátszás, nem értesítés).
@MainActor
final class AlarmEngine: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = AlarmEngine()

    @Published var running = false
    @Published var status = "Nincs elindítva"
    @Published var errorText: String?
    @Published var lastCheck: Date?
    @Published var last: AlarmResponse?
    @Published var snoozedUntil: Date?
    @Published var alarmActive = false

    @Published var serverURL: String {
        didSet { UserDefaults.standard.set(serverURL, forKey: "serverURL") }
    }
    @Published var token: String {
        didSet { UserDefaults.standard.set(token, forKey: "token") }
    }

    private var silentPlayer: AVAudioPlayer?
    private var alarmPlayer: AVAudioPlayer?
    private var timer: Timer?
    private var lastAlarmAt: Date?
    private var lastStaleAt: Date?

    private override init() {
        serverURL = UserDefaults.standard.string(forKey: "serverURL") ?? ""
        token = UserDefaults.standard.string(forKey: "token") ?? ""
        super.init()
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(sessionInterrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        nc.addObserver(self, selector: #selector(mediaReset), name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
        // Ha az app előző futáskor be volt kapcsolva, indításkor magától újraindul.
        if UserDefaults.standard.bool(forKey: "running"), !serverURL.isEmpty, !token.isEmpty {
            DispatchQueue.main.async { [weak self] in self?.start() }
        }
    }

    // MARK: - indítás / leállítás

    func start() {
        let url = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !url.isEmpty, !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorText = "Add meg a szerver címét és a kulcsot."
            return
        }
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
        configureSession()
        startSilent()
        running = true
        UserDefaults.standard.set(true, forKey: "running")
        status = "Fut, az első ellenőrzés folyamatban…"
        errorText = nil
        timer?.invalidate()
        let t = Timer(timeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.poll() }
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
        Task { await poll() }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        silentPlayer?.stop()
        silentPlayer = nil
        stopAlarmSound()
        running = false
        UserDefaults.standard.set(false, forKey: "running")
        status = "Leállítva"
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: - hang

    private func configureSession() {
        let s = AVAudioSession.sharedInstance()
        do {
            try s.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try s.setActive(true)
        } catch {
            errorText = "Hang-munkamenet hiba: \(error.localizedDescription)"
        }
    }

    private func startSilent() {
        guard let url = Bundle.main.url(forResource: "silence", withExtension: "wav") else { return }
        do {
            let p = try AVAudioPlayer(contentsOf: url)
            p.numberOfLoops = -1
            p.volume = 1.0
            p.prepareToPlay()
            p.play()
            silentPlayer = p
        } catch {
            errorText = "Csendes hang hiba: \(error.localizedDescription)"
        }
    }

    @objc private func sessionInterrupted(_ n: Notification) {
        guard let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
        Task { @MainActor in
            guard self.running else { return }
            self.configureSession()
            self.startSilent()
        }
    }

    @objc private func mediaReset() {
        Task { @MainActor in
            guard self.running else { return }
            self.configureSession()
            self.startSilent()
        }
    }

    private func playAlarmSound(loops: Int = 3) {
        guard let url = Bundle.main.url(forResource: "alarm", withExtension: "wav") else { return }
        do {
            configureSession()
            let p = try AVAudioPlayer(contentsOf: url)
            p.numberOfLoops = loops - 1
            p.volume = 1.0
            p.prepareToPlay()
            p.play()
            alarmPlayer = p
            alarmActive = true
            let seconds = p.duration * Double(loops) + 0.5
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                self?.alarmActive = false
            }
        } catch {
            errorText = "Riasztó hang hiba: \(error.localizedDescription)"
        }
    }

    func stopAlarmSound() {
        alarmPlayer?.stop()
        alarmPlayer = nil
        alarmActive = false
    }

    // MARK: - lekérdezés és döntés

    func poll() async {
        guard running else { return }
        var base = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        while base.hasSuffix("/") { base.removeLast() }
        guard let url = URL(string: base + "/api/alarm") else {
            errorText = "Hibás szerver cím."
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue(token.trimmingCharacters(in: .whitespacesAndNewlines), forHTTPHeaderField: "X-Token")
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            guard code == 200 else {
                errorText = code == 401 ? "Hibás kulcs (401)." : "Szerverhiba (\(code))."
                status = "Hiba"
                return
            }
            let r = try JSONDecoder().decode(AlarmResponse.self, from: data)
            errorText = nil
            evaluate(r)
        } catch {
            errorText = "Nem érem el a szervert: \(error.localizedDescription)"
            status = "Nincs kapcsolat"
        }
    }

    private func evaluate(_ r: AlarmResponse) {
        last = r
        lastCheck = Date()
        let now = Date()
        guard let g = r.glucose else {
            status = "Nincs vércukor-adat"
            return
        }
        status = String(format: "%.1f %@ · %d perce", g.v, g.arrow, Int(g.ageMin))

        // Elavult adat: hangtalan értesítés félóránként (a szenzor leállhat).
        if g.ageMin > 30 {
            if lastStaleAt == nil || now.timeIntervalSince(lastStaleAt!) > 30 * 60 {
                lastStaleAt = now
                notify(title: "Nincs friss vércukor-adat", body: "Az utolsó mérés \(Int(g.ageMin)) perce volt.", id: "stale")
            }
        }

        if let s = snoozedUntil, s > now { return }
        snoozedUntil = nil

        // Nagyon alacsonynál (3,0 alatt) sűrűbben, 5 percenként ismétel; különben a beállított időközönként.
        let veryLow = g.v < 3.0
        let danger = (r.risk ?? false) || veryLow
        guard danger else {
            lastAlarmAt = nil
            return
        }
        let repeatSec: TimeInterval = veryLow ? 5.0 * 60 : max(15.0, r.repeatMin ?? 15) * 60 - 30
        if let la = lastAlarmAt, now.timeIntervalSince(la) < repeatSec { return }
        lastAlarmAt = now
        fire(r, glucose: g)
    }

    private func fire(_ r: AlarmResponse, glucose g: AlarmGlucose) {
        var title: String
        var body: String
        if g.v < (r.low ?? 3.9) {
            title = String(format: "⚠️ Alacsony vércukor: %.1f %@", g.v, g.arrow)
            body = "Vegyél be gyors szénhidrátot."
        } else {
            let n = r.nadir ?? g.v
            title = String(format: "⚠️ Hipó-veszély: %.1f várható", n)
            body = String(format: "Most %.1f %@, kb. %d percen belül %.1f mmol/L.", g.v, g.arrow, Int(r.nadirIn ?? r.horizon ?? 30), n)
        }
        if let c = r.carbsNeeded { body += " Kb. \(Int(c)) g szénhidrát javasolt." }
        playAlarmSound()
        notify(title: title, body: body, id: "hypo")
    }

    // MARK: - gombok

    func snooze(minutes: Int) {
        snoozedUntil = Date().addingTimeInterval(Double(minutes) * 60)
        stopAlarmSound()
    }

    func clearSnooze() {
        snoozedUntil = nil
    }

    func testAlarm() {
        playAlarmSound(loops: 2)
        notify(title: "[Teszt] ⚠️ Hipó-veszély", body: "Ez egy próbariasztás.", id: "test")
    }

    // MARK: - értesítés

    private func notify(title: String, body: String, id: String) {
        let c = UNMutableNotificationContent()
        c.title = title
        c.body = body
        c.sound = .default
        let req = UNNotificationRequest(identifier: id + String(Int(Date().timeIntervalSince1970)), content: c, trigger: nil)
        UNUserNotificationCenter.current().add(req)
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }
}
