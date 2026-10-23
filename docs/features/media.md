---
feature: media
documentation_policy: 1.0.0
---

# Private Feedback-Medien

## Zweck und Umfang

Feedback und Ergänzungen können private Bilder und Videos enthalten. Text und Dateiplätze werden zuerst gespeichert; ein fehlgeschlagener Upload löscht weder Text noch bereits fertige Dateien. Unterstützt sind JPEG, PNG, WebP sowie MP4, MOV und WebM. Bilder dürfen höchstens 10.000.000 Bytes, Videos 15.000.000 Bytes groß sein.

## Nutzerabläufe

Nach dem Speichern einer Eingabe lädt der Browser jede ausgewählte Datei in ihren vorhandenen Anhangplatz. Erst die erfolgreiche serverseitige Prüfung und Speicherung macht sie verfügbar. Ein erneuter Versuch verwendet den vorhandenen Platz und dessen aktuelle Revision. Nach dem Neuladen kann eine fehlende Datei erneut ausgewählt werden. Fertige Bilder, Videos und Downloads verwenden ausschließlich geschützte Luufi-Endpunkte.

## Regeln und Zustände

Ein Platz ist `pending`, nach erfolgreichem Upload `ready` oder nach Bereinigung `expired`. Fertige Bytes sind unveränderlich. Ein Upload muss zum deklarierten Format und zur genauen Dateigröße passen; der Server prüft zusätzlich die tatsächliche Containerstruktur. Die Dateinamen sind Anzeigenamen, keine Speicherpfade. Zugriff erfordert die persönliche Sites-Anmeldung und die Zuordnung zu Projekt und Feedback.

Jede neu fertiggestellte Datei erhöht die Feedback-Inhaltsrevision. Eine frühere Aufbereitung wird dadurch erneut als überarbeitungsbedürftig erkannt. Das bloße Ablaufen eines unvollständigen Platzes verändert den Inhalt nicht.

## Sonder- und Fehlerfälle

Technische Wiederholungen mit demselben Schlüssel und denselben Bytes liefern die ursprüngliche Antwort. Derselbe Schlüssel mit anderen Bytes und veraltete Revisionen führen zu Konflikten. Gleichzeitige Uploads können einen fertigen Anhang nicht ersetzen. Unterbrochene Schreibversuche werden nicht sichtbar; verwaiste private Objekte werden sofort nach Möglichkeit oder später begrenzt bereinigt.

Nach 24 Stunden können unvollständige Plätze ablaufen. Sie bleiben sichtbar und mit aktueller Revision erneut befüllbar. Fertige Dateien werden durch die Bereinigung nicht gelöscht. Ein fehlendes Speicherobjekt erzeugt einen vorübergehenden Fehler statt einer leeren Datei.

## Grenzen

Die Formatprüfung validiert Containerstrukturen, Signaturen, Längen und bei PNG Prüfsummen; sie decodiert keine Bild- oder Videocodecs. Ein Browser kann deshalb bei nicht unterstützten Codecs weiterhin einen Wiedergabefehler zeigen und den geschützten Download anbieten. Keine Konvertierung, Transkription, Malwareanalyse oder automatische inhaltliche Auswertung. Es gibt keine öffentlichen Objektlinks und kein allgemeines Dateispeicherwerkzeug.

## Technische Verweise

[Medienarchitektur](../technical/media.md), `lib/domain/media.ts`, `lib/services/media.ts`, `lib/http/media.ts` und der Attachment-API-Endpunkt.

## Verifikation

`lib/domain/media.test.ts` prüft unterstützte Container, fehlerhafte Signaturen, Längen, Prüfsummen und Größen. `tests/worker/media.test.ts` prüft echte D1-/R2-Grenzen, CAS, Wiederholung, parallele Uploads, fehlgeschlagene Schreibversuche, Ablauf und wiederholbare Bereinigung. `tests/worker/media-route.test.ts` prüft Zugriffsschutz, begrenzte Uploads, geschützte Downloads und Byte-Ranges.
