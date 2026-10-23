# Luufi

Luufi ist eine private persönliche Planungszentrale mit öffentlichem Quellcode.
Der freigegebene Neubau ersetzt die frühere GitHub-Issue-/Project-Steuerung.
Alte Issues und deren Historie gehören ausschließlich zum privaten Archiv.

- `develop` ist Integrationsbranch; `main` enthält nur ausdrücklich freigegebene Produktion.
- Vor Refinement/Implementierung die zentralen Richtlinien über natives Luufi-MCP lesen; Bootstrap-Quellen unter `docs/guidelines`.
- Nur konkret freigegebenen Umfang implementieren. Unterbrochene unveränderte Arbeit darf auf Nutzeraufforderung fortgesetzt werden.
- Pro Auftrag genau ein finaler Commit einschließlich Tests, Migrationen und betroffener Dokumentation. Ein PR pro Runde; normaler Merge ohne Squash/Rebase-Merge.
- Lokal fokussierte Tests ohne Coverage. Ein finaler CI-Lauf führt jeden Test genau einmal mit Coverage aus; davor keine zusätzliche vollständige Coverage-Runde. Gates insgesamt: 80% Statements/Zeilen, 70% Funktionen, 60% Branches; keine Einzeldatei-Ratchets. Typprüfung, Lint, Build und aussagekräftige Sicherheits-/Persistenzregressionen bleiben verbindlich.
- Produktion nur nach ausdrücklicher Release-Freigabe. Preview und Produktion haben getrennte Sites, D1 und später R2. IDs und Inhalte bestehender Projektideen bewahren; Migrationen nur ergänzen.
- Keine Geheimnisse, privaten Live-Daten, Backups oder alte Git-Metadaten veröffentlichen. `.dev.vars` bleibt lokal. Öffentliches Repository bedeutet keine öffentlichen Arbeitsdaten.
- Dokumentation beschreibt ausschließlich den tatsächlichen Branchstand. Keine manuelle Abnahme oder Arbeitszeitabrechnung als Abschlussbedingung.
- Unteragenten nur innerhalb ausdrücklich freigegebener Parallelaufgaben, mit getrennten Dateien und zentraler Integration. Kein eigenständiges Produktionsdeployment.

Details: `docs/guidelines/implementation.md`, `docs/guidelines/documentation.md`, `TESTING.md`.
