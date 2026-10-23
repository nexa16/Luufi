# Planungskern

Migration0006 ergänzt ausschließlich neue planning_-Tabellen. Alte Migrationen, Tabellen und Projektideen bleiben erhalten. Projektstammdaten und Planungsrevision sind getrennt. Atomare Auftragszähler gehören zum Projekt; sie werden niemals aus MAX(number)+1 außerhalb einer Transaktion abgeleitet.

`planning-store.ts` kapselt D1-Fehler und liefert deutsche, sichere Fehler mit validation/unauthorized/not_found/conflict/unavailable. `planningMutation` beansprucht einen Wiederholungsschlüssel nur bei erfülltem SQL-Guard. Alle folgenden Schreibschritte sind an diesen noch offenen Beleg gebunden. Ergebnis und Änderungen werden in derselben D1-Batchtransaktion gespeichert; ein fehlendes Ergebnis oder fehlgeschlagener Beleg rollt die gesamte Transaktion zurück.

Der dauerhafte Beleg bindet Akteur, Operation, normalisierten Inhalt und ursprüngliches Ergebnis. Ein Wiederholungsaufruf liefert dieses Ergebnis und überschreibt keine spätere Fassung. Derselbe Schlüssel mit anderem Inhalt wird abgewiesen. Zustandsabhängige Services lesen einen vorhandenen Beleg vor ihren aktuellen Voraussetzungen und prüfen diese zusätzlich atomar im Guard. Schemas und Discovery sind statisch, kein allgemeines SQL-Werkzeug wird bereitgestellt.

`planningAttempt` prüft vor veränderlichen Voraussetzungen den Beleg und liest ihn bei einem anschließenden conflict/not_found erneut. Damit erhält auch ein paralleler identischer Request die ursprüngliche Antwort, wenn der andere Aufruf zwischen dem ersten Lesen und der Vorprüfung erfolgreich gespeichert hat. Ohne passenden Beleg bleibt der tatsächliche Konflikt erhalten.

`projects_list/get/register/update` bilden die MCP-Stammdatenoberfläche. Registrierung akzeptiert key/name/repository und optionale Branches, documentationPaths/deploymentHints. Update benötigt id/expectedRevision/requestKey sowie name/repository ohne key. Ausgelassene optionale Konfigurationsfelder bleiben erhalten; ausdrücklich übergebene Werte ersetzen sie. Replay bindet diese normalisierte Änderungsabsicht vor dem aktuellen Lesen. Browser-GET `/api/projects` und `/api/projects/:projectId` verwenden dieselben Services, Sites-Identität und no-store. Schreibmethoden sind im Browser nicht implementiert.

Seiten enthalten items/nextCursor. Seitengröße1–50, Standard25. Cursor sind an Filter und Revision gebunden und stellen keine Autorisierung dar. Bei einer zwischenzeitlichen Planänderung muss der Leser die Liste neu beginnen. Projektlisten prüfen Revision und Zeilen in einer gemeinsamen lesenden D1-Batchtransaktion. Keine Rohdatenbankfehler oder Zugangsdaten in Antworten.

Die vollständige Planung liegt in D1; Preview und Produktion besitzen getrennte Bindings. Lokale Browserdaten sind ausdrücklich synthetisch und werden ausschließlich mit `--local` in der isolierten E2E-Datenbank angelegt. Es werden keine Produktionsdaten kopiert.
