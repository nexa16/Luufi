# Projektideen: Datenmodell und Schnittstellen

Feature: `project-ideas`. Richtlinien: `implementation` 1.0.1, `documentation` 1.0.0 und `data-access` 1.0.1. Auftrag: LUUFI-3, Fassung 1.

Die unabhängige Sammlung benötigt kein Projekt. Browser-API und native MCP-Werkzeuge verwenden dieselben Services aus `lib/services/project-ideas.ts`. Sites authentifiziert den privaten Einzelnutzerzugang; Luufi verlangt zusätzlich für jede Serviceoperation eine nicht leere Identität. Direkter öffentlicher Workerzugriff außerhalb dieser Sites-Zugangsgrenze ist kein unterstützter Betriebsmodus.

## Persistenz und Invarianten

Health und nativer Kontext prüfen die benötigte Revisionsspalte und Replay-Tabelle ohne Inhaltsabruf. Vor Migration 0005 bleibt der Dienst ausdrücklich nicht bereit; eine bloß erreichbare alte Ideentabelle reicht nicht aus.

`project_ideas` behält die vorhandenen Spalten `id`, `idea_text`, `detail`, `created_at` unverändert. Migration 0005 ergänzt ausschließlich `revision INTEGER NOT NULL DEFAULT 0` und `idea_mutation_requests`. Lesen normalisiert keine gespeicherten Inhalte. Neue Eingaben werden außen getrimmt; Titel sind erforderlich und auf 280 Zeichen begrenzt, optionale Beschreibungen auf 4.000 Zeichen. Änderungen erhalten ID und Erstellungszeit und erhöhen die Revision um eins. Gleiche Titel sind zulässig. IDs werden zufällig vergeben und nie wiederverwendet.

Jede Mutation benötigt einen Wiederholungsschlüssel mit 1 bis 128 Zeichen aus Buchstaben, Ziffern, Punkt, Unterstrich, Doppelpunkt und Bindestrich. `updateProjectIdea` und `deleteProjectIdea` benötigen zusätzlich die bekannte nicht negative ganzzahlige Revision. Die SQL-Schreibbedingung prüft atomar Revision und Abwesenheit des Schlüssels. Änderung und dauerhafter Ergebnisbeleg laufen gemeinsam in einem transaktionalen D1-Batch. Scheitert der Beleg, wird auch die Änderung zurückgerollt. Gleichzeitige Änderungen derselben Revision können sich deshalb nicht überschreiben.

Das Ledger speichert Operation, Identität und normalisierte fachliche Eingabe sowie das ursprüngliche Ergebnis. Eine identische Wiederholung liefert dieses Ergebnis auch nach späteren Änderungen oder Löschung; sie stellt keine gelöschten Daten wieder her. Ein gleicher Schlüssel mit anderer Operation, Identität, Ziel-ID, Revision oder fachlichem Inhalt führt zum Konflikt ohne Datenänderung. Fehlgeschlagene Revisionen legen keinen Erfolgsbeleg an. Das Ledger darf im laufenden Betrieb nicht geleert werden, da sonst dauerhafte Wiederholungssicherheit entfällt.

Listen verwenden absteigend `created_at, id`, standardmäßig 25 Einträge und erlauben 1 bis 50. Der Cursor enthält das letzte Schlüsselpaar; neue jüngere Einträge verschieben nachfolgende Seiten nicht. Antworten enthalten `{items, nextCursor}`. Ein Cursor ist ein Seitenverweis und keine Berechtigung.

## Browser-API

Alle Antworten sind JSON mit `Cache-Control: no-store`. Sites-Identität ist immer erforderlich. Mutationen verlangen zusätzlich einen exakten gleichnamigen `Origin` und einen JSON-Körper mit höchstens 32 KiB tatsächlich gelesenen Bytes. Die Begrenzung gilt auch ohne oder mit irreführender Größenangabe.

| Methode und Pfad        | Eingabe                                                     | Erfolg                           |
| ----------------------- | ----------------------------------------------------------- | -------------------------------- |
| GET `/api/ideas`        | `limit`, `cursor` optional                                  | 200 `{items,nextCursor}`         |
| GET `/api/ideas/:id`    | ID                                                          | 200 `{idea}`                     |
| POST `/api/ideas`       | `text`, `detail` optional, `requestKey`                     | 201 `{idea}`                     |
| PATCH `/api/ideas/:id`  | `text`, `detail` optional, `expectedRevision`, `requestKey` | 200 `{idea}`                     |
| DELETE `/api/ideas/:id` | `expectedRevision`, `requestKey`                            | 200 `{id,deleted:true,revision}` |

Eine Idee enthält `id`, `text`, `detail`, `createdAt` als ISO-Zeit und `revision`. Fehler enthalten eine verständliche deutsche Meldung als `error` und einen stabilen `code`: 400 `validation`, 401 `unauthorized`, 403 `forbidden`, 404 `not_found`, 409 `conflict`, 503 `unavailable`. Datenbankdetails oder Geheimnisse werden nicht zurückgegeben. Konflikte verlangen Neuladen und Prüfung der Änderung; ein neuer Schlüssel umgeht keine Revisionsprüfung.

## Native MCP-Werkzeuge

`lib/mcp/ideas.ts` definiert fünf feste Werkzeuge. Sie sind in Vorschau und Produktion verfügbar. Es gibt kein allgemeines SQL-Werkzeug und keine Möglichkeit, Identität oder Datenbank im Werkzeugaufruf auszuwählen. `dispatchMcp` übernimmt ausschließlich die von Sites authentifizierte Identität in `deps.ownerId`; Inhalte von `_meta`, einschließlich angeblicher Eigentümer oder Benutzer, sind keine Autorisierung. Statische Discovery funktioniert ohne Benutzeridentität und ohne Datenbankzugriff, fachliche Aufrufe verlangen dagegen die native Identität.

| Werkzeug       | Argumente                                                         | Ergebnis                     |
| -------------- | ----------------------------------------------------------------- | ---------------------------- |
| `ideas_list`   | `limit`, `cursor` optional                                        | `{items,nextCursor}`         |
| `ideas_get`    | `id`                                                              | Projektidee                  |
| `ideas_create` | `text`, `detail` optional, `requestKey`                           | Projektidee                  |
| `ideas_update` | `id`, `text`, `detail` optional, `expectedRevision`, `requestKey` | Projektidee                  |
| `ideas_delete` | `id`, `expectedRevision`, `requestKey`                            | `{id,deleted:true,revision}` |

Die JSON-Schemas verbieten zusätzliche Argumente und begrenzen IDs, Texte, Revisionen, Wiederholungsschlüssel und Seitengrößen. Der Dispatcher prüft diese Grenzen vor dem Serviceaufruf; der gemeinsame Service prüft zusätzlich fachliche Regeln und atomare Persistenz. Das MCP-HTTP-Limit beträgt 16 KiB. Ergebnisse stehen als JSON im MCP-Textinhalt. Fachliche Fehler verwenden `isError: true` mit JSON `{code,error}` und denselben sicheren deutschen Meldungen und Fehlercodes wie der Service. Unbekannte interne Fehler werden als `unavailable` bereinigt. Eine Mutation besitzt `idempotentHint: true`; nur `ideas_delete` ist als destruktiv markiert.

## Verifikation

Domain-Tests prüfen Eingabegrenzen und deutsche Validierung. Worker-Tests verwenden echte migrierte D1 mit synthetischem Altbestand. Sie prüfen unveränderte gespeicherte Werte, CRUD, gleichzeitige Revisionen, Replay über spätere Löschung hinweg, Transaktionsrollback bei Ledgerfehler, stabile Pagination und Fehlerbereinigung. API-Tests prüfen denselben Servicepfad sowie Identität, Origin, Bytebegrenzung und HTTP-Verträge. `tests/worker/ideas-mcp.test.ts` führt vollständiges CRUD über `dispatchMcp` aus und prüft gefälschte Metadatenidentitäten, dauerhaften Replay, Revisionskonflikte, strikte Schemas, bereinigte Fehler und die Werkzeuglisten beider Umgebungen. Produktive Daten sind keine Fixtures. Migrationen und Sites-Zugangsgrenzen werden zusätzlich durch den Koordinator geprüft; lokale Tests ersetzen keinen nativen Plattformnachweis.
