---
feature: order-execution
documentation_policy: 1.0.0
---

# Aufträge freigeben und bearbeiten

## Zweck und Umfang

Codex kann geklärte Aufträge bereitstellen, konkrete Freigaben aus dem Nutzerchat dokumentieren und eine exklusive Bearbeitung mit Fortschritt führen. Die vorhandenen Zustände bleiben erhalten. Bereitstellung und Freigabespeicherung starten keinen Agenten. Git-/Abschlussbelege sind ein eigener Dienst.

## Nutzerabläufe

Ein Entwurf wird nach geklärtem Umfang, Ausschlüssen, Kriterien, Teststrategie, Voraussetzungen und konkretem Repository-/Richtlinienkontext bereit. Codex zeigt IDs, Titel und Fassungen; die konkrete Nutzerbestätigung wird als Verweis gespeichert. Eine Freigabe umfasst eine ausdrückliche Auswahl mit höchstens fünfzig IDs oder den vollständigen aktuellen offenen Milestone. Auch mehr als fünfzig Milestonemitglieder werden vollständig eingefroren und ihre Einzelheiten paginiert gelesen.

Die Milestonefreigabe verlangt, dass alle aktuellen Mitglieder bereit sind. Bereits integrierte, archivierte, laufende oder unbereite Mitglieder werden nicht still ausgelassen. Für verbleibende bereite Aufträge ist eine ausdrückliche Auswahl möglich. Später hinzugefügte Mitglieder besitzen keine frühere Freigabe.

Codex beginnt eine Bearbeitung mit dokumentierter Voraussetzungsprüfung, Bearbeiter und Arbeitsbranch. Unterbrechen hält Claim und Spezifikationssperre. Fortsetzung benötigt den Verweis auf die Nutzeraufforderung und prüft die unveränderte Freigabe erneut. Eine Übernahme hält Anlass, bisherigen Stand und neuen Bearbeiter fest. Stoppen zur Neuplanung benötigt ebenfalls eine ausdrückliche Nutzerreferenz; erst danach darf der Umfang als neue Entwurfsfassung geändert werden.

## Regeln und Zustände

- `draft -> ready` benötigt nicht leere scope/exclusions/testStrategy/prerequisites, mindestens ein Kriterium und vollständigen Repository-SHA mit Dokumentationsrichtlinienfassung. Nicht relevante Abschnitte können kurz begründet sein. Bereit ist keine Implementierungsfreigabe.
- Eine Freigabe hält Titel, Spezifikationsfassung, wirksame Abhängigkeiten sowie Repository und Integrationsbranch fest. Änderungen daran entwerten ihre Gültigkeit. Eine neuere Freigabe ersetzt frühere Bindungen genau der neu ausgewählten Aufträge; andere Mitglieder früherer Sammelfreigaben bleiben gültig. Ihr Widerruf aktiviert keine ältere Freigabe erneut. Rückgabe nach Entwurf oder Stoppen invalidiert bestehende Bindungen dauerhaft; historische Bestätigungen werden nicht überschrieben.
- Beginn verlangt aktuelle Freigabe, bekannte Auftragsrevision und erfüllte strukturierte Abhängigkeiten. Ein Vorgänger ist erledigt oder hat einen aktuellen erfolgreichen Implementierungsbeleg mit beobachtetem Push und Ancestry im selben Arbeitsbranch. Diese Gitfakten sind owner-authentifizierte Codex-Beobachtungen, keine unabhängige Serververifikation.
- Es gibt genau einen offenen Claim je Auftrag, auch während Pause. Eine Übernahme bewahrt die aktive beziehungsweise pausierte Phase und erhöht die Generation. Verspätete Aufrufe der früheren Generation werden abgewiesen. Zeitablauf erzeugt keine Fortsetzung oder Übernahme.
- Fortschritt ist datiert und append-only. Hindernisse brauchen eine nächste Aktion; es gibt keinen Blocker-Status und keine Zeiterfassung. Notizen erhöhen Auftrags- und Lifecycle-Revision, verändern aber keine Spezifikationsfassung.
- Stop/Replan gilt für in Implementierung befindliche oder implementierte Arbeit, beendet den Claim, entfernt den aktuellen Kandidatverweis und setzt Entwurf. Alte Belege bleiben historisch erhalten. Archivieren verlangt Grund und Entscheidungsverweis und ist nur für Entwurf/bereit erlaubt; aktive Arbeit muss zuerst ausdrücklich gestoppt werden. Erledigte Aufträge werden nicht erneut geöffnet.
- Ein nicht leerer Milestone schließt atomar, wenn alle Mitglieder erledigt oder archiviert sind. Vollständig archivierte nicht leere Milestones zählen. Leere schließen nur mit ausdrücklichem `confirmEmpty=true`; neue Zuordnung in geschlossene bleibt gesperrt.

## Sonder- und Fehlerfälle

Alle Änderungen prüfen Revision, Projektzugehörigkeit, Freigabe und Claimgrenzen atomar. Zwei parallele Starts gewinnen nicht beide. Freigabewiderruf verweigert offene Bearbeitung; der Nutzer muss sie ausdrücklich stoppen. Fehlende Ziele werden als nicht gefunden gemeldet, veraltete beziehungsweise unzulässige Voraussetzungen als Konflikt. Inhalte akzeptieren keine zusätzlichen Identitäts-/Statusfelder.

Wiederholungsschlüssel binden Actor, Operation und normalisierten Inhalt. Identische Wiederholungen liefern das Originalergebnis auch nach späterer Änderung; ein anderer Inhalt oder Actor mit demselben Schlüssel wird abgelehnt. Claim, Status, Ereignis, Invalidierung und Beleg werden vollständig gemeinsam gespeichert oder zurückgerollt. Fehler geben keine internen Datenbankdetails aus.

Freigaben, Freigabeitems, Fortschritt und Ereignisse haben eigene paginierte Listen. Cursor sind an Projekt, Auftrag/Freigabe und Revisionsstand gebunden. Änderungen während des Lesens oder zwischen Seiten verlangen einen Neustart; keine verborgene Historienbegrenzung.

## Grenzen

Dieser Umfang beinhaltet keine automatische Ausführung, Browsermutation, kryptografische Chatprüfung oder GitHub-Synchronisation. Nur der authentifizierte persönliche Codex-Aufrufer protokolliert tatsächlich erhaltene Nutzerfreigaben. Produktionsfreigaben, Versionen, Release und Bereitstellung folgen eigenen Regeln. Keine verpflichtende manuelle Nutzerabnahme oder Arbeitszeitabrechnung.

## Technische Verweise

[`order-lifecycle.ts`](../../lib/services/order-lifecycle.ts) enthält Bereitschaft, Freigaben und Milestone-Abschluss. [`order-execution.ts`](../../lib/services/order-execution.ts) enthält Claims und Fortschritt. [`execution.ts`](../../lib/domain/execution.ts), [`execution-sql.ts`](../../lib/services/execution-sql.ts) und additive Migration [`0008_execution.sql`](../../drizzle/0008_execution.sql) halten gemeinsame Verträge. Die [technische Dokumentation](../technical/order-execution.md) beschreibt die Transaktionsgrenzen.

## Verifikation

Die beiden fokussierten D1-Dateien [`order-lifecycle.test.ts`](../../tests/worker/order-lifecycle.test.ts) und [`order-execution.test.ts`](../../tests/worker/order-execution.test.ts) prüfen Zustandsgrenzen, fehlende Ready-Inhalte, 51-Mitglieder-Snapshot, Auswahl/Invalidierung, konkurrierende Claims, Widerruf im Startguard, Pause/Resume/Übernahme, Vorgängerbelege, Stop/Replan, Milestone-Abschluss, Fortschritt/Pagination und vollständigen Receipt-Rollback. Daten sind synthetisch; keine Coverage oder Produktionsaktion in diesen Tests. Verwendete Richtlinien: Dokumentation/Planung1.0.0 und Implementierung/Datenzugriff1.0.1, durch den Koordinator nativ gelesen.
