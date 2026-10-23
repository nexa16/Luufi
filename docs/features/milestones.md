---
feature: milestones
documentation_policy: 1.0.0
---

# Milestones planen

## Zweck und Umfang

Milestones gliedern die Planung eines registrierten Projekts in eine ausdrückliche Reihenfolge. Der gemeinsame Service erlaubt Lesen, Anlegen, Beschreiben und Verschieben. Leere Projekte besitzen eine leere Milestone-Liste; das Anlegen eines Milestones ist keine Implementierungsfreigabe.

## Nutzerabläufe

Ein angemeldeter Aufrufer wählt ein registriertes Projekt und liest dessen Milestones in gespeicherter Reihenfolge. Neue Milestones werden am Ende angelegt. Titel und Beschreibung lassen sich mit der erwarteten Inhaltsrevision bearbeiten. Verschieben nennt einen Milestone desselben Projekts als Anker; `beforeId: null` bedeutet ans Ende. Der erste offene Eintrag der vollständigen Reihenfolge ist der nächste Milestone.

Die Funktionen sind gemeinsame fachliche Services. Die zugehörigen Browser- und MCP-Adapter werden separat integriert; dieser Service bietet selbst keine neue Bearbeitungsoberfläche an.

## Regeln und Zustände

- Jeder Milestone gehört dauerhaft zu genau einem Projekt und besitzt eine stabile ID, einen Titel, eine Beschreibung, einen Zustand, eine ganzzahlige Position und eine Revision.
- Der Titel ist erforderlich und höchstens 280 Zeichen lang. Die optionale Beschreibung umfasst höchstens 4.000 Zeichen. Äußere Leerzeichen werden entfernt. Weitere Eingabefelder, darunter Benutzeridentität und Zustand, werden abgelehnt.
- Anlegen erzeugt einen offenen Milestone mit Revision 0. Es schließt weder leere noch befüllte Milestones automatisch.
- Geschlossene Milestones können nicht direkt bearbeitet oder verschoben werden. Technisches Reindizieren offener Nachbarn darf ihre Position ändern, ohne ihre Inhaltsrevision zu erhöhen.
- Eine Inhaltsänderung erhöht die Milestone-Revision. Ein Verschieben erhöht ausschließlich die Revision des ausdrücklich verschobenen Ziels; alle Positionen werden lückenlos neu indiziert.
- Jede erfolgreiche Mutation erhöht die projektweite Planungsrevision genau einmal. Verschieben prüft die erwartete Planungsrevision, Bearbeiten die erwartete Milestone-Revision.
- Alle Funktionen verlangen einen authentifizierten Actor aus dem vertrauenswürdigen Adapter. Eingaben können diese Identität nicht überschreiben.

## Sonder- und Fehlerfälle

Fehlende Projekte oder Ziel-Milestones führen zu `not_found`. Projektfremde oder fehlende Anker, Selbstverschiebung, geschlossene Ziele und veraltete Revisionen führen zu einem Konflikt. Die Voraussetzungen werden nochmals innerhalb derselben D1-Transaktion geprüft; eine zwischenzeitliche Änderung überschreibt keinen jüngeren Stand.

Ein Wiederholungsschlüssel bindet Actor, Operation und normalisierten Inhalt. Derselbe Aufruf liefert dauerhaft sein ursprüngliches vollständiges Ergebnis, auch wenn der Milestone später bearbeitet oder verschoben wurde. Das gilt auch, wenn ein paralleler identischer Aufruf zwischen der ersten Belegprüfung und einer veränderlichen Vorprüfung abschließt. Ein anderer Inhalt, Actor oder Operation mit demselben Schlüssel wird abgelehnt. Änderungen und Wiederholungsbeleg werden gemeinsam gespeichert; schlägt der Beleg fehl, werden auch Inhalte, Positionen und Planungsrevision zurückgerollt.

Listen sind paginiert und an Projekt und Planungsrevision gebunden. Ändert sich die Planung zwischen Seiten oder während eines Leseaufrufs, wird ein Konflikt gemeldet, statt eine unvollständige Fortsetzung auszugeben. Fehler enthalten keine internen Datenbankdetails.

## Grenzen

Dieser Umfang enthält keine Löschung, Freigaben, Termine, Prioritäten, Implementierungssteuerung oder Schließfunktion. Auftragszuordnung und spätere Lebenszyklusübergänge sind eigene Verantwortungen. Die Browseroberfläche verwaltet Milestones in dieser Stufe nicht.

## Technische Verweise

- [`lib/services/milestones.ts`](../../lib/services/milestones.ts): fachliche Operationen und atomare Guards.
- [`lib/domain/planning.ts`](../../lib/domain/planning.ts): gemeinsame Milestone- und Seitentypen.
- [`lib/services/planning-store.ts`](../../lib/services/planning-store.ts): Autorisierung, Fehler, Cursor und Transaktions-/Replay-Vertrag.
- [`docs/technical/milestones.md`](../technical/milestones.md): Persistenz und Serviceverträge.

## Verifikation

[`tests/worker/milestones.test.ts`](../../tests/worker/milestones.test.ts) verwendet migrierte D1 mit synthetischen Projekten. Die Tests prüfen Projektgrenzen, leere Listen, Normalisierung, Ankerreihenfolge, geschlossene Ziele, Inhalts- und Planungsrevisionen, konkurrierende Änderungen, persistentes Replay, Cursor-Konflikte, Transaktionsrollback und sichere Fehler. Zusätzliche Race-Fälle schließen ein Ziel nach der Vorprüfung und verändern die Planungsrevision während des Lesens.

Verwendete zentrale Regeln: Dokumentation und Planung 1.0.0, Implementierung und Datenzugriff 1.0.1; vor Umsetzung über natives Luufi-MCP gelesen. Diese Dokumentation behauptet kein Deployment oder Produktionsrelease.
