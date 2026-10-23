---
feature: projects
documentation_policy: 1.0.0
---

# Projekte

## Zweck und Umfang

Registrierte Projekte bündeln ihre eigene Planung. Codex verwaltet die Stammdaten über natives MCP. Projektideen bleiben unabhängig.

## Nutzerabläufe

Codex registriert Name, dauerhaftes Kürzel, Repository und Projektkonfiguration. Anschließend lassen sich Projekte paginiert und einzeln lesen. Eine Änderung benötigt die aktuelle Revision und einen Wiederholungsschlüssel.

## Regeln und Zustände

Das Kürzel besteht aus 2–20 Großbuchstaben/Ziffern, beginnt mit einem Buchstaben und bleibt eindeutig sowie unveränderlich. Integrationsbranch ist standardmäßig develop, Produktionsbranch main oder master. Dokumentationspfade sind relativ zum Repository. Repository-Adressen enthalten keine Zugangsdaten. Der private Sites-Einzelnutzerzugang schützt jeden Abruf.

Projektstammdaten besitzen eine Revision; die getrennte Planungsrevision schützt Reihenfolgen und Cursor. Neue Projekte starten ihren Auftragszähler bei1. LUUFI reserviert die Bootstrapnummern1–9 und startet bei10. Es gibt keinen allgemeinen Importdienst.

## Sonder- und Fehlerfälle

Leere Listen sind erfolgreich und enthalten keinen Folgecursor. Veraltete Revisionen, doppelte Kürzel und anderweitig verwendete Wiederholungsschlüssel liefern Konflikte. Identische Wiederholung liefert die ursprüngliche Antwort auch nach späteren Änderungen. Daten und Beleg werden gemeinsam gespeichert oder vollständig zurückgerollt.

## Grenzen

Keine automatische Registrierung aus einer Idee, kein browserseitiges Bearbeiten und keine GitHub-Issue-Synchronisation. Repositoryzugriff oder Existenz werden durch Registrierung allein nicht bewiesen.

## Technische Verweise

[Planungskern](../technical/planning.md), `lib/services/projects.ts`, `lib/domain/planning.ts`, `drizzle/0006_planning.sql`.

## Verifikation

`tests/worker/projects.test.ts` prüft Registrierung, Bootstrapreservierung, eindeutige Kürzel, Revisionen, Replay, Rollback, Cursor und ungültige Konfiguration. Transportverträge erhalten zusätzlich eigene MCP-/API-Prüfungen.
