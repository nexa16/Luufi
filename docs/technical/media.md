# Private Medienpersistenz

Gelesene Richtlinien: Dokumentation 1.0.0, Implementierung 1.0.1 und Datenzugriff 1.0.1. Implementierungsbasis ist W4-Schema `0007_feedback.sql`; Schema und Cloudflare-Bindings werden gemeinsam integriert.

## Verantwortung und Datenfluss

`lib/domain/media.ts` prüft tatsächliche Dateistrukturen ohne zusätzliche Abhängigkeit: JPEG-Marker und Bild-/Scansegmente, PNG-Chunks samt CRC, WebP-RIFF-Bildchunks, MP4/MOV-Boxlängen mit Videohandler sowie WebM-EBML-Header, Videotrack und Cluster. Die Prüfung ist keine Codecdecodierung. Deklarierter MIME-Typ und exakte Bytezahl müssen mit der Datei übereinstimmen.

`lib/services/media.ts` ist die gemeinsame Geschäftslogik für Browser und MCP. `BUCKET` ist ein privates, umgebungsgetrenntes R2-Binding. Ein unveränderlicher, zufälliger Schlüssel je Uploadversuch enthält keine Benutzereingaben. Attachment-Antworten enthalten ausschließlich relative geschützte API-URLs.

Nach dem R2-Schreiben speichert eine atomare D1-Batchoperation Anhangstatus, verifizierten MIME-Typ, Größe, SHA-256, Anhangrevision, Feedbackrevision/Inhaltsrevision und ursprüngliches Wiederholungsergebnis. `planning_requests` bindet den Schlüssel an Akteur, Operation, IDs, erwartete Revision, Bytezahl und Hash. Ein konkurrierender identischer Versuch erhält dieselbe Antwort. Ein anderer Versuch verliert die CAS-Prüfung. Verlierer löschen ausschließlich ihr eigenes Objekt; vor einer Löschung wird auch bei mehrdeutigem D1-Ergebnis auf eine fertige Referenz geprüft. Bei Speicherausfällen übernimmt die spätere Bereinigung.

Der Upload-CAS erlaubt nur Versuche, die jünger als 24 Stunden sind. Dadurch kann ein alter, unterbrochener Upload nach der Orphan-Bereinigung kein gelöschtes Objekt als fertig referenzieren. Fertige Objekte werden niemals ersetzt.

## Browservertrag

`GET` und `PUT /api/projects/:projectId/feedback/:feedbackId/attachments/:attachmentId` prüfen Sites-Identität und vollständige Projekt-/Feedback-Zuordnung. PUT verlangt zusätzlich exakten Origin, `Content-Type`, `X-Luufi-Revision` und `X-Luufi-Request-Key`. Der Body wird stückweise bis zur deklarierten Größe beziehungsweise maximal 15.000.000 Bytes eingelesen, nicht unbegrenzt gepuffert. Die Dateiformatprüfung geschieht vor dem R2-Schreiben.

GET streamt direkt aus R2 und unterstützt einzelne `Range: bytes=start-end`, offene Enden und Suffixbereiche. Ungültige oder mehrfache Bereiche erhalten 416 mit `Content-Range: bytes */size`. Erfolgreiche Bereiche erhalten 206, korrekte Länge und `Content-Range`. `?download=1` setzt `attachment`; sonst wird `inline` verwendet. MIME-Typ ist serververifiziert, Namen werden RFC-5987-kodiert, Antworten sind `no-store` und `nosniff`. Fehler sind sichere deutsche JSON-Antworten ohne Bucketkeys oder Blobinhalt.

## Begrenzter MCP-Zugriff

`getAttachment` liefert Metadaten. `readAttachment` akzeptiert Offset und Länge zwischen 1 und 65.536 Bytes und liefert Base64, tatsächliche Chunklänge, Gesamtgröße, vollständigen SHA-256 und dieselben Metadaten. Der letzte Chunk wird an der Dateigrenze gekürzt; Offset außerhalb der Datei wird abgelehnt. Abruf ist kein Nachweis einer inhaltlichen Medienauswertung. Die MCP-Werkzeughülle wird gemeinsam im Dispatcher integriert.

## Bereinigung und Wiederherstellung

`cleanupAttachments(actor, limit, requestKey)` bearbeitet höchstens 50 abgelaufene Plätze und scannt höchstens 50 R2-Objekte pro Aufruf. Die Frist beträgt 24 Stunden. Ablauf erhöht jede betroffene Anhangrevision und die Feedbackrevision je Platz, ohne Inhaltsrevision zu verändern. Ein abgelaufener Platz bleibt wiederholbar befüllbar.

Der Cleanup-Receipt speichert intern Scanfortschritt und einen begrenzten Löschplan. Nach dem letzten Scan beginnt der nächste Aufruf erneut vorn. Alte Objekte werden nur ohne fertige D1-Referenz gelöscht; eine neue Referenz wird unmittelbar vor der Löschung erneut ausgeschlossen. Bei partiellen R2-Ausfällen führt derselbe Schlüssel den gespeicherten Löschplan erneut aus. Die öffentliche Antwort enthält nur `expired` und `deletedOrphans`, keine internen Objektlisten. Ein erfolgreicher wiederholter Aufruf liefert die ursprünglichen Zählwerte, keine erneute Zustandsänderung. Unterschiedliche Cleanup-Schlüssel dürfen bereits bearbeitete Objekte erneut prüfen; Löschung bleibt idempotent.

Schema und Bindings werden nie zwischen Preview und Produktion geteilt. Es gibt keine öffentliche R2-Route, freie Bucketbrowse-Funktion, beliebige Schlüsselwahl oder SQL-Schnittstelle. Konfiguration erfolgt ausschließlich durch das jeweilige private Umgebungsbinding.

## Verifikation

Die fokussierten Unit-, D1-/R2- und HTTP-Tests liegen unter `lib/domain/media.test.ts`, `tests/worker/media.test.ts` und `tests/worker/media-route.test.ts`. Sie verwenden ausschließlich synthetische Daten, echte Worker-Testbindings und gezielte Ausfallinjektion an Speichergrenzen. Typprüfung gehört zur Integration; Coverage läuft einmal im finalen CI-Gate.
