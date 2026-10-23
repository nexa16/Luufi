---
document: platform-architecture
documentation_policy: 1.0.0
---

# Plattform und MCP

React-Routen laufen über Vinext und den Cloudflare Worker. D1 wird über das Binding `DB` angesprochen; Sites übernimmt die äußere Authentifizierung und den privaten Zugriffsschutz. `siteIdentity(request)` ist die einzige Identitätsquelle für Health und MCP-Werkzeuge. Discovery liefert statische Schemas auch ohne Benutzeridentität, damit Sites die Erweiterung provisionieren kann. Sie liefert keine fachlichen Daten.

`deploymentIdentity` prüft `LUUFI_COMMIT_SHA`, `LUUFI_ENVIRONMENT` und `LUUFI_SOURCE_BRANCH`. Produktion verlangt `main`; Vorschau kann den tatsächlichen privaten Sites-Quellbranch abbilden. `platformReadiness` prüft mit `SELECT 1` die Verbindung und mit einem leeren SELECT die erforderlichen Spalten von `project_ideas`. Es liest keine Ideeninhalte und benötigt keinen GitHub-Token.

`POST /mcp` verarbeitet einzelne JSON-RPC-Anfragen bis 256 KiB, einschließlich gestreamter Bodies. Das begrenzte größere Budget erlaubt vollständige Auftragsspezifikationen. Andere HTTP-Methoden erhalten 405. Ein vorhandener `Origin` muss exakt der Site-Origin entsprechen; fremde Origins einschließlich `null` erhalten vor Datenzugriff 403. Native Clients dürfen den Header auslassen. Der Medientyp muss `application/json` sein; Parameter wie `charset=utf-8` sind erlaubt, andere Medientypen erhalten 415. Ungültiges JSON liefert einen bereinigten Parsefehler; private Werkzeugaufrufe ohne Sites-Identität erhalten 401. Antworten sind nicht cachebar. Interne Datenbankfehler werden nicht veröffentlicht.

Vorhandene Transportheader `Mcp-Method`, `Mcp-Name` und `MCP-Protocol-Version` müssen mit Methode, Werkzeugname und `_meta.io.modelcontextprotocol/protocolVersion` im Body übereinstimmen. Widersprüche liefern HTTP 400 mit `-32020`; eine andere angefragte Protokollversion als `2026-07-28` liefert HTTP 400 mit `-32022` und der Liste unterstützter Versionen. Für bewusst kompatible Legacy- und Unit-Clients dürfen diese Header fehlen. Dieser Kompatibilitätspfad behauptet keine vollständige MCP-2026-07-28-Konformität. Die native Sites-Verbindung liefert die drei Header passend mit; Metadaten bleiben unabhängig davon keine Identitätsquelle.

Der Dispatcher unterstützt `server/discover`, kompatibles `initialize`, `tools/list` und `tools/call`. Werkzeugaufrufe akzeptieren ein `_meta`-Objekt, verwenden es aber weder als Benutzeridentität noch als fachliche Argumente. Bei leeren Werkzeug-Schemas darf `arguments` fehlen. Unbekannte Parameter und schemawidrige Argumente werden abgelehnt; Notifications schreiben keine Daten. Erfolgsresultate enthalten `resultType: complete`. Dieser kleine Dispatcher beansprucht keine vollständige Implementierung aller optionalen MCP-Funktionen.

`get_context` und `get_guidelines` sind lesend in Produktion und Vorschau verfügbar. Die Probe-Werkzeuge fehlen in der Produktionsliste und werden dort auch bei direktem Aufruf abgelehnt. Die Probe-Persistenz verwendet ausschließlich `luufi_mcp_probe_records` und `luufi_mcp_probe_writes`, nach Sites-Benutzer getrennt. Ein D1-Batch bindet Revisionsprüfung und Replay-Ledger atomar. Die additive Probe-Migration bleibt erhalten; bestehende Tabellen werden nicht entfernt.

`lib/mcp/policies.json` enthält bewusst ausgewählte veröffentlichte Richtlinientexte als Build-Asset. `getGuideline` berechnet den SHA-256 über exakt den zurückgegebenen Text. Tests vergleichen Inhalt und Version mit den Markdown-Quellen. Richtlinienänderungen erhalten eine neue Version; veröffentlichte Fassungen werden nicht still überschrieben.
