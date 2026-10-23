---
policy: documentation
version: 1.0.0
language: de
---

# Feature-, Technik- und Betriebsdokumentation

## Zweck und Quelle der Wahrheit

Dokumentation beschreibt den tatsächlich implementierten Stand ihres Repository-Branches. `develop` beschreibt integrierte Entwicklung, der Produktionsbranch den Produktionsstand. Aufträge sind die Änderungshistorie, nicht die dauerhafte Produktdefinition. Zukünftige Funktionen werden in Aufträgen geplant und nicht als vorhandenes Verhalten dokumentiert.

Luufi definiert diesen zentralen Standard, das jeweilige Projekt besitzt seine Dokumentation. Codex lädt vor Refinement und Implementierung den aktuellen Standard über `get_guidelines` und prüft die relevanten Dokumente am konkreten Git-Commit. Richtlinienversion und gelesener Projektstand werden nachvollziehbar festgehalten.

## Struktur

```text
README.md
docs/features/README.md
docs/features/<stabiler-feature-schluessel>.md
docs/technical/
docs/operations/
```

README ist der Einstieg mit kurzem tatsächlichem Produktumfang, Einrichtungseinstieg und Verweisen. Das Feature-Verzeichnis führt ausschließlich vorhandene Features auf. Gemeinsame technische Grundlagen werden einmal beschrieben und verlinkt.

Jede Feature-Datei enthält mindestens die Metadaten `feature` als stabilen Schlüssel und `documentation_policy` als verwendete Richtlinienversion. Titel, Fließtext und Verweise beschreiben das aktuelle Verhalten; absolute lokale Rechnerpfade gehören nicht in die öffentliche Dokumentation. Relative Repository-Links und symbolische Code-Einstiegspunkte werden gegenüber schnell veraltenden Zeilennummern bevorzugt.

## Verbindliche Feature-Abschnitte

| Abschnitt | Erforderlicher Inhalt |
| --- | --- |
| Zweck und Umfang | Nutzerproblem, unterstütztes Ergebnis und fachliche Abgrenzung |
| Nutzerabläufe | Einstieg, Aktionen, Voraussetzungen und beobachtbare Ergebnisse |
| Regeln und Zustände | Zustandswechsel, Validierung, Berechtigungen und gespeicherte Informationen |
| Sonder- und Fehlerfälle | Leere Daten, ungültiger Input, Ausfälle, Wiederholung, Unterbrechung und Wiederherstellung |
| Grenzen | Bewusste Einschränkungen und nicht unterstütztes Verhalten |
| Technische Verweise | Zugehörige Architektur, Verträge und wichtige Code-Einstiegspunkte |
| Verifikation | Relevante Verhaltenstests und notwendige ergänzende Prüfnachweise |

Nicht anwendbare Aspekte kurz als solche kennzeichnen. Keine Produktregeln erfinden, nur um eine Vorlage zu füllen. Begriffe und Zustände konsistent zur Oberfläche und API halten. Konkrete Beispiele ergänzen, wenn Grenzwerte oder Zustandswechsel sonst mehrdeutig bleiben.

## Technische Tiefe

Die Beschreibung muss Codex erlauben, vorhandene Fähigkeiten zu beurteilen, betroffene Komponenten zu finden und Änderungsrisiken zu erkennen. Sie muss insbesondere beantworten, wo Daten entstehen, wer sie ändern darf, welche Invarianten gelten und wie Fehler behandelt werden. Sie ersetzt weder Code noch vollständige API-Referenzen durch eine zeilenweise Nacherzählung.

Technikdokumentation ergänzt:

- Architektur, Komponentenverantwortung und relevante Datenflüsse;
- Entitäten, Beziehungen, Invarianten, Persistenz und Migrationen;
- öffentliche Browser-API- und MCP-Verträge einschließlich Eingaben, Ergebnissen, Berechtigungen, Revisionen und Fehlerverhalten;
- externe Dienste, Konfiguration und erforderliche Geheimniskategorien ausschließlich mit Platzhaltern;
- bedeutsame Entscheidungen mit Begründung und Konsequenzen;
- Testarchitektur und bekannte technische Grenzen.

Betriebsdokumentation ergänzt Einrichtung, lokale Prüfungen, Deployment, Umgebungsidentität, Backup/Wiederherstellung und konkrete Störungsbehandlung. Keine realen Schlüssel, persönlichen Daten oder private Live-Payloads einchecken.

## Pflege je Auftrag

Jeder finale Auftragscommit enthält die erforderlichen Dokumentationsänderungen neben Code und Tests. Bei rein technischer Arbeit genügt eine technische Ergänzung, wenn fachliches Verhalten unverändert bleibt. Dokumentation wird nicht auf einen späteren Sammelcommit verschoben.

Vor dem finalen Commit prüft Codex:

1. Tatsächliche Nutzerabläufe und Einschränkungen stimmen mit Code und Tests überein.
2. Geänderte Zustände, Validierung, Berechtigungen und Fehlerfälle sind erfasst.
3. Verweise, Feature-Schlüssel und Richtlinienmetadaten stimmen.
4. Dokumentation behauptet keine noch ausstehenden Features, Tests, Deployments oder Releases.
5. Beispiele und Betriebsanweisungen enthalten keine Geheimnisse oder privaten Daten.

Struktur, Metadaten und interne Links werden automatisiert prüfbar gemacht. Inhaltliche Übereinstimmung bleibt eine ausdrückliche Codex-Reviewaufgabe; ein bestandener Strukturtest beweist keine fachliche Vollständigkeit.

## Neuaufbau und Weiterentwicklung des Standards

Das neue Grundgerüst besitzt zunächst nur die tatsächlich erforderliche Einrichtungs-, Architektur- und Testdokumentation. Noch keine Feature-Behauptungen aus dem Altbestand übernehmen. Mit dem Commit für Projektideen wird dieses Feature vollständig dokumentiert. Weitere Features wachsen mit ihren Auftragscommits hinzu.

Bis Luufi seinen Richtlinien-MCP nachweislich bereitstellt, verwendet Codex diese freigegebene lokale Quelle als Bootstrap. Unzureichende Dokumentation führt zu einem begründeten Verbesserungsvorschlag. Nach Zustimmung des Nutzers wird eine neue zentrale Version veröffentlicht. Betroffene Bereiche werden bei der nächsten Arbeit angepasst; unabhängige größere Lücken erhalten eigene Aufträge.
