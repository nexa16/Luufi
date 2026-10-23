# Aufträge: Spezifikationen, Zuordnung und Beziehungen

Aufträge LUUFI-6 und LUUFI-7, jeweils Fassung 1. Richtlinien: Dokumentation/Planung 1.0.0, Implementierung/Datenzugriff 1.0.1.

`lib/services/orders.ts` exportiert `createOrder`, `getOrder`, `listOrders` und `updateDraftOrder`. Jede Operation verlangt eine nicht leere serverseitige Sites-Identität. Eingaben akzeptieren keine fremden Identitäts- oder Statusfelder. `createOrder` und `updateDraftOrder` erhalten einen Typ und eine ersetzende Spezifikation mit mindestens Titel, Ziel und Herkunft; fehlende optionale Felder werden leer gespeichert. Es handelt sich nicht um eine partielle Patchoperation.

`placeOrder` ergänzt Zuordnung und Reihenfolge. `setOrderRelation` und `removeOrderRelation` verwalten gerichtete Kanten. Alle Schreiboperationen benötigen Wiederholungsschlüssel und binden die ursprüngliche vollständige Auftragsantwort dauerhaft an die Anfrage.

## Daten und atomare Invarianten

`planning_orders` speichert Projekt, stabile Nummer, Typ, Zustand, aktuelle Spezifikationsfassung, Revision und Reihenfolge. `planning_order_versions` speichert unveränderliche JSON-Spezifikationen und Zeitpunkte. Die erste Fassung ist 1, die erste Revision 0. Eine Entwurfsänderung erhöht Fassung und Revision um eins und ergänzt ausschließlich einen neuen Snapshot. Ältere Snapshots werden niemals überschrieben. Typänderungen sind nur zusammen mit dieser Entwurfsänderung möglich.

Anlegen aktualisiert `planning_projects.next_order_number` atomar im D1-Batch und verwendet die unmittelbar zuvor reservierte Nummer. Es gibt kein `MAX(number)+1`. Parallel erfolgreiche unterschiedliche Anfragen erhalten unterschiedliche Nummern. Die Position wird am Ende der ungeplanten Gruppe angefügt. Registrierung reserviert den Bootstrap-Nummernraum außerhalb dieses Services.

Alle Mutationen verwenden `planningReplay` vor dem Lesen veränderlicher Voraussetzungen. Anschließend bindet `planningMutation` Guard, Datenänderungen und vollständige ursprüngliche Antwort in eine Transaktion. Jede Schreibanweisung enthält den Gate-Ausdruck des Helpers. Eine Entwurfsänderung prüft ID, Projekt, Revision und Zustand `draft` erneut im atomaren Guard. Ein fehlender oder fehlerhafter Ergebnisbeleg bricht die gesamte Transaktion ab und verbraucht auch keine Nummer.

`planningAttempt` führt diese initiale Replay-Prüfung aus und prüft bei einem anschließenden Konflikt oder fehlenden Ziel den Beleg erneut. Parallele identische Aufrufe bleiben dadurch auch dann wiederholbar, wenn der erste Aufruf gerade zwischen Receipt-Lesen und veränderlicher Vorprüfung speichert.

Änderungen erhöhen `planning_projects.planning_revision`; die Revision der Projektstammdaten bleibt unverändert. Listencursor binden diese Planrevision und den normalisierten Filter. Nach initialer Cursorprüfung liest ein D1-Batch Daten und Planrevision im selben Snapshot. Weicht die Revision ab, wird kein potenziell lückenhaftes Ergebnis ausgegeben. Die Sortierung folgt geplanten Milestones, dann ungeplanten Aufträgen; innerhalb jeder Gruppe folgen Position und stabile ID.

## Ergebnis- und Fehlervertrag

Jede Auftragsantwort enthält aktuelle Spezifikation, vollständige aufsteigende Fassungshistorie und stabil nach Beziehungstyp und Ziel-ID geordnete Beziehungen. Eine korrelierte SQL-JSON-Abfrage stellt diese Antwort innerhalb eines Snapshots zusammen. Derselbe Ausdruck bildet den dauerhaften Replay-Beleg. Wiederholungen nach späteren Mutationen liefern daher den ursprünglichen Stand statt einer nachträglich neu gelesenen Antwort.

Fehler verwenden `PlanningError`: `validation`, `unauthorized`, `not_found`, `conflict`, `unavailable`. Fehlende Ziele sind kein erfolgreicher leerer Schreibvorgang. Veraltete Revisionen und verletzte veränderliche Voraussetzungen erzeugen `conflict`. Andere Datenbankfehler werden bereinigt; SQL und Credentials verlassen die Speichergrenze nicht. Ein Cursor passt nur zu genau seinem Projekt und Filter; nach einer Planänderung muss erneut mit der ersten Seite begonnen werden.

## Platzierung und Abhängigkeitsgraph

`placeOrder(actor, projectId, id, milestoneId, beforeId, expectedRevision, expectedPlanningRevision, requestKey)` verwendet `null` für die ungeplante Gruppe und für Anhängen ohne Anker. Die aktuelle Gruppe und Zielgruppe werden im D1-Snapshot gelesen. Nach der gewünschten Einfügung reindexiert SQL die gebundenen ID-Arrays über `json_each`; es werden keine Fließkommapositionen verwendet. Die Quelle erhält eine neue Auftragsrevision, das Projekt genau eine neue Planrevision. Die Spezifikationsfassung und Historie bleiben gleich.

Der atomare Guard prüft erneut Quell-ID/Projekt/Revision, Quellzustand `draft` oder `ready`, offene Quellmilestone-Mitgliedschaft, exakte Projektplanrevision, offenen Zielmilestone desselben Projekts und Ankerzugehörigkeit. Damit kann zwischen vorheriger Berechnung und Schreiben weder ein gleichzeitiger Move noch ein Milestone-Abschluss unbemerkt übernommen werden. Auch ein Move innerhalb derselben Gruppe verwendet diesen Guard. Reindexierung anderer Auftragspositionen ändert deren Spezifikation und Auftragsrevision nicht; die Planrevision schützt die gesamte Reihenfolge.

Beziehungskanten liegen in `planning_order_relations` mit eindeutigem Schlüssel aus Quelle, Ziel und Typ. Die Quelle muss `draft` oder `ready` sein, beide Endpunkte gehören zum selben Projekt und dürfen keinem geschlossenen Milestone angehören. Eine Kante wird nur bei erwarteter Quellrevision und noch erfülltem Existenz-/Abwesenheitszustand geändert. Gleichzeitige unabhängige Kantenänderungen dürfen stattfinden, werden aber jeweils gegen den aktuellen transaktionalen Graphen geprüft.

Für neue `depends_on`-Kanten ermittelt ein rekursiver SQL-CTE im Guard alle vom Ziel bereits erreichbaren Aufträge. Ist die Quelle erreichbar, wird die Kante abgelehnt. Der CTE verwendet `UNION` und kann dadurch auch bei unerwarteten vorhandenen Kreisen keine unendliche Traversierung erzeugen. Die Prüfung findet nicht nur vorab im Anwendungscode statt; zwei parallele Gegenkanten können daher nicht beide erfolgreich sein. Andere Beziehungstypen bleiben gerichtet, unterliegen aber keiner Abhängigkeits-DAG-Regel. Setzen oder Entfernen erhöht Quell- und Planrevision, jedoch niemals die Spezifikationsfassung.

## Verifikation

Die primäre Ebene sind echte D1-Integrationstests in `tests/worker/orders.test.ts`. Sie prüfen insbesondere parallele Nummern, konkurrierende Fassungsänderungen, eine unmittelbar vor Batchbeginn geänderte Statusvoraussetzung, alte Replay-Antworten und den Rollback bei künstlich fehlschlagender Ergebnisspeicherung. Placementprüfungen ergänzen konkurrierende Moves, atomare Gruppenreindexierung und erst vor Batchbeginn geschlossene Milestones. Graphprüfungen umfassen direkte/transitive Kreise, parallele Gegenkanten und eine unmittelbar vor dem Guard eingefügte Rückkante. Sämtliche Fixtures sind synthetisch. Browser-, MCP- und Deploymentverifikation werden bei ihrer jeweiligen Anbindung ergänzend durchgeführt.
