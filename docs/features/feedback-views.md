---
feature: feedback-views
documentation_policy: 1.0.0
---

# Projektfeedback erfassen und lesen

## Zweck und Umfang

Die deutsche Feedbackoberfläche hält Beobachtungen zu einem vorhandenen Projekt fest. Originale, datierte Ergänzungen, Anhänge und dokumentierte Refinementergebnisse bleiben nachvollziehbar. Die Texte werden vor Dateiübertragungen gespeichert, damit ein fehlgeschlagener Upload die Eingabe nicht verliert.

## Nutzerabläufe

Im Projekt öffnet **Feedback** die Sammlung und die Eingabe **Neues Projektfeedback**. Ein Text oder mindestens eine Datei genügt. **Feedback speichern** speichert Text und reservierte Anhangeslots. Erst die bestätigte Speicherung startet die Dateiübertragung. **Text gespeichert** bleibt auch bei fehlgeschlagenen Dateien sichtbar. **Gespeichertes Feedback öffnen** führt zum dauerhaft gespeicherten Eintrag.

Die servergerenderte Eingabe bleibt zunächst deaktiviert. Textfeld, Dateiauswahl und Speichern werden erst aktiv, sobald die Browser-Hydration ihre Ereignishandler bereitgestellt hat. Dadurch nimmt die Oberfläche vor ihrer Initialisierung keine scheinbar gespeicherten Eingaben entgegen.

Die Detailansicht zeigt **Originalfeedback** und spätere **Ergänzungen** jeweils mit ihrem Datum. **Ergänzung speichern** fügt eine neue Eingabe hinzu. Gespeicherte Texte besitzen keine Bearbeitungsaktion. Die Liste und die Detailbereiche für Eingaben und Refinements haben unabhängiges **Weitere laden**. **Aktualisieren** liest die Feedbacksammlung neu.

Jeder unfertige Anhang zeigt seinen Zustand. Während des Uploads zeigt ein Fortschrittsbalken die tatsächlich übertragenen Bytes. Nach vollständiger Übertragung steht bis zur Serverbestätigung **Serverprüfung läuft**. Ein fehlgeschlagener Versuch lässt sich mit **Datei übertragen** wiederholen. Nach Neuladen muss die lokale Datei über **Datei erneut auswählen** zum bestehenden Slot angegeben werden. Eine erneute Textspeicherung ist dafür nicht nötig.

Fertige Bilder erscheinen inline. Videos besitzen die Wiedergabesteuerung des Browsers. Alle Dateien bieten **Datei herunterladen**; bei nicht verfügbarer oder nicht unterstützter Vorschau erscheint ein ausdrücklicher Downloadhinweis.

**Refinementergebnisse** zeigt gespeicherte Zusammenfassungen, die konkrete Eingaberevision, Repository-Commit, Richtlinienversionen und verknüpfte Aufträge, offene Fragen oder begründete Zurückstellung beziehungsweise Verwerfung. Die Auftragsansicht kann über **Feedbackquellen** die ursprünglichen Feedbacks und die jeweilige Eingaberevision öffnen. Das Anzeigen löst keine Analyse aus.

## Regeln und Zustände

Jede Originaleingabe und jede Ergänzung enthält höchstens 20.000 Zeichen und zehn Dateien. Die Speicherung erhält Leerzeichen und Zeilenumbrüche. Ohne Text ist mindestens eine Datei erforderlich. JPEG, PNG und WebP sind bis 10.000.000 Bytes erlaubt; MP4, MOV und WebM bis 15.000.000 Bytes je Datei. Die Auswahl prüft Namen, deklarierten Typ und Größe vor dem Speichern. Die tatsächliche Formatprüfung übernimmt der Server.

**Unvollständig** bezeichnet einen reservierten, noch nicht erfolgreich abgeschlossenen Anhang. Ein abgelaufener Upload bleibt sichtbar und kann mit aktueller Revision erneut übertragen werden. **Gespeichert und geprüft** erscheint nach der serverseitigen Bestätigung. Fertige Anhänge werden nicht überschrieben. Eine erneut ausgewählte Datei muss zum reservierten Namen, Typ und zur Größe passen.

**Refinement erforderlich** zeigt an, dass kein Refinement für den aktuellen Eingabestand gespeichert ist. Neue Ergänzungen oder fertiggestellte Medien können diesen Bedarf erneut auslösen. Ein Refinement ist keine Implementierungsfreigabe.

## Sonder- und Fehlerfälle

Ein fehlgeschlagener oder ungewisser Textaufruf erhält bei unveränderter Eingabe denselben Wiederholungsschlüssel. Geänderter Text oder eine geänderte Dateiliste erhält einen neuen Schlüssel. Bei einer Revisionskollision wird der aktuelle Feedbackstand gelesen, die eingegebene Ergänzung bleibt erhalten.

Ein technischer Uploadretry verwendet denselben Versuchsschlüssel und dieselbe erwartete Anhangsrevision. Nach einem Konflikt liest die Oberfläche die Anhangsmetadaten über die paginierten Eingaben neu. Eine inzwischen fertige Datei bleibt erhalten; ein unfertiger Slot kann mit aktualisierter Revision und einem neuen Versuch erneut übertragen werden. Bereits fertige Dateien bleiben bei Fehlern anderer Anhänge sichtbar.

Während einer laufenden Uploadqueue oder Einzelübertragung sind weitere Übertragungsstarts und das Öffnen einer neuen Eingabe gesperrt. Eine wartende Datei lässt sich nicht manuell an der seriellen Queue vorbeistarten. Eine gerade gespeicherte Ergänzung erscheint während der Übertragung nur einmal im Bestätigungsbereich; danach gehört sie zur normalen Eingabeliste. Nach Abschluss oder Fehlschlagen der Queue sind neue Eingaben wieder möglich. Ein Projektwechsel verwirft die lokale Eingabe des alten Projekts und übernimmt keine verspätete Speicherantwort in den neuen Projektkontext.

Beim Verlassen einer Ansicht werden ihre laufenden Abrufe und Dateiübertragungen abgebrochen. Der gespeicherte Text und serverseitig fertiggestellte Medien bleiben erhalten. Der Browser hält ausgewählte `File`-Objekte nur innerhalb der laufenden Ansicht; nach Neuladen ist eine erneute Auswahl erforderlich. Es gibt keine behauptete automatische Fortsetzung im Hintergrund.

Fehler einzelner Listenbereiche besitzen eigene Wiederholungen. Ein veralteter Cursor startet beim Wiederholen auf der ersten Seite. Alte Projektantworten dürfen eine neu geöffnete Ansicht nicht ersetzen. Texte, Quellen und Dateinamen werden als Text dargestellt. Leere Sammlungen und noch nicht dokumentierte Refinements werden ausdrücklich benannt.

## Grenzen

Die Oberfläche verändert keine Originale und löscht keine Feedbacks. Sie führt keine automatische KI-Analyse, Transkription, Dateikonvertierung, Auftragsanlage oder Implementierungsfreigabe aus. Gespeicherte Refinementergebnisse sind lesbar; ihre Verwaltung erfolgt außerhalb dieser Browseransichten. Die Browserunterstützung bestimmt, ob ein Video inline abgespielt werden kann. Für Originalvideos ohne mitgelieferte Untertitel wird keine künstliche Untertitelspur erzeugt.

## Technische Verweise

[`app/feedback.tsx`](../../app/feedback.tsx) enthält Sammlung, Detail, Eingabe, seriellen XHR-Upload und den exportierten Bereich `OrderFeedbackSources`. Die Seiten unter [`app/projects/[projectId]/feedback`](../../app/projects/%5BprojectId%5D/feedback/page.tsx) binden sie ein. [`components/project-frame.tsx`](../../components/project-frame.tsx) stellt Projektframe und Navigation bereit. Die gemeinsamen Datenformen stehen in [`lib/domain/feedback.ts`](../../lib/domain/feedback.ts).

Die Browseroberfläche verwendet `GET/POST /api/projects/{projectId}/feedback`, `GET /api/projects/{projectId}/feedback/{feedbackId}`, `GET/POST .../{feedbackId}/entries`, `GET .../{feedbackId}/refinements` und `GET /api/projects/{projectId}/orders/{orderId}/feedback-sources`. Listen liefern `{items, nextCursor}`; Schreibaufrufe speichern Text und reservierte Dateimetadaten mit Wiederholungsschlüssel. Ergänzungen senden die erwartete Feedbackrevision. Fehler liefern `{code, error}`.

Binäre Uploads verwenden `PUT .../{feedbackId}/attachments/{attachmentId}` mit `X-Luufi-Revision`, `X-Luufi-Request-Key` und deklariertem `Content-Type`. `XMLHttpRequest.upload` liefert den Bytefortschritt. Medien werden ausschließlich über dieselben geschützten relativen Browserendpunkte gelesen, Downloads mit `?download=1`. Die Oberfläche verwendet keine öffentlichen R2-Links oder Image-Proxys. Serverautorisierung, Content-Type, Range, Größen-/Inhaltsprüfung und Speicherkonsistenz liegen bei den fachlichen Diensten.

## Verifikation

[`tests/ui/feedback.test.tsx`](../../tests/ui/feedback.test.tsx) prüft Textreplay, Originale und Ergänzungen, serielle Uploads, Bytefortschritt gegenüber Speicherbestätigung, Netzfehlerretry, Dateiauswahl für vorhandene Slots, Konfliktauflösung ohne Überschreiben fertiger Medien, geschützte Vorschau und Downloadfallback sowie paginierte Refinements und Auftragsquellen.

[`tests/e2e/feedback.spec.ts`](../../tests/e2e/feedback.spec.ts) beschreibt den echten lokalen D1/R2-Ablauf auf Desktop und Handy: Original samt Datei speichern, eine Übertragung gezielt unterbrechen, den Text nach Neuladen wiederfinden, den vorhandenen Slot erneut übertragen und eine Ergänzung ohne Veränderung des Originals lesen. Alle Eingaben sind synthetische Testdaten. Ein lokaler Prüflauf ist kein Produktions- oder Veröffentlichungsnachweis.
