# Bootstrap-Aufträge

Die IDs sind dauerhaft reserviert und werden bei Einführung der Auftragsverwaltung unverändert übernommen. Die Gesamtplanfreigabe und deren ausdrückliche Fortsetzung am 23. Oktober 2026 autorisieren ausschließlich den beschriebenen Umfang. Produktion erhält eine eigene Release-Freigabe. Das lokale Übergabeprotokoll bleibt außerhalb des öffentlichen Repositorys.

## LUUFI-1 v1 – Nativer MCP-Nachweis

Technische Voraussetzung, im getrennten privaten Preview-Quellspeicher implementiert. Tatsächliche native Lese-/Schreib-, Replay-/Konflikt-, Richtlinien- und Anhangprüfung bestanden. Die alte private Proof-Historie wird nicht in dieses neue Repository importiert. Die neue Grundlage übernimmt nur gezielt benötigte MCP-Komponenten.

## LUUFI-2 v1 – Bereinigte Grundlage

**Ziel:** Eigenständiger deutscher React/Worker-Neubau mit D1 und nativem Sites-MCP, ohne alte GitHub-/OAuth-/Workflow-Dienste.

**Umfang:** Neue öffentliche Historie, private Archivierung, gezielte UI-/MCP-/D1-Grundlage, versionierte Richtlinien, sichere Umgebungsidentität, CI und Merge nach exaktem erfolgreichem CI-SHA. Dokumentation und Tests gehören zum selben Auftragscommit.

**Kriterien:** F-1: Deutsche Navigation und ehrlicher leerer Projektbereich. F-2: Sites-Identität schützt Health und MCP; Probedaten nur Preview. F-3: Health/Kontext/Banner stimmen mit Branch/SHA/Umgebung überein, kein GitHub-Token erforderlich. F-4: Alle Richtlinien haben korrekte Versionen und Hashes. F-5: Alte Migrationen unverändert, keine private alte Historie oder Live-Daten im öffentlichen Repository. F-6: CI prüft Typen/Tests/Lint/Build; privilegierter Merge führt keinen PR-Code aus und integriert niemals automatisch nach main.

**Teststrategie:** F-1 UI; F-2 Worker/API plus lokaler Auth-Grenztest; F-3 Unit+Worker sowie nativer Deployment-Smoke; F-4 Worker/Hash und exakter Quelldatenvergleich; F-5 bewusste Datei-/Historienprüfung und Migrationsinventar; F-6 GitHub-CI sowie statische Workflowprüfung. Kein manueller Nutzerabnahmezwang.

**Voraussetzung:** Nativer LUUFI-1-Nachweis. **Ausschlüsse:** Projektverwaltung, Aufträge, Feedback, Medien, Produktionsrelease. **Dokumentation:** Feature Plattform, technische Grundlage und Betrieb. **Zustand:** In Implementierung bis Verifikation und Push; integriert erst nach bestätigtem develop-Merge.

## LUUFI-3 v1 – Eigenständige Projektideen

**Problem:** Die alte Sammlung unterstützt kein Bearbeiten und hängt in einer auslaufenden Workflow-Anwendung.

**Ergebnis und Ablauf:** Nutzer öffnet Projektideen ohne Projektzuordnung, erfasst Titel/Details, liest die persistente Sammlung, bearbeitet dieselbe Idee und kann nach Bestätigung löschen. Lade-/Fehler-/Konfliktfälle bewahren den Entwurf und erlauben sichere Wiederholung.

**Kriterien:** I-1: Deutsche CRUD-Oberfläche auf Desktop/Handy. I-2: Titel max.280, Detail max.4000 Zeichen und sichere Fehler. I-3: IDs und Bestandsinhalte bleiben unverändert; Bearbeiten erhält ID und Erstellzeit. I-4: Browser und MCP verwenden denselben Service mit atomaren Revisionen und dauerhaften Wiederholungsschlüsseln. I-5: Listen sind paginiert; Konflikt und Replay überschreiben keine neuere Änderung und erzeugen keine Duplikate. I-6: Native Identität und Browser-Origin schützen Mutationen; kein SQL-Werkzeug und keine Privatdaten in Fixtures.

**Teststrategie:** I-1 UI plus repräsentative echte D1-Browserabläufe in beiden Viewports; I-2 Domain+API; I-3 D1-Migrations-/CRUD-Regression; I-4/5 D1-Parallel-/Rollback-/Replay-Tests und MCP-Vertrag; I-6 HTTP/MCP-Sicherheitsfälle. Betroffene Regressionen: vorherige unabhängige Ideen, gleichbleibende Daten und primäre Navigation. Kein manueller Nutzerabnahmezwang.

**Voraussetzung:** Geprüfter vorheriger LUUFI-2-Commit. **Ausschlüsse:** Automatische Projektumwandlung, Projektfeedback, Anhänge, Produktionsfreigabe. **Dokumentation:** Feature Projektideen, Datenmodell, API/MCP und Migration. **Zustand:** In Implementierung bis Verifikation und Push; integriert erst nach bestätigtem develop-Merge.
