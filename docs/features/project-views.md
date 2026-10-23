---
feature: project-views
documentation_policy: 1.0.0
---

# Projekte und Milestones lesen

## Zweck und Umfang

Die Projektansichten machen registrierte Projekte und ihre geordnete Milestone-Planung auf Desktop und Handy lesbar. Die Browseroberfläche zeigt den gespeicherten Stand; Verwaltung und Umordnung erfolgen außerhalb dieser lesenden Ansichten.

## Nutzerabläufe

**Projekte** öffnet die Liste registrierter Projekte. Projektname und Kürzel helfen bei der Auswahl. Der Projektname führt zur **Übersicht**. Dort stehen der nächste offene Milestone und die gespeicherten Projekteinstellungen: Kennung, Repository, Integrations- und Produktionsbranch, Dokumentationspfade sowie optionale Bereitstellungshinweise.

**Milestones** zeigt die festgelegte Reihenfolge mit Titel, Beschreibung und Zustand. **Alle Projekte** kehrt zur Sammlung zurück. Weitere Seiten lassen sich über **Weitere laden** ergänzen; **Aktualisieren** liest die erste Seite erneut. Projektideen bleiben eine eigenständige Sammlung in der Hauptnavigation.

## Regeln und Zustände

Der nächste Milestone ist der erste offene Eintrag in der gespeicherten Reihenfolge. Geschlossene Einträge werden übersprungen, nötigenfalls über mehrere Datenseiten hinweg. Ohne offenen Eintrag zeigt die Übersicht ausdrücklich **Kein offener Milestone geplant**. Die Milestone-Liste unterscheidet **Offen** und **Geschlossen**.

Die private Site und die lesenden REST-Endpunkte prüfen die zugelassene Identität. Die Oberfläche bietet keine Browser-Schreibaktionen für Projekte oder Milestones an. Lesen verändert weder Daten noch Reihenfolge. Fehlende optionale Einstellungen werden als nicht hinterlegt bezeichnet. Aktive Navigation wird für assistive Technik gekennzeichnet.

## Sonder- und Fehlerfälle

Laufende Datenabrufe und leere Sammlungen besitzen eigene Zustände. Fehler zeigen eine verständliche Meldung und eine Wiederholung. Bereits geladene Listeneinträge bleiben bei Fehlern einer Folgeseite sichtbar. Die Wiederholung verwendet denselben Cursor; meldet der Server eine geänderte Planung mit HTTP 409, beginnt **Liste neu laden** bewusst auf der ersten Seite. Doppelte Einträge werden anhand ihrer stabilen ID zusammengeführt.

Beim Wechsel des Projekts werden ältere Abrufe abgebrochen. Verspätete Antworten dürfen den neuen Projektkontext nicht ersetzen. Der Projektabruf und der Abruf des nächsten Milestones haben getrennte Fehlerbehandlung: Ein Milestone-Ausfall verhindert nicht das Lesen bereits verfügbarer Projekteinstellungen.

## Grenzen

Die Browseransichten erlauben kein Registrieren, Bearbeiten, Umordnen oder Schließen von Projekten und Milestones. Feedback und Versionen sind hier nicht enthalten. Bereitstellungshinweise sind gespeicherter Text und kein Nachweis einer tatsächlichen Veröffentlichung.

## Technische Verweise

[`app/planning.tsx`](../../app/planning.tsx) enthält die lesenden Komponenten, Cursor-Nachladen und Fehlerbehandlung. [`app/page.tsx`](../../app/page.tsx) bindet die Projektsammlung ein; [`app/projects/[projectId]/page.tsx`](../../app/projects/%5BprojectId%5D/page.tsx) und die darunterliegende Milestone-Route binden die Projektansichten ein. Die Datenformen stehen in [`lib/domain/planning.ts`](../../lib/domain/planning.ts).

Die Oberfläche verwendet `GET /api/projects`, `GET /api/projects/{projectId}` und `GET /api/projects/{projectId}/milestones`. Listen liefern `{items, nextCursor}`. Alle Abrufe verwenden `cache: no-store`; fachliche Fehler liefern `{code, error}`. Die Daten werden von den gemeinsamen fachlichen Services aus D1 gelesen.

## Verifikation

[`tests/ui/planning.test.tsx`](../../tests/ui/planning.test.tsx) prüft Sammlung, Projektkontext, nächsten offenen Milestone, Einstellungen, Reihenfolge, Lade- und Fehlerfälle, Cursor-Neustart und Schutz vor verspäteten Antworten. [`tests/e2e/planning.spec.ts`](../../tests/e2e/planning.spec.ts) beschreibt den durchgängigen lesenden Browserablauf mit synthetischen lokalen D1-Daten auf Desktop und Handy. Ein lokaler Test ist kein Veröffentlichungs- oder Produktionsnachweis.
