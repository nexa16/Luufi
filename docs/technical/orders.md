# Auftragskern

Auftrag LUUFI-6, Fassung 1. Richtlinien: Dokumentation/Planung 1.0.0, Implementierung/Datenzugriff 1.0.1.

`lib/services/orders.ts` exportiert `createOrder`, `getOrder`, `listOrders` und `updateDraftOrder`. Jede Operation verlangt eine nicht leere serverseitige Sites-Identität. Eingaben akzeptieren keine fremden Identitäts- oder Statusfelder. `createOrder` und `updateDraftOrder` erhalten einen Typ und eine ersetzende Spezifikation mit mindestens Titel, Ziel und Herkunft; fehlende optionale Felder werden leer gespeichert. Es handelt sich nicht um eine partielle Patchoperation.

## Daten und atomare Invarianten

`planning_orders` speichert Projekt, stabile Nummer, Typ, Zustand, aktuelle Spezifikationsfassung, Revision und Reihenfolge. `planning_order_versions` speichert unveränderliche JSON-Spezifikationen und Zeitpunkte. Die erste Fassung ist 1, die erste Revision 0. Eine Entwurfsänderung erhöht Fassung und Revision um eins und ergänzt ausschließlich einen neuen Snapshot. Ältere Snapshots werden niemals überschrieben. Typänderungen sind nur zusammen mit dieser Entwurfsänderung möglich.

Anlegen aktualisiert `planning_projects.next_order_number` atomar im D1-Batch und verwendet die unmittelbar zuvor reservierte Nummer. Es gibt kein `MAX(number)+1`. Parallel erfolgreiche unterschiedliche Anfragen erhalten unterschiedliche Nummern. Die Position wird am Ende der ungeplanten Gruppe angefügt. Registrierung reserviert den Bootstrap-Nummernraum außerhalb dieses Services.

Alle Mutationen verwenden `planningReplay` vor dem Lesen veränderlicher Voraussetzungen. Anschließend bindet `planningMutation` Guard, Datenänderungen und vollständige ursprüngliche Antwort in eine Transaktion. Jede Schreibanweisung enthält den Gate-Ausdruck des Helpers. Eine Entwurfsänderung prüft ID, Projekt, Revision und Zustand `draft` erneut im atomaren Guard. Ein fehlender oder fehlerhafter Ergebnisbeleg bricht die gesamte Transaktion ab und verbraucht auch keine Nummer.

Änderungen erhöhen `planning_projects.planning_revision`; die Revision der Projektstammdaten bleibt unverändert. Listencursor binden diese Planrevision und den normalisierten Filter. Nach initialer Cursorprüfung liest ein D1-Batch Daten und Planrevision im selben Snapshot. Weicht die Revision ab, wird kein potenziell lückenhaftes Ergebnis ausgegeben. Die Sortierung folgt geplanten Milestones, dann ungeplanten Aufträgen; innerhalb jeder Gruppe folgen Position und stabile ID.

## Ergebnis- und Fehlervertrag

Jede Auftragsantwort enthält aktuelle Spezifikation, vollständige aufsteigende Fassungshistorie und stabil nach Beziehungstyp und Ziel-ID geordnete Beziehungen. Eine korrelierte SQL-JSON-Abfrage stellt diese Antwort innerhalb eines Snapshots zusammen. Derselbe Ausdruck bildet den dauerhaften Replay-Beleg. Wiederholungen nach späteren Mutationen liefern daher den ursprünglichen Stand statt einer nachträglich neu gelesenen Antwort.

Fehler verwenden `PlanningError`: `validation`, `unauthorized`, `not_found`, `conflict`, `unavailable`. Fehlende Ziele sind kein erfolgreicher leerer Schreibvorgang. Veraltete Revisionen und verletzte veränderliche Voraussetzungen erzeugen `conflict`. Andere Datenbankfehler werden bereinigt; SQL und Credentials verlassen die Speichergrenze nicht. Ein Cursor passt nur zu genau seinem Projekt und Filter; nach einer Planänderung muss erneut mit der ersten Seite begonnen werden.

## Verifikation

Die primäre Ebene sind echte D1-Integrationstests in `tests/worker/orders.test.ts`. Sie prüfen insbesondere parallele Nummern, konkurrierende Fassungsänderungen, eine unmittelbar vor Batchbeginn geänderte Statusvoraussetzung, alte Replay-Antworten und den Rollback bei künstlich fehlschlagender Ergebnisspeicherung. Sämtliche Fixtures sind synthetisch. Browser-, MCP- und Deploymentverifikation werden bei ihrer jeweiligen Anbindung ergänzend durchgeführt.
