# Private Sicherung und Wiederherstellungsnachweis

Der lokale Helper `scripts/verify-recovery.mjs` stellt den ausdrücklich erfassten Rebuild-Datenumfang in einer **neuen** SQLite-Datei wieder her. Er verändert keine laufende D1, lädt nichts nach Preview/Produktion und schreibt keine R2-Objekte. Reale Betriebsdaten bleiben in privaten Sicherungsordnern außerhalb des öffentlichen Repositorys. Tests verwenden ausschließlich synthetische Daten.

## Genau erfasster Umfang

Alle folgenden26 Tabellen müssen im Snapshot vollständig vorhanden sein; leere Tabellen besitzen explizit `rows: []`:

- `project_ideas`, `idea_mutation_requests`, `luufi_mcp_probe_records`, `luufi_mcp_probe_writes`.
- `planning_projects`, `planning_milestones`, `planning_orders`, `planning_order_versions`, `planning_order_relations`, `planning_requests`.
- `feedback_threads`, `feedback_entries`, `feedback_attachments`, `feedback_refinements`, `feedback_order_sources`.
- `order_approvals`, `order_approval_items`, `order_executions`, `order_progress`, `order_lifecycle_events`, `order_evidence`.
- `project_versions`, `version_orders`, `version_builds`, `version_releases`, `bootstrap_provenance`.

Originalideen behalten sämtliche IDs, Texte, Details, Zeitwerte und Revisionen. Alle Replaydaten werden vollständig erfasst. Pending/expired-Medienplätze bleiben unvollständig; es wird keine fertige Datei erfunden. Für jeden ready-Anhang ist die tatsächlich referenzierte private Datei mit passendem Objektkey, Größe und SHA-256 erforderlich. Eine Auswahl ohne diese Bytes ist kein vollständiger Medien-Wiederherstellungsnachweis und wird abgelehnt.

Unveränderte Alt-Tabellenschemata entstehen durch die erhaltenen Migrationen, ihre früheren Daten werden **nicht** als Daten der neuen Anwendung wiederhergestellt: `mutation_operations`, `mutation_steps`, `project_snapshots`, `project_change_events`, `oauth_sessions`, `oauth_states` bleiben leer. Ausgeschlossen sind damit insbesondere alte OAuth-Zustände, verschlüsselte Zugangsdaten und Workflow-/Cacheinhalte. Auch interne D1-/Cloudflare-Metadaten sind keine App-Exporttabellen. Diesen Umfang nicht als vollständiges altes D1-Backup bezeichnen; ein gegebenenfalls zusätzliches Plattformbackup muss getrennt dokumentiert werden.

## Snapshotformat1

```json
{
  "format": "luufi-recovery",
  "version": 1,
  "environment": "production",
  "capturedAt": "2026-10-23T10:00:00.000Z",
  "migrations": [{ "name": "0000_supreme_harrier.sql", "sha256": "SHA256" }],
  "tables": {
    "project_ideas": { "rows": [], "rowCount": 0, "sha256": "SHA256" }
  },
  "attachments": [
    {
      "attachmentId": "ID",
      "objectKey": "INTERNER_PRIVATER_OBJEKTKEY",
      "relativePath": "media/datei.bin",
      "size": 100,
      "sha256": "SHA256"
    }
  ]
}
```

Das Beispiel ist nur ein Ausschnitt: Tatsächlich sind alle26 Tabellen und alle zehn aktuellen SQL-Migrationsdateien erforderlich. Umgebung ist `local`, `preview` oder `production`. Strings, sichere Ganzzahlen und null sind die einzigen erlaubten Rowwerte; Tabellen-/Spaltennamen sind exakt. Boolean-/Objekt-/Blobwerte, fehlende Spalten, unbekannte Tabellen oder Metadaten werden nicht still übersprungen. SQL-Werkzeuge zur Laufzeit entstehen dadurch nicht.

Die Migrationen sind mit ihren **unveränderten rohen Dateibytes** gehasht. Das Repository legt für `drizzle/*.sql` feste LF-Zeilenenden fest, damit Windows- und Linux-Checkouts dieselben Migrationshashes verwenden. Die private Sicherung enthält zusätzlich zum JSON-Manifest die exakt verwendeten SQL-Dateien mit diesen Bytes; diese nicht nachträglich normalisieren. Ein abweichender Checkout oder eine veränderte Migration darf keinen erfolgreichen Hashabgleich ergeben. Bei einem Restore aus den privat mitgesicherten Dateien lässt sich deren Ordner über `verifyRecovery({snapshotPath,targetPath,migrationDirectory})` explizit auswählen. Tabellenhashes beziehen sämtliche Spalten und Werte ein: Objektschlüssel werden sortiert, jede Zeile als JSON serialisiert, Zeilen lexikalisch sortiert, mit Newline verbunden und als UTF-8 per SHA-256 gehasht. Originale Stringinhalte werden nicht getrimmt oder normalisiert. Das exportierte `makeRecoverySnapshot` berechnet Format und Hashes; `recoveryTables` liefert die feste Liste.

## Reale Sicherung durch Codex

1. Umgebung und privaten Sicherungsordner ausdrücklich festlegen. Schema/Migrationen und Zahl der Einträge je erlaubter Tabelle über den vorhandenen autorisierten Sites-Zugang inventarisieren. Produktion und Preview getrennt halten; keine Produktionsdaten als Preview-Testdaten verwenden.
2. Jede Tabelle vollständig exportieren. Plattformpagination/Antwortlimits ausschöpfen, tatsächliche Quellanzahl mit exportierter Zeilenanzahl vergleichen und Trunkierung ausschließen. Der Helper prüft den gelieferten Snapshot; er kann ohne Quellzugang keine vom Exporter verschwiegene Seite erkennen. Den Quellvergleich deshalb separat protokollieren. Bei parallelen Mutationen für einen konsistenten Snapshot sorgen oder Export neu aufnehmen.
3. Jeden fertigen R2-Anhang über den geschützten Zugriff vollständig in den privaten Snapshotordner übernehmen. Größe und SHA mit D1 vergleichen. Relative Pfade bleiben innerhalb dieses Ordners, ohne Traversal oder Symlinkausbruch. Fehlende Medienbytes konkret benennen; nicht als vollständig gesichert ausgeben.
4. `makeRecoverySnapshot({environment, capturedAt, tables, attachments})` aus dem lokalen Helper mit den vollständigen privaten Rawrows aufrufen und das Ergebnis ausschließlich in diesem privaten Ordner speichern. Keine Dateien oder JSON-Rows in öffentlichen Commits beziehungsweise Chat-Ausgaben. Den SHA der Snapshotdatei separat als Betriebsbeleg festhalten.
5. Lokal den Restore in eine neue explizite Datei prüfen:

```text
node scripts/verify-recovery.mjs PRIVATER_ORDNER/snapshot.json PRIVATER_ORDNER/restore-neu.sqlite
```

Node22 mit `node:sqlite` ist erforderlich. Zielpfad und seine `-journal`-/`-wal`-/`-shm`-Sidecars dürfen nicht existieren, auch nicht als Symlinks. Der eigentliche Restore erfolgt ausschließlich in einem exklusiv neu erzeugten Stagingverzeichnis neben dem Ziel. SQLite öffnet niemals den finalen Zielpfad und kann deshalb dort auch parallel eintreffende Sidecars nicht verändern. Nach vollständig geprüftem Commit und Schließen der Datenbank werden Ziel und Sidecars erneut geprüft. Die geschlossene Datei wird per atomarem Hardlink veröffentlicht, der ein inzwischen bestehendes Ziel nicht ersetzt. Unterstützt das Dateisystem dies nicht, schlägt die Veröffentlichung sicher fehl.

Fehlercleanup entfernt ausschließlich die eigene Datei innerhalb des neuen Stagingverzeichnisses; Ziel und dessen Sidecars werden niemals entfernt oder überschrieben. Unerwartete Dateien im Stagingverzeichnis werden nicht rekursiv gelöscht. SQLite ist in diesem Node-Stand noch als experimentell gekennzeichnet; der tatsächliche Funktionstest prüft seine Verfügbarkeit.

## Was die Prüfung nachweist

Der Helper prüft Format/Allowlist, Anzahl und Hash sämtlicher Zeilen sowie alle Migrationsnamen/-hashes. Er wendet die echten unveränderten Migrationen an und schreibt vollständige Rows innerhalb einer Transaktion. Fremdschlüssel und zusätzliche Projekt-/Auftrags-/Versionsbezüge werden geprüft. Danach vergleicht er alle wieder gelesenen Werte einschließlich ihrer Typen und Hashes mit dem Snapshot. SQLite-Affinität darf keinen scheinbar passenden, tatsächlich veränderten Wert verschleiern. Ausgeschlossene Alt-Daten bleiben nachweislich leer.

Zusätzliche Referenzprüfungen schließen die schemafreien Verbindungen ein: aktuelle Auftragsfassung zur vollständigen Fassungshistorie, aktuelle Implementierungs-/Integrationszeiger zum passenden Auftrag und Nachweistyp, Versionsmitglieder zu ihren gespeicherten Fassungen und konkreten Implementierungs-/Integrationsbelegen, Versionsrelease zur selben Version und dessen `payload.buildId` zu einem vorhandenen Build genau dieser Version. Ein nichtleerer `payload.validationId` muss einen Kriteriennachweis desselben Auftrags, derselben Fassung, Bearbeitung und Claimgeneration referenzieren. Fehlende oder fremde Belege ergeben keinen erfolgreichen Restore. Dies prüft vorhandene gespeicherte Referenzen; externe Git-/Hostingfakten werden dadurch nicht erneut verifiziert.

Fertige Mediendateien werden vollständig auf Größe und SHA geprüft; nicht referenzierte oder fehlende Dateimanifeste werden abgelehnt. Der Test beweist die lokale Daten-/Dateiwiederherstellbarkeit des erfassten Snapshots. Er führt keinen tatsächlichen Upload in einen neuen R2-Bucket und keine Wiederinbetriebnahme einer Site durch. Beides verlangt einen gesondert nachvollzogenen autorisierten Betriebsablauf mit weiterhin getrennten Umgebungen. Rollback auf Altcode darf frühere GitHub-Schreibaktionen nicht reaktivieren.

Die Ausgabe enthält ausschließlich Ergebnis, Umgebung, Snapshot-SHA, Tabellen-/Zeilen-/Migrationsanzahlen, Zahl geprüfter Dateien und ausgeschlossene Alt-Tabellen. Originaltexte, Dateiinhalte, Objektkeys oder Geheimnisse werden nicht ausgegeben. Bei Fehler werden sichere Hinweise geliefert und kein Erfolg behauptet.

Der Koordinator führt die reale private Sicherung und diesen Restore separat durch und dokumentiert Ergebnis sowie Quellanzahlvergleich außerhalb des öffentlichen Repositories. Ohne diesen tatsächlichen Durchlauf behauptet diese Anleitung keinen bereits bestandenen Produktionsrestore. Der finale Produktionswechsel benötigt weiterhin ausdrückliche Release-Freigabe.

## Automatisierte Verifikation

`scripts/verify-recovery.test.ts` verwendet echte temporäre SQLite-Datenbanken mit allen Migrationen und synthetische Mediendateien. Geprüft werden exakte Texte/IDs/Zeitwerte/Replay, absichtlich ausgeschlossene alte Credentials, ready/pending-Dateistatus, Inhalts-/Anzahl-/Migrationsmismatch, strikte Schema-/Typgrenzen, Fremdschlüssel, bestehende Zieldateien, alle drei Sidecars einschließlich parallel während des Restores erzeugter Dateien, vollständige und bewusst unterbrochene Release-/Build-/Nachweis-/Fassungsketten, Medienhash/Referenz/Pfadfehler und eine CLI-Ausgabe ohne private Werte. Keine zusätzliche Coverage-Runde oder Netzwerkveröffentlichung.
