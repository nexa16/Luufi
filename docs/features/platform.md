---
feature: platform
documentation_policy: 1.0.0
---

# Private Plattform

## Zweck und Umfang

Luufi bietet eine deutsche, private Oberfläche mit den Hauptzielen Projekte und Projektideen. Die Projekte-Seite beschreibt den noch ausstehenden Aufbau der neuen Projektverwaltung. Sie zeigt keine erfundenen Projekte und liest keine früheren GitHub-Projektdaten.

## Nutzerabläufe

Die Hauptnavigation öffnet Projekte oder die eigenständige Route `/ideas`. Ein direkter Aufruf und erneutes Laden behalten das gewählte Ziel bei. Auf der Projekte-Seite führt eine zusätzliche Verknüpfung zu den Projektideen.

Die Vorschau zeigt Quellbranch und Commit-Kurzform in einem sichtbaren Banner. Die vollständige Identität ist nach Anmeldung über `/api/health` und das native MCP-Werkzeug `get_context` verfügbar. Ein fehlerhaftes Deployment oder eine nicht erreichbare Ideen-Tabelle liefert den Status `unavailable`.

## Regeln und Zustände

Sites schützt die gesamte Site. Luufi verwendet ausschließlich die von diesem vertrauenswürdigen Adapter weitergeleitete Benutzeridentität für private Datenzugriffe. Ein MCP-Metadatenfeld ist kein Identitätsnachweis. Ein bloßer Servicezugang ohne Benutzeridentität berechtigt nicht zu Health- oder Werkzeugaufrufen.

`get_guidelines` liefert die veröffentlichten Richtlinien mit Kennung, Version, vollständigem Text und SHA-256 der ausgelieferten UTF-8-Bytes. Die synthetischen Prüfwerkzeuge `probe_read`, `probe_write` und `read_probe_attachment` existieren ausschließlich in der Vorschau. Sie greifen niemals auf Projektideen zu. Revisionen verhindern verlorene Änderungen; ein Wiederholungsschlüssel bindet genau einen Inhalt und liefert bei identischer Wiederholung das ursprüngliche Ergebnis.

## Sonder- und Fehlerfälle

Fehlende Benutzeridentität führt bei privaten Werkzeugen und Health zu 401. Ungültige Parameter werden ohne fachlichen Datenzugriff abgelehnt. Interne Datenbankfehler werden durch bereinigte Fehlermeldungen ersetzt. Ein veralteter Revisionsstand überschreibt keine jüngere Probe; ein identischer wiederholter Schreibaufruf setzt spätere Daten nicht zurück.

## Grenzen

Die Projekte-Seite ist eine Vorbereitung und bietet noch keine Projektregistrierung oder Projektansichten. Die synthetische Datei beweist den geschützten Transport, keinen R2-Upload oder Medienanalyse. Es gibt keine GitHub-Anmeldung oder automatische Projekt-/Workflow-Synchronisierung.

## Technische Verweise

- `app/layout.tsx`, `app/page.tsx` und `components/primary-navigation.tsx`: deutsche Plattform und Navigation.
- `lib/services/deployment-identity.ts` und `app/api/health/route.ts`: Identität und Bereitschaft.
- `lib/mcp/service.ts`, `route.ts`, `storage.ts`, `guidelines.ts`: MCP-Grenze, isolierte Probe und Richtlinien.
- [Technische Plattformdokumentation](../technical/platform.md).

## Verifikation

`lib/services/deployment-identity.test.ts`, `tests/ui/platform.test.tsx`, `tests/worker/health.test.ts`, `tests/worker/mcp.test.ts` und `lib/mcp/service.test.ts` schützen Umgebung, Identität, Bereitschaft, Navigation, Richtlinienprüfsummen, Protokollparameter und isolierte Prüfdaten. Ein zusätzlicher nativer Plattformsmoke prüft das tatsächlich veröffentlichte Werkzeug und dessen exakten SHA.
