---
feature: orders
documentation_policy: 1.0.0
---

# Aufträge

## Zweck und Umfang

Aufträge halten ein konkretes Vorhaben innerhalb eines Projekts fest. Der Auftragskern erstellt und liest Entwürfe und versioniert ihre Spezifikationen. Er startet keine Implementierung und nimmt keine Freigabe vor. Die Kennung besteht aus dauerhaftem Projektkürzel und atomar vergebener Nummer, beispielsweise `APP-12`.

## Nutzerabläufe

Codex erfasst einen Entwurf mit Typ, Titel, Ziel und Herkunft. Er erhält die dauerhafte Kennung, den vollständigen Spezifikationsstand und eine erste historische Fassung. Offene Spezifikationspunkte dürfen leer bleiben. Eine Entwurfsänderung speichert eine neue Fassung; die bisherigen Fassungen bleiben lesbar. Die Liste kann nach Typ, Zustand und Milestone-Zuordnung gefiltert und seitenweise gelesen werden. Ein einzelner Auftrag enthält immer die aktuelle Spezifikation, aufsteigende Fassungshistorie und seine gespeicherten Beziehungen.

Codex kann einen Entwurf oder bereit gestellten Auftrag in einen offenen Milestone einordnen oder ungeplant halten. Ein Ankerauftrag bestimmt die Einfügestelle; ohne Anker wird am Ende der Zielgruppe angefügt. Beziehungen verknüpfen zwei unterschiedliche Aufträge desselben Projekts gerichtet als abhängig von, verwandt mit, entstanden aus oder ersetzt. Bestehende Beziehungen können ausdrücklich entfernt werden.

## Regeln und Zustände

Erlaubte Typen sind Feature, Verbesserung, Fehlerbehebung und technische Arbeit. Neue Aufträge sind ungeplante Entwürfe. Nur im Entwurfszustand darf die Spezifikation geändert werden; spätere Zustände werden nicht durch diesen Service gesetzt. Jede Änderung benötigt die bekannte Revision. Typänderungen gehören ebenfalls zu einer neuen Spezifikationsfassung. Auch eine inhaltlich identische ausdrückliche Speicherung kann eine neue Fassung erzeugen.

Titel sind erforderlich und auf 280 Zeichen begrenzt. Ziel und Herkunft sind erforderlich und dürfen jeweils höchstens 4.000 Zeichen enthalten. Die weiteren Textfelder erlauben jeweils 4.000 Zeichen. Bis zu 50 Akzeptanzkriterien besitzen eindeutige stabile Kennungen mit höchstens 64 Zeichen und einen Text mit höchstens 1.000 Zeichen. Es gibt höchstens 50 Quellen mit jeweils höchstens 1.000 Zeichen. Der Repository-Kontext enthält einen vollständigen 40-stelligen Commit-SHA oder einen leeren Wert; die Richtlinienfassung hat höchstens 32 Zeichen.

Nummern werden pro Projekt atomar aus einem monotonen Zähler vergeben und nie neu vergeben. Die Registrierung des Luufi-Bootstrapprojekts reserviert den bereits vergebenen Bereich. Ein Wiederholungsschlüssel bindet Identität, Operation und normalisierte Eingabe an die ursprüngliche vollständige Antwort. Replay liefert auch nach späteren Änderungen diese frühere Antwort, ohne den aktuellen Stand zurückzusetzen.

Platzierung prüft sowohl die Auftragsrevision als auch die bekannte Planrevision. Eine Änderung ordnet beide betroffenen Gruppen lückenlos neu, ohne Spezifikation oder Fassungshistorie zu ändern. Laufende, implementierte, erledigte und archivierte Quellaufträge sind für diese Planungsänderungen gesperrt. Geschlossene Quell- und Zielmilestones sind ebenfalls gesperrt. Beziehungen erhöhen die Quellrevision und Planrevision, verändern jedoch keine Spezifikationsfassung. Abhängigkeiten dürfen auch transitiv keinen Kreis bilden; andere Beziehungstypen sind von dieser Abhängigkeitsregel unabhängig. Doppelte Kanten werden nicht stillschweigend angelegt und fehlende Kanten nicht als erfolgreich entfernt gemeldet.

## Sonder- und Fehlerfälle

Eine leere Projektliste ist ein erfolgreiches leeres Ergebnis. Ein fehlendes Projekt oder ein nicht zu diesem Projekt gehörender Auftrag wird als nicht gefunden gemeldet. Eine veraltete Revision überschreibt keinen neueren Stand. Derselbe Wiederholungsschlüssel mit anderem Inhalt führt zum Konflikt. Wenn die Speicherung des Wiederholungsbelegs fehlschlägt, werden Spezifikation, Zähler und Planrevision vollständig zurückgerollt.

Ein Platzierungsanker muss zur Zielgruppe gehören und darf nicht der bewegte Auftrag selbst sein. Fremde Projekte, geschlossene Milestones, veraltete Pläne oder neue Abhängigkeitskreise erzeugen einen Konflikt. Auch gleichzeitig angelegte Gegenkanten dürfen keinen Kreis erzeugen. Ein fehlender Zielauftrag oder eine fehlende zu entfernende Beziehung wird als nicht gefunden gemeldet. Die alten Erfolgsantworten von Platzierung und Beziehungen bleiben über Replay verfügbar, auch nachdem der Plan weiter geändert wurde. Schließt ein identischer paralleler Aufruf nach der ersten Belegprüfung ab, wird dessen gespeicherte Antwort auch vor einer sonst fehlgeschlagenen Vorprüfung erneut gelesen.

Seitencursor sind an Projekt, Filter und Planrevision gebunden. Nach einer gleichzeitigen Inhalts- oder Reihenfolgeänderung verlangt der Service einen Neubeginn der Liste, statt Einträge unbemerkt auszulassen. Interne Datenbankfehler erscheinen als bereinigte deutsche Fehlermeldung.

## Grenzen

Dieser Auftragskern führt keine Statusübergänge, Freigaben, Fortschrittsbearbeitung oder automatisierte Implementierung aus. Historische Spezifikationen können nicht geändert oder gelöscht werden. Registrierung und browserseitige Darstellungen werden separat angebunden; die dokumentierten Services setzen die private Sites-Zugangsgrenze voraus.

## Technische Verweise

[`lib/services/orders.ts`](../../lib/services/orders.ts) enthält die gemeinsamen Auftragsoperationen. [`lib/domain/planning.ts`](../../lib/domain/planning.ts) definiert aktuelle Spezifikationen, Historie und Filter. [`docs/technical/orders.md`](../technical/orders.md) beschreibt die Transaktions- und Fehlerverträge. Migration `0006_planning.sql` ergänzt getrennte Planungstabellen und verändert bestehende Projektideen nicht.

## Verifikation

[`tests/worker/orders.test.ts`](../../tests/worker/orders.test.ts) prüft mit synthetischen Projekten gegen echte migrierte D1: atomare parallele Nummernvergabe, langlebigen Replay, historische Spezifikationen, konkurrierende Revisionen, Statussperren unter atomarem Guard, gefilterte Listen, veraltete Cursor und vollständigen Rollback bei Belegfehlern. Weitere Fälle prüfen Gruppenwechsel, Reihenfolgeanker, geschlossene Milestones, parallel konkurrierende Platzierungen, unveränderte Spezifikationshistorie, gerichtete Beziehungen, fehlende Kanten und direkt, transitiv oder gleichzeitig entstehende Abhängigkeitskreise. Die Tests verwenden keine produktiven Daten und ersetzen keine Deploymentprüfung.
