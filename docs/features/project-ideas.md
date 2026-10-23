---
feature: project-ideas
documentation_policy: 1.0.0
---

# Projektideen

## Zweck und Umfang

Die eigenständige Sammlung hält erste Projektgedanken fest, bevor ein Projekt existiert. Sie unterstützt Anlegen, Lesen, Bearbeiten und bestätigtes Löschen. Eine Idee besitzt keine Projektzuordnung und startet keine Umsetzung.

## Nutzerabläufe

Unter **Projektideen** öffnet sich die gespeicherte Sammlung. **Neue Idee** öffnet ein Formular mit Titel und optionalen Details. **Speichern** legt die Idee an und zeigt sie in der Sammlung. Weitere Seiten werden über **Weitere Ideen laden** ergänzt; **Aktualisieren** lädt die erste Seite neu.

**Bearbeiten** öffnet den vorhandenen Text. Speichern ändert dieselbe Idee; ihre Kennung und ihr Erstellungszeitpunkt bleiben erhalten. **Löschen** zeigt zuerst den Titel und eine ausdrückliche Bestätigung. **Abbrechen** erhält die Idee; erst **Endgültig löschen** entfernt sie.

## Regeln und Zustände

- Ein nicht leerer Titel ist erforderlich: höchstens 280 Zeichen. Optionale Details erlauben höchstens 4.000 Zeichen. Führende und abschließende Leerzeichen werden serverseitig entfernt.
- Gespeichert werden stabile Kennung, Titel, Details, ursprünglicher Erstellungszeitpunkt und Revision. Bearbeiten erhöht die Revision; Kennungen werden nicht wiederverwendet.
- Laden, leere Sammlung, Speichern, Löschen und Fehler sind sichtbar. Laufende Aktionen sperren ihre Eingaben und verhindern wiederholtes Absenden.
- Die private Site authentifiziert den Zugriff; die API prüft die zugelassene Identität. Anonymer Zugriff und Schreibzugriff allein mit einem Diensttoken sind ausgeschlossen.
- Desktop und Handy verwenden dieselben Abläufe. Ein natives modales Dialogfenster hält den Tastaturfokus im Formular. Escape beziehungsweise Schließen beendet einen ruhenden Dialog; eine laufende Speicherung oder Löschung lässt sich dadurch nicht unterbrechen.

## Sonder- und Fehlerfälle

Eine leere Sammlung erklärt den Einstieg. Bei Ladefehlern bleibt eine bereits geladene Liste sichtbar. **Erneut versuchen** wiederholt die fehlgeschlagene Seite am selben Cursor. Wiederholte IDs werden zusammengeführt; eine ältere Folgeseitenrevision überschreibt keinen neueren sichtbaren Stand.

Bei Speicherfehlern bleiben Titel und Details im Formular erhalten. Eine unveränderte technische Wiederholung verwendet denselben Wiederholungsschlüssel und erzeugt nach einer verlorenen Antwort keine doppelte Idee. Geänderter Inhalt erhält einen neuen Schlüssel. Fehler beim Löschen lassen die Bestätigung offen.

Änderungen und Löschungen verlangen die erwartete Revision. Ein Konflikt überschreibt keinen neueren Stand. **Aktuellen Stand laden** liest die Sammlung erneut. Beim Bearbeiten bleiben die eigenen Entwürfe erhalten; die Oberfläche zeigt den aktuellen fremden Titel und die Details zum Vergleich. Erst erneutes Speichern verwendet die neue Revision. Wurde die Idee inzwischen gelöscht, lässt sich der erhaltene Entwurf als neue Idee speichern. Beim Löschkonflikt zeigt die Bestätigung den aktuellen Titel; der Nutzer bestätigt die Löschung erneut. Ist die Idee bereits entfernt, schließt die Bestätigung.

## Grenzen

Entwürfe liegen nur im laufenden Browserfenster und werden beim Neuladen oder Verlassen der Seite nicht dauerhaft gesichert. Es gibt keine automatische Projektanlage, Auftragsumwandlung, KI-Verarbeitung, Anhänge, Suche oder Wiederherstellung gelöschter Ideen. Die Sammlung hat keine gemeinsame fachliche Zuordnung zu späterem Projektfeedback.

## Technische Verweise

- [`app/ideas/page.tsx`](../../app/ideas/page.tsx) bindet die Route ein; [`app/project-ideas.tsx`](../../app/project-ideas.tsx) enthält Sammlung, Dialoge, Cursor-Nachladen und Konfliktbehandlung.
- [`lib/domain/project-ideas.ts`](../../lib/domain/project-ideas.ts) definiert das Modell und die Eingabegrenzen.
- [`app/api/ideas/route.ts`](../../app/api/ideas/route.ts) und [`app/api/ideas/[id]/route.ts`](../../app/api/ideas/%5Bid%5D/route.ts) stellen die Browser-API bereit.
- [`lib/services/project-ideas.ts`](../../lib/services/project-ideas.ts) führt die fachlichen Operationen und die D1-Persistenz aus; [`lib/data/d1.ts`](../../lib/data/d1.ts) stellt die Datenbankverbindung bereit.

`GET /api/ideas?limit&cursor` liefert `{items, nextCursor}`. `POST /api/ideas` nimmt `{text, detail, requestKey}` entgegen. `PATCH /api/ideas/{id}` verwendet zusätzlich `expectedRevision`; `DELETE` nimmt `{expectedRevision, requestKey}` entgegen. Anlegen und Bearbeiten liefern `{idea}`, Löschen liefert `{deleted: true}`. Fehler besitzen `{error, code}`; HTTP 409 bezeichnet einen Revisions- oder Wiederholungskonflikt. Wiederholungsschlüssel werden serverseitig zusammen mit dem ursprünglichen Ergebnis gespeichert. Dieselbe Operation kann dadurch nach einer verlorenen Antwort erneut angefordert werden.

Die bestehende Tabelle `project_ideas` bleibt erhalten. Neue Metadaten und das Wiederholungsprotokoll ergänzen den bisherigen Datenbestand; bestehende IDs, Texte, Details und Erstellungszeitpunkte werden nicht inhaltlich migriert. Angewandte Migrationen bleiben unverändert.

## Verifikation

[`tests/ui/project-ideas.test.tsx`](../../tests/ui/project-ideas.test.tsx) prüft Nutzeraktionen, Entwurfserhalt, technische Wiederholung, Revisionskonflikte, Pagination, Ladefehler und Bestätigung vor dem Löschen. [`tests/e2e/ideas.spec.ts`](../../tests/e2e/ideas.spec.ts) prüft Anlegen, Neuladen, Bearbeiten und Löschen sowie echte konkurrierende Änderungen und eine nach tatsächlichem Speichern verlorene Antwort gegen die lokale D1-API auf Desktop und Handy. Die lokale Testidentität ist ausschließlich für den lokalen Entwicklungsserver vorgesehen; sie ersetzt keinen Zugriffs- oder Deploymentnachweis der privaten Sites-Umgebung.

Die automatisierten API-, Daten- und Migrationstests ergänzen die Oberflächenprüfungen. Eine Veröffentlichung und ihr Umgebungsnachweis sind separate Betriebsschritte; diese Featurebeschreibung behauptet keine Produktionsfreigabe.
