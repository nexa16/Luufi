---
feature: feedback
documentation_policy: 1.0.0
---

# Feedback zu bestehenden Projekten

## Zweck und Umfang

Feedback sammelt Originaltexte, datierte Ergänzungen und Medienplätze innerhalb eines registrierten Projekts. Es bleibt von der eigenständigen Sammlung Projektideen getrennt. Der gemeinsame Service speichert Rückmeldungen und dokumentierte Refinement-Ergebnisse; er führt keine Analyse aus und erzeugt keine Aufträge oder Implementierungsfreigaben.

## Nutzerabläufe

Ein authentifizierter Aufrufer wählt ein Projekt und speichert einen Text mit optionalen Medienplätzen. Die Antwort bestätigt den gespeicherten Thread und Originaleintrag. Weitere Texte und Medienplätze werden als neue datierte Einträge angehängt. Vorhandener Originaltext und ältere Ergänzungen bleiben unverändert. Medienplätze sind zunächst ausstehend; Upload, Formatprüfung und geschützter Dateizugriff gehören zum getrennten Mediendienst.

Codex hält ein Refinement mit gelesener Repository-Fassung, Richtlinienfassungen und Zusammenfassung fest. Als Ergebnis nennt es vorhandene projektinterne Aufträge, offene Fragen oder begründete Zurückstellungen beziehungsweise Verwerfungen. Ergebnisse dürfen kombiniert werden. Ein Auftrag kann aus mehreren Rückmeldungen entstehen; eine Rückmeldung kann mehrere Aufträge begründen. Die Quellen eines Auftrags sind getrennt paginiert abrufbar.

## Regeln und Zustände

- Feedback gehört dauerhaft zu genau einem Projekt. Original und Ergänzungen bleiben exakt erhalten, einschließlich äußerer Leerzeichen, Zeilenumbrüchen und Unicode-Zeichen. Texte umfassen höchstens 20.000 UTF-16-Codeeinheiten. Ohne sichtbaren Text ist mindestens ein Medienplatz erforderlich.
- Jeder Eintrag erlaubt höchstens zehn Medienplätze in Auswahlreihenfolge. Dateinamen sind höchstens 255 Zeichen lang und enthalten keine Steuerzeichen oder Pfadtrenner. Erlaubt sind JPEG, PNG, WebP, MP4, QuickTime und WebM. Die deklarierte Größe ist positiv und höchstens 10.000.000 Byte für Bilder beziehungsweise 15.000.000 Byte für Videos. Diese Angaben sind bis zur Prüfung beim Upload lediglich deklariert.
- Eine neue Rückmeldung beginnt mit Revision 0 und Inhaltsrevision 0. Jede Ergänzung erhöht beide genau einmal. Ein Refinement erhöht nur die allgemeine Revision und hält die konkrete Inhaltsrevision fest. Neue Ergänzungen oder vom Mediendienst bereitgestellte Medien machen erneutes Refinement erforderlich. Metadatenänderungen ohne neue Inhalte verändern die Inhaltsrevision nicht.
- Refinement benötigt einen vollständigen 40-stelligen Commit-SHA, nicht leere Dokumentations- und Planungsrichtlinienfassungen mit höchstens 32 Zeichen sowie eine Zusammenfassung mit höchstens 4.000 Zeichen. Bis zu 50 vorhandene Aufträge desselben Projekts und 50 offene Fragen mit je höchstens 2.000 Zeichen sind erlaubt. Entscheidungsgründe umfassen jeweils höchstens 4.000 Zeichen. Ohne Auftrag oder Frage ist mindestens ein nicht leerer Entscheidungsgrund erforderlich.
- Original und Ergänzungen sind nach Position sortiert. Refinements und Quellen sind nach Datum und ID sortiert. Die Feedbackliste zeigt zuletzt aktualisierte Threads zuerst und enthält eine Vorschau des Originaltexts, Eintragsanzahl und Medienanzahlen. Die Anzahl ausstehender Medien umfasst auch abgelaufene, erneut hochladbare Plätze.

## Sonder- und Fehlerfälle

Fehlende oder projektfremde Feedbackziele erscheinen als nicht gefunden. Veraltete Revisionen überschreiben keinen jüngeren Inhalt. Fehlende referenzierte Aufträge werden als nicht gefunden gemeldet; projektfremde Aufträge erzeugen einen Konflikt. Die Threadrevision und alle Auftragszuordnungen werden im atomaren Schreibguard erneut geprüft, damit gleichzeitig bereitgestellte Medien oder Ergänzungen kein scheinbar aktuelles Refinement erzeugen.

Wiederholungsschlüssel binden Actor, Operation und normalisierten Inhalt an die ursprüngliche vollständige Antwort. Originaltexte werden dabei nicht normalisiert. Identische Wiederholungen und parallele identische Aufrufe erzeugen keine doppelten Einträge oder Quellen; ihre Antworten bleiben auch nach späteren Änderungen verfügbar. Anderer Inhalt oder andere Identität mit demselben Schlüssel wird abgelehnt. Thread, Eintrag, Medienplätze, Refinement, Quellen und Receipt werden gemeinsam gespeichert oder vollständig zurückgerollt. Fehler geben keine internen Datenbankdetails aus.

Alle Listen sind paginiert. Cursor binden Projekt, Thread beziehungsweise Auftrag und den gelesenen Revisionsstand. Nach Änderungen oder einer Änderung während des Lesens wird ein Neustart verlangt. Die Feedbackliste lädt keine vollständigen Texte, Einträge oder Refinement-Historien.

## Grenzen

Dieser Service bietet keine Löschung, nachträgliche Textbearbeitung, automatische Analyse, Auftragsanlage oder Status-/Freigabeübergänge. Er lädt keine Bytes in R2 und stellt keine öffentlichen Dateilinks bereit. Medien-URLs zeigen ausschließlich auf geschützte relative Browser-Endpunkte. Browser- und native MCP-Adapter werden durch die Integrationsschicht bereitgestellt; das Bestehen der Serviceprüfungen ist kein Deploymentnachweis.

## Technische Verweise

[`lib/services/feedback.ts`](../../lib/services/feedback.ts) enthält Fachoperationen und Validierung. [`lib/domain/feedback.ts`](../../lib/domain/feedback.ts) und [`lib/services/feedback-sql.ts`](../../lib/services/feedback-sql.ts) definieren gemeinsame Modelle und Serialisierung. Migration [`0007_feedback.sql`](../../drizzle/0007_feedback.sql) ergänzt die getrennten Feedbacktabellen. [`docs/technical/feedback.md`](../technical/feedback.md) beschreibt Persistenz und Transaktionen.

## Verifikation

[`tests/worker/feedback.test.ts`](../../tests/worker/feedback.test.ts) arbeitet gegen echtes migriertes D1 mit synthetischen Projekten. Geprüft werden exakte Originaltexte, Text-/Mediengrenzen, getrennte Einträge, Slots und Reihenfolgen, Refinement-Ergebnisse und Inhaltsrevisionen, viele-zu-viele Quellen, Identität und Projektgrenzen, konkurrierende Schreibvorgänge, unveränderte Replay-Antworten, Rollback und paginierte konsistente Leseansichten. Lokal werden die betroffenen Tests ohne Coverage ausgeführt; Gesamtgrenzen prüft der finale CI-Lauf.

Verwendete zentrale Richtlinien: Dokumentation/Planung 1.0.0 und Implementierung/Datenzugriff 1.0.1, durch den Koordinator nativ gelesen. Dieser Stand behauptet kein Produktionsrelease.
