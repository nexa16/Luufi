---
document: feedback-architecture
documentation_policy: 1.0.0
---

# Feedback-Persistenz

## Verantwortung und Datenmodell

`lib/services/feedback.ts` stellt `listFeedback`, `getFeedback`, `listFeedbackEntries`, `listFeedbackRefinements`, `listOrderFeedbackSources`, `createFeedback`, `appendFeedback` und `refineFeedback` bereit. Der authentifizierte Actor stammt aus einem vertrauenswürdigen Adapter; Inhaltsobjekte erlauben keine Identitätsfelder. Alle Servicefehler verwenden den gemeinsamen `PlanningError`; Datenbankfehler werden bereinigt.

Migration `0007_feedback.sql` ergänzt Threads, unveränderliche Einträge, Medienplätze, Refinement-Datensätze und Auftragsquellen. Der Originaleintrag besitzt Position 0. Eine partielle eindeutige Einschränkung erlaubt genau einen Originaleintrag je Thread; `(feedback_id,position)` schützt die Reihenfolge. Ergänzungen reservieren ihre Position aus `next_entry_position` innerhalb derselben Transaktion. Medienplätze erhalten eine stabile ID und die Position ihres Manifests. Das Modell speichert keine Datei-Bytes im Thread.

Die allgemeine Threadrevision schützt sämtliche Änderungen; `content_revision` bezeichnet den fachlichen Inhalt. `refined_content_revision` hält den zuletzt verarbeiteten Inhalt fest. `needsRefinement` wird aus der Ungleichheit abgeleitet, wobei null unverarbeitet bedeutet. Der Mediendienst erhöht bei Bereitstellung neuer Bytes Inhalts- und allgemeine Revision; das Ablaufdatum eines unvollständigen Platzes betrifft ausschließlich Metadaten.

## Atomare Mutationen und Replay

Jede Mutation verwendet `planningAttempt` und `planningMutation`. Die erste Funktion liest einen bestehenden Beleg vor veränderlichen Voraussetzungen und nochmals vor einem zwischenzeitlich entstandenen Konflikt beziehungsweise Nichtgefunden-Fehler. Die zweite beansprucht den Schlüssel und speichert alle gebundenen SQL-Schreibschritte und das vollständige Originalergebnis in einem D1-Batch. Jeder Schreibschritt ist an den aktiven Schlüssel mit noch leerem Ergebnis gebunden. Scheitert ein Schritt oder das Receipt, rollt der gesamte Batch zurück.

`feedback.create` erstellt Thread, Original und alle Medienplätze gemeinsam. `feedback.append` prüft die bekannte Threadrevision, hängt einen neuen Eintrag an und erhöht Revision, Inhaltsrevision und Positionszähler genau einmal. `feedback.refine` prüft dieselbe Revision und sämtliche referenzierten Aufträge projektintern im SQL-Guard. Es speichert den aktuellen `content_revision`-Wert mit einem unveränderlichen normalisierten Ergebnis, erzeugt die Quellenbeziehungen und aktualisiert `refined_content_revision`. Es verändert keine Spezifikation oder Zustände von Aufträgen.

Replay-Payloads enthalten die Projekt-/Threadkennung und gegebenenfalls erwartete Revision. Text bleibt exakt; fehlende optionale Arrays und Gründe erhalten kanonische leere Werte. Auftragskennungen eines Refinements werden dedupliziert und sortiert. Der Receipt bindet zusätzlich Actor und Operation. Nach späteren Änderungen liefert Replay das ursprüngliche Ergebnis, ohne den aktuellen Stand zurückzuschreiben.

## Leseansichten und Konsistenz

Die gemeinsamen statischen JSON-Ausdrücke in `feedback-sql.ts` halten Serviceantworten, Replay und Mediendienst auf demselben Modell. Medien-URLs sind geschützte relative API-Pfade. Interne R2-Schlüssel werden nicht serialisiert. Einzelne Feedbackabrufe sind eine SQL-Abfrage. Einträge enthalten ihre Medienplätze in Manifestreihenfolge, Refinements ihren vollständigen dokumentierten Kontext und die exakte verarbeitete Inhaltsrevision.

Die Feedbackliste enthält nur den Thread, die ersten 280 SQLite-Zeichen des Originaltexts und aggregierte Zähler. Vollständige Texte und Historien haben eigene paginierte Endpunkte. `pendingAttachmentCount` zählt alle Plätze mit Status ungleich `ready`, einschließlich `expired`.

Alle Listen verwenden die gemeinsamen Seitengrenzen von 1–50, standardmäßig 25. Ein Cursor bindet Ansicht und Projekt sowie gegebenenfalls Thread oder Auftrag. Eintrags- und Refinementlisten verwenden die Threadrevision. Projektweite Feedbacklisten und Auftragsquellen verwenden die Summe `revision+1` aller Projektthreads; dadurch ändern auch neue Threads die Listenrevision. Nach dem ersten Revisionslesen werden Daten und erneute Revision in einem gemeinsamen D1-Batch gelesen. Eine Abweichung führt zum Konflikt statt zu einer scheinbar konsistenten Fortsetzung. Quellen zeigen über Refinement und Feedback zurück zum ursprünglichen Projekt; ein projektfremder Auftrag wird bereits beim Zugriff als nicht gefunden behandelt.

## Verifikation und Grenzen

Die fokussierten Tests in `tests/worker/feedback.test.ts` nutzen echte Migrationen und ausschließlich synthetische Daten. Sie prüfen Authorisierung, unveränderte Originaltexte mit CRLF/Unicode, Manifest- und Refinementgrenzen, Quellenbeziehungen, konkurrierende Revisionen einschließlich neuer Inhalte vor dem Refinementguard, persistente identische Wiederholungen, vollständigen Receipt-Rollback sowie alle vier Listen und ihre Cursor. Die Tests führen keine Uploads, Browseraktionen oder Produktionsänderungen aus. Transport-, UI- und R2-Prüfungen gehören zu den jeweiligen Integrations- und Medienaufträgen.
