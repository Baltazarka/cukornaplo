import SwiftUI

struct ContentView: View {
    @EnvironmentObject var engine: AlarmEngine

    var body: some View {
        NavigationStack {
            Form {
                Section("Állapot") {
                    if let g = engine.last?.glucose {
                        HStack {
                            Text(String(format: "%.1f", g.v)).font(.system(size: 40, weight: .bold))
                            Text("mmol/L \(g.arrow)").foregroundStyle(.secondary)
                            Spacer()
                            Text("\(Int(g.ageMin)) perce").foregroundStyle(.secondary)
                        }
                    }
                    Text(engine.running ? engine.status : "Nincs elindítva")
                    if let r = engine.last, engine.running {
                        if r.risk == true {
                            Label("Hipó-veszély", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red)
                        } else {
                            Label("Nincs hipó-veszély", systemImage: "checkmark.circle").foregroundStyle(.green)
                        }
                        if let n = r.nadir, let m = r.nadirIn {
                            Text(String(format: "Legalacsonyabb várható: %.1f mmol/L (%d perc múlva)", n, Int(m))).font(.footnote)
                        }
                    }
                    if let t = engine.lastCheck {
                        Text("Utolsó ellenőrzés: \(t.formatted(date: .omitted, time: .standard))")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if let e = engine.errorText {
                        Text(e).foregroundStyle(.red)
                    }
                    if let s = engine.snoozedUntil, s > Date() {
                        Text("Szundi eddig: \(s.formatted(date: .omitted, time: .shortened))").foregroundStyle(.orange)
                    }
                }

                Section("Vezérlés") {
                    if engine.running {
                        Button("Leállítás", role: .destructive) { engine.stop() }
                    } else {
                        Button("Indítás") { engine.start() }
                    }
                    Button("Próbariasztás") { engine.testAlarm() }
                    if engine.alarmActive {
                        Button("Hang elnémítása") { engine.stopAlarmSound() }
                    }
                    Button("Szundi 30 perc") { engine.snooze(minutes: 30) }
                    if engine.snoozedUntil != nil {
                        Button("Szundi vége") { engine.clearSnooze() }
                    }
                }

                Section("Szerver") {
                    TextField("https://cukor.pelda.hu", text: $engine.serverURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    SecureField("API-kulcs (X-Token)", text: $engine.token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                Section {
                    Text("A kulcsot a Cukornapló Beállítások oldalán találod. Az app csendes hanggal fut a háttérben, ezért az akkumulátort használja; hipó-veszélynél hangot játszik, ami a némító kapcsolón is átszól. Nem helyettesíti a CGM saját riasztásait.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Cukor riasztó")
        }
    }
}
