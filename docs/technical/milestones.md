---
document: milestones-architecture
documentation_policy: 1.0.0
---

# Milestone-Service

## Verantwortung und Datenmodell

`lib/services/milestones.ts` verwendet `getD1()` und die gemeinsamen Typen in `lib/domain/planning.ts`. Es liefert fachliche Operationen unabhängig von Browser- oder MCP-Transport. Der vertrauenswürdige Adapter übergibt den Actor; die Eingabe darf nur Titel und Beschreibung enthalten. `PlanningError` übersetzt erwartbare Fehler in `validation`, `unauthorized`, `not_found`, `conflict` oder `unavailable`.

Migration `0006_planning.sql` erstellt `planning_milestones` mit `id`, `project_id`, `title`, `description`, `state`, `position` und `revision`. Die Projektzuordnung verweist auf `planning_projects`; der Index über Projekt, Position und ID bestimmt die Reihenfolge. Bestehende Ideen und historische Migrationen werden nicht verändert. Der Service erstellt keine weitere Migration.

Inhaltsrevision und projektweite `planning_revision` haben unterschiedliche Aufgaben. Die Milestone-Revision schützt Bearbeiten und bezeichnet das ausdrücklich geänderte Ziel. Die Planungsrevision schützt Reihenfolge und lesende Cursor und steigt bei Anlegen, Bearbeiten oder Verschieben genau einmal. Ein Verschieben indiziert alle Projekt-Milestones über ein gebundenes JSON-ID-Array und `json_each` auf Positionen ab 0. Geschlossene Anker behalten ihren fachlichen Inhalt und ihre Inhaltsrevision.

## Servicevertrag

```text
listMilestones(actor, projectId, {limit?, cursor?}={}) -> Page<Milestone>
getMilestone(actor, projectId, id) -> Milestone
createMilestone(actor, projectId, {title, description?}, requestKey) -> Milestone
updateMilestone(actor, projectId, id, {title, description?}, expectedRevision, requestKey) -> Milestone
moveMilestone(actor, projectId, id, beforeId|null, expectedPlanningRevision, requestKey) -> Milestone
```

Listen verwenden die gemeinsamen Grenzen von 1 bis 50 Einträgen, standardmäßig 25. Ihr Cursor bindet den Scope `milestones`, die Projekt-ID und die Planungsrevision. Nach dem Lesen der Zeilen wird die Projekt-Revision erneut geprüft. Dadurch liefert auch eine zwischen den Datenbankabfragen geänderte Planung keine scheinbar konsistente Seite mit veraltetem Fortsetzungszeiger. Einzelabrufe und Mutationsergebnisse verwenden dasselbe vollständige Milestone-Modell.

## Atomare Änderungen und Replay

Mutationen prüfen zuerst den bestehenden Replay-Beleg und erst danach veränderliche Voraussetzungen. Normalisierter Payload und Operationsnamen `milestones_create`, `milestones_update` beziehungsweise `milestones_move` unterscheiden die Befehle. Die gemeinsamen Belege binden zusätzlich den authentifizierten Actor und den Wiederholungsschlüssel. Aufrufwiederholungen liefern das ursprüngliche JSON-Ergebnis, ohne spätere Fassungen zurückzuschreiben.

`planningMutation` beansprucht den Schlüssel nur unter dem SQL-Guard. Alle folgenden Schreibstatements sind zusätzlich an das von diesem Request beanspruchte Gate gebunden. Eine SQL-Unterabfrage erzeugt die vollständige Antwort im selben Batch; ein fehlendes oder ungültiges Receipt bricht die gesamte Transaktion ab.

- Anlegen prüft die Existenz des Projekts im Guard und berechnet die nächste Position innerhalb des Batches. Parallele Anlegeaufrufe erhalten dadurch unterschiedliche Positionen.
- Bearbeiten prüft Projekt, Ziel, offene Zustandsgrenze und erwartete Inhaltsrevision atomar.
- Verschieben prüft Projekt-Planungsrevision, offenes Ziel und vorhandenen projektinternen Anker atomar. Die vorab gelesene vollständige ID-Reihenfolge darf daher nur übernommen werden, wenn ihre Planungsrevision noch gilt.

SQL verwendet gebundene Parameter; Eingaben werden weder als SQL noch als Pfade ausgeführt. Rohfehler verlassen `planningStorage` nicht. Der Service bietet keinen allgemeinen Zustandssetter, keine Schließfunktion und keine Löschung.

## Verifikation und Grenzen

Die fokussierten Worker-Tests in `tests/worker/milestones.test.ts` verwenden echtes migriertes D1. Sie prüfen konkurrierendes Anlegen/Bearbeiten/Verschieben, Wiederholung nach jüngeren Änderungen, projektfremde Daten, geschlossene Ziele einschließlich Schließen unmittelbar vor dem atomaren Batch, invalidierte Cursor einschließlich Änderung während des Lesens und vollständigen Rollback bei Receiptfehler. Tests verwenden ausschließlich synthetische Daten.

Browser- und MCP-Adapter sowie Projektansichten werden vom Koordinator beziehungsweise separaten Aufträgen integriert. Ein bestandener Service-Test ist kein Nachweis eines veröffentlichten nativen Werkzeugs. Coverage wird lokal nicht ausgeführt; die gemeinsamen Gesamtgrenzen gelten im finalen CI-Gate.
