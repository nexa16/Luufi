# Prüfungen

Kriterien mit stabilen Auftragskennungen erhalten eine primäre angemessene Prüfebene: reine Entscheidungen als Unit-Test, D1 und Browser-/MCP-Verträge als Worker-Test, lokale Interaktionen als UI-Test, durchgehende Nutzerabläufe als Browsertest. Zusätzliche Ebenen prüfen jeweils ein anderes Grenzrisiko.

Fehlerkorrekturen zuerst mit einem fehlschlagenden Regressionstest belegen. Synthetische Fixtures verwenden; keine Produktionsdaten. Tests prüfen Verhalten, Ausgabe, Speicherung und Fehlerzustände, keine privaten Implementierungsdetails. Keine unkontrollierten externen Dienste als CI-Abhängigkeit.

Während Entwicklung fokussiert und ohne Coverage testen. Nach stabilem Verhalten formatieren, Typprüfung und Lint ausführen. Vom finalen committed Dependency-Graph einmal `npm run test:ci` und `npm run build` ausführen. Keine zusätzliche vollständige Coverage-Runde davor; keine wiederholten Coverage-Läufe bei jeder Änderung. Nur ausführbare Änderungen entwerten das vollständige Gate. Keine `.only` oder akzeptanzkritischen Skips.

Auf ausdrücklichen Nutzerwunsch vom 23. Oktober 2026 gelten insgesamt mindestens 80% Statements und Zeilen, 70% Funktionen und 60% Branches je Suite. Es gibt keine Einzeldatei- oder Changed-Module-Gates und keine automatische Ratchet-Erhöhung. Die meisten Zeilen bleiben abgedeckt; fachliche Sicherheits-, Konflikt-, Replay- und Datenverlustregressionen sind wichtiger als zusätzliche Prozentpunkte. Unit und UI verwenden V8, Cloudflare Worker Istanbul; alle eigenen ausführbaren Module bleiben im Bericht enthalten.

`npm run test:ci` prüft Dokumentationsstruktur, Unit-, UI- und Worker-Tests einmal mit Coverage sowie Desktop-/Handy-Browserabläufe. Die Tests werden dabei nicht zusätzlich ohne Coverage doppelt ausgeführt. GitHub CI ergänzt Typprüfung, Lint und Produktionsbuild. Live-Plattformsmoke erfolgt nach Preview-Deployment mit exaktem SHA/Branch/Umgebung und bleibt vom deterministischen PR-Gate getrennt.

Der PR prüft den Integrationsstand vor dem geschützten develop-Merge. Der folgende technische Mergecommit startet keine zweite identische Coverage-Runde. Eine ausdrücklich freigegebene Produktionspromotion erhält weiterhin CI auf dem exakten main-Head; main wird nie automatisch integriert.

Lokale Browserprüfungen verwenden eine ausdrücklich als `local` konfigurierte Instanz mit Testdaten und Loopback-Zugang. Dieser Modus wird in Preview/Produktion niemals als Authentifizierung akzeptiert.
