# Bootstrap-Aufträge

Die IDs sind dauerhaft reserviert und werden bei Einführung der Auftragsverwaltung unverändert übernommen. Die Gesamtplanfreigabe und deren ausdrückliche Fortsetzung am 23. Oktober 2026 autorisieren ausschließlich den beschriebenen Umfang. Produktion erhält eine eigene Release-Freigabe. Das lokale Übergabeprotokoll bleibt außerhalb des öffentlichen Repositorys.

## LUUFI-1 v1 – Nativer MCP-Nachweis

Technische Voraussetzung, im getrennten privaten Preview-Quellspeicher implementiert. Tatsächliche native Lese-/Schreib-, Replay-/Konflikt-, Richtlinien- und Anhangprüfung bestanden. Die alte private Proof-Historie wird nicht in dieses neue Repository importiert. Die neue Grundlage übernimmt nur gezielt benötigte MCP-Komponenten.

## LUUFI-2 v1 – Bereinigte Grundlage

**Ziel:** Eigenständiger deutscher React/Worker-Neubau mit D1 und nativem Sites-MCP, ohne alte GitHub-/OAuth-/Workflow-Dienste.

**Umfang:** Neue öffentliche Historie, private Archivierung, gezielte UI-/MCP-/D1-Grundlage, versionierte Richtlinien, sichere Umgebungsidentität, CI und Merge nach exaktem erfolgreichem CI-SHA. Dokumentation und Tests gehören zum selben Auftragscommit.

**Kriterien:** F-1: Deutsche Navigation und ehrlicher leerer Projektbereich. F-2: Sites-Identität schützt Health und MCP; Probedaten nur Preview. F-3: Health/Kontext/Banner stimmen mit Branch/SHA/Umgebung überein, kein GitHub-Token erforderlich. F-4: Alle Richtlinien haben korrekte Versionen und Hashes. F-5: Alte Migrationen unverändert, keine private alte Historie oder Live-Daten im öffentlichen Repository. F-6: CI prüft Typen/Tests/Lint/Build; privilegierter Merge führt keinen PR-Code aus und integriert niemals automatisch nach main.

**Teststrategie:** F-1 UI; F-2 Worker/API plus lokaler Auth-Grenztest; F-3 Unit+Worker sowie nativer Deployment-Smoke; F-4 Worker/Hash und exakter Quelldatenvergleich; F-5 bewusste Datei-/Historienprüfung und Migrationsinventar; F-6 GitHub-CI sowie statische Workflowprüfung. Kein manueller Nutzerabnahmezwang.

**Voraussetzung:** Nativer LUUFI-1-Nachweis. **Ausschlüsse:** Projektverwaltung, Aufträge, Feedback, Medien, Produktionsrelease. **Dokumentation:** Feature Plattform, technische Grundlage und Betrieb. **Zustand:** Zusammen mit LUUFI-3 in PR1 nach develop integriert (`f1b18e0d563283e4b8d89e5c73fa465304b7ce79`); Produktion bleibt separat freizugeben.

## LUUFI-3 v1 – Eigenständige Projektideen

**Problem:** Die alte Sammlung unterstützt kein Bearbeiten und hängt in einer auslaufenden Workflow-Anwendung.

**Ergebnis und Ablauf:** Nutzer öffnet Projektideen ohne Projektzuordnung, erfasst Titel/Details, liest die persistente Sammlung, bearbeitet dieselbe Idee und kann nach Bestätigung löschen. Lade-/Fehler-/Konfliktfälle bewahren den Entwurf und erlauben sichere Wiederholung.

**Kriterien:** I-1: Deutsche CRUD-Oberfläche auf Desktop/Handy. I-2: Titel max.280, Detail max.4000 Zeichen und sichere Fehler. I-3: IDs und Bestandsinhalte bleiben unverändert; Bearbeiten erhält ID und Erstellzeit. I-4: Browser und MCP verwenden denselben Service mit atomaren Revisionen und dauerhaften Wiederholungsschlüsseln. I-5: Listen sind paginiert; Konflikt und Replay überschreiben keine neuere Änderung und erzeugen keine Duplikate. I-6: Native Identität und Browser-Origin schützen Mutationen; kein SQL-Werkzeug und keine Privatdaten in Fixtures.

**Teststrategie:** I-1 UI plus repräsentative echte D1-Browserabläufe in beiden Viewports; I-2 Domain+API; I-3 D1-Migrations-/CRUD-Regression; I-4/5 D1-Parallel-/Rollback-/Replay-Tests und MCP-Vertrag; I-6 HTTP/MCP-Sicherheitsfälle. Betroffene Regressionen: vorherige unabhängige Ideen, gleichbleibende Daten und primäre Navigation. Kein manueller Nutzerabnahmezwang.

**Voraussetzung:** Geprüfter vorheriger LUUFI-2-Commit. **Ausschlüsse:** Automatische Projektumwandlung, Projektfeedback, Anhänge, Produktionsfreigabe. **Dokumentation:** Feature Projektideen, Datenmodell, API/MCP und Migration. **Zustand:** Integriert mit LUUFI-2 in PR1; Merge `f1b18e0d563283e4b8d89e5c73fa465304b7ce79`. Keine Produktionsfreigabe.

## Welle3: verbindliche Aufteilung der bestehenden Gesamtfreigabe

Die folgenden Fassungen v1 konkretisieren ausschließlich den bereits freigegebenen Neubauplan. Kontext ist develop `f1b18e0d563283e4b8d89e5c73fa465304b7ce79`; Dokumentations-/Planungsrichtlinie1.0.0, Implementierungs-/Datenzugriffsrichtlinie1.0.1 nativ gelesen. Keine neue Produktentscheidung und keine Produktionsfreigabe. Zentrale Migrationen/Typen/Transaktionen beim Koordinator; getrennte Services und Leseansichten dürfen parallel entstehen.

### LUUFI-4 v1 – Projekte und gemeinsame Planungspersistenz

**Problem/Ergebnis:** Codex benötigt stabile Projektkonfiguration statt alter GitHub-Projektverknüpfung. Registrierung erzeugt dauerhaftes Kürzel, Konfiguration und eigenen atomaren Auftragszähler.

**Kriterien:** P-1 eindeutiges unveränderliches Kürzel und relative Dokumentationspfade; P-2 registrieren/lesen/ändern über geschützten gemeinsamen Service und MCP; P-3 Revision, actor-/payload-gebundener Replay und vollständiger Transaktionsrollback; P-4 paginierte konfliktbewusste Listen; P-5 bestehende Ideen und Migrationen unverändert, Bootstrap1–9 reserviert.

**Teststrategie:** P-1–4 echte D1-/MCP-/API-Tests, P-5 Migrationserhalt. **Voraussetzung:** integrierte LUUFI-2/3. **Ausschlüsse:** Projektanlage im Browser, Importdienst, GitHub-Sync. **Dokumentation:** Projekte und Planungskern.

### LUUFI-5 v1 – Geordnete Milestones

**Problem/Ergebnis:** Planungsabschnitte benötigen explizite Reihenfolge. Codex erstellt und bearbeitet offene Milestones und verschiebt sie vor einen Anker; die erste offene Position ist die nächste.

**Kriterien:** M-1 Projektgrenzen und stabile IDs; M-2 revisioniertes Erstellen/Bearbeiten mit Replay; M-3 atomare, konfliktbewusste Reihenfolge und Cursor; M-4 geschlossene Ziele unverändert, leere Listen ehrlich.

**Teststrategie:** M-1–4 D1-Services und MCP-Adapter, einschließlich konkurrierender Moves und Rollback. **Voraussetzung:** LUUFI-4. **Ausschlüsse:** Lifecycle/Schließen, Browsermutation. **Dokumentation:** Milestones fachlich/technisch.

### LUUFI-6 v1 – Versionierte Entwurfsaufträge

**Problem/Ergebnis:** Arbeit benötigt eigene unveränderliche IDs und nachvollziehbare Spezifikationsfassungen. Codex erstellt Entwürfe mit Titel/Ziel/Herkunft und überarbeitet sie in neuen historischen Fassungen.

**Kriterien:** O-1 atomare eindeutige Nummern ohne Wiederverwendung, auch bei parallelem Create/Replay; O-2 unveränderliche historische Spezifikationen, getrennte specVersion/revision; O-3 filter-/seitenfähige Listen mit Konflikten; O-4 strikte Validierung und nur Entwurfsänderung, kein frei beschreibbarer Status.

**Teststrategie:** O-1–4 D1-Konkurrenz-/Rollback-/Versions-/Filtertests plus MCP-Vertrag. **Voraussetzung:** LUUFI-4. **Ausschlüsse:** Freigaben, Ausführung und Git-Nachweise. **Dokumentation:** Aufträge fachlich/technisch.

### LUUFI-7 v1 – Auftragszuordnung und Beziehungen

**Problem/Ergebnis:** Entwürfe werden zu offenen Milestones geordnet und mit nachvollziehbaren Beziehungen verbunden, ohne Spezifikationshistorie zu verändern.

**Kriterien:** R-1 explizite Reihenfolge/Anker und unverplante Aufträge; R-2 atomare Auftrags-/Planrevisionsprüfung; R-3 nur dasselbe Projekt, keine Selbstbeziehung und keine Abhängigkeitszyklen; R-4 Wiederholung/Rollback erhalten Ergebnis und Historie; R-5 laufende/abgeschlossene Planung sowie geschlossene Milestones geschützt.

**Teststrategie:** R-1–5 D1-Reorder-/Graph-/Race-/Replay-Tests und MCP. **Voraussetzung:** LUUFI-5/6. **Ausschlüsse:** Lifecycle und automatische Freigaben. **Dokumentation:** Aufträge/Beziehungsmodell.

### LUUFI-8 v1 – Projekt- und Milestone-Leseansichten

**Problem/Ergebnis:** Nutzer sieht registrierte Projekte, Konfiguration und nächsten offenen Milestone auf Desktop/Handy.

**Kriterien:** V-1 deutsche lesbare Navigation; V-2 Projektliste/Detail/Milestones mit Lade-/Leer-/Fehler-/Wiederholungszuständen; V-3 Seitennavigation ohne versteckte Datenauslassung; V-4 keine Browser-Verwaltungsaktionen.

**Teststrategie:** V-1–4 fokussierte UI-Tests und repräsentative Browserprüfung gegen ausschließlich synthetische lokale D1-Daten. **Voraussetzung:** LUUFI-4/5. **Ausschlüsse:** Feedback/Versionen und Schreibformulare. **Dokumentation:** Projektansichten.

### LUUFI-9 v1 – Lesbare Aufträge mit Filtern und Historie

**Problem/Ergebnis:** Nutzer kann Aufträge nach Milestone/Zustand/Typ filtern und Fassung, Kriterien, Teststrategie, Herkunft und Beziehungen nachvollziehen.

**Kriterien:** A-1 Liste/Filter/Pagination einschließlich unverplant; A-2 Detail mit stabiler Kennung, Status, Spezifikation, historischen Fassungen und Beziehungen; A-3 deutsche mobile Darstellung, sichere Fehler und veraltete Antworten werden verworfen.

**Teststrategie:** A-1–3 UI-Tests und repräsentative echte lokale D1-Browserabläufe. **Voraussetzung:** LUUFI-6/7/8. **Ausschlüsse:** Browseränderung, Ausführung und Nachweislifecycle. **Dokumentation:** Projektansichten/Aufträge.

## Welle 4: Feedback und private Medien

Die Gesamtfreigabe autorisiert diese konkreten Fassungen v1 auf integriertem develop506ffab1. Dokumentation/Planung1.0.0 und Implementierung/Datenzugriff1.0.1 gelten. Kein Produktionsrelease, keine automatische Analyse oder Implementierung.

### LUUFI-10 v1 – Projektfeedback und Refinementquellen

**Problem/Ergebnis:** Beobachtungen benötigen unveränderliche Originale, Ergänzungen und nachvollziehbare fachliche Verarbeitung.

**Kriterien:** F-1 Originaltext exakt erhalten, 20.000 Zeichen und höchstens zehn Uploadplätze je Eingabe; F-2 Ergänzungen und atomare Revisionen/Replay ohne Duplikate; F-3 paginierte projektgebundene Listen und sichere Browser-/MCP-Grenzen; F-4 Refinement dokumentiert exakten Repositorycommit, Richtlinien, Inhaltsrevision und mindestens Aufträge, Fragen oder begründete Zurückstellung/Verwerfung; F-5 mehrere Quellen/Aufträge bleiben in beiden Richtungen nachvollziehbar, neue Inhalte erzeugen erneuten Bedarf.

**Teststrategie:** F-1–5 D1-Persistenz-/Race-/Rollback-/Cursorprüfungen; Browser-/MCP-Adapter prüfen denselben Service, Origin, Identität, JSON-Grenzen und strukturierte Fehler. **Voraussetzung:** LUUFI-4/6. **Ausschlüsse:** KI-Analyse, automatische Auftragserstellung/Freigabe, Feedbacklöschen. **Dokumentation:** Feedback fachlich/technisch.

### LUUFI-11 v1 – Private Medien und sichere Wiederholung

**Problem/Ergebnis:** Bilder/Videos sollen privat verfügbar bleiben und unvollständige Übertragungen den Text nicht verlieren.

**Kriterien:** M-1 JPEG/PNG/WebP bis10MB, MP4/MOV/WebM bis15MB tatsächlich serverseitig prüfen; M-2 private R2-Objekte, sichere Abrufheader/Download und Videobereiche; M-3 Upload-CAS und actor-/bytesgebundener Replay, fertige Bytes unveränderlich; M-4 pending/expired Plätze bleiben wiederholbar, begrenzte24h-Bereinigung löscht keine fertigen Referenzen; M-5 native Metadaten und höchstens64KiB-Dateistücke ohne generische Bucket-/SQL-Werkzeuge.

**Teststrategie:** M-1 Unitformat-/Grenzfälle; M-2–5 echte D1/R2-/HTTP-/MCP-Tests einschließlich Race, abgebrochener Speicherung und wiederholter Bereinigung. Formate werden strukturell geprüft, ohne vollständige Codec-Decodierung. **Voraussetzung:** LUUFI-10 Slots und gemeinsamer Planungskern. **Ausschlüsse:** HEIC/Konvertierung/Transkription/öffentliche Links. **Dokumentation:** Medien und Betriebsbereinigung.

### LUUFI-12 v1 – Mobile Feedbackeingabe und Uploadfortschritt

**Problem/Ergebnis:** Nutzer hält Projektbeobachtungen mit Dateien am Handy fest und erkennt getrennt gespeicherten Text und Dateistatus.

**Kriterien:** U-1 deutsche Projektliste/Detail/Originale/datierte Ergänzungen und paginierte Refinements/Quellen; U-2 Text und Plätze vor seriellen Dateiübertragungen, tatsächlicher Bytefortschritt und Serverprüfung; U-3 unklare Antworten sicher wiederholen, Slot nach Reload mit passender Datei fortsetzen ohne neue Texteingabe; U-4 geschützte Vorschau/Downloadfallback, fertige Dateien bleiben bei weiteren Fehlern erhalten; U-5 Projektwechsel und neue Eingaben können keine fremden oder laufenden Uploadantworten übernehmen.

**Teststrategie:** U-1–5 fokussierte UI-Interaktions-/Netzfehler-/Replay-/Kontextwechseltests; repräsentativer Desktop-/Handy-Browserablauf gegen synthetische lokale D1/R2 mit absichtlich fehlgeschlagenem Upload, Reload, Wiederholung und Ergänzung. Betroffene Regressionen: Planungsnavigation, Ideen, Migrationserhalt und authentifizierte Identität. **Voraussetzung:** LUUFI-10/11. **Ausschlüsse:** Browserrefinement, Hintergrundupload nach Verlassen und Lifecycleänderungen. **Dokumentation:** Feedbackansichten.
