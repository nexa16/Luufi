---
feature: bootstrap
documentation_policy: 1.0.0
---

# Neubauprovenienz übernehmen

## Zweck und Umfang

Der feste Luufi-Bootstrap übernimmt ausschließlich die ausdrücklich freigegebenen Neubauaufträge1–18 mit festen IDs und Spezifikationsfassungen. Tatsächlich durch Codex geprüfte historische Provenienz bleibt von normalen W5-Freigaben, Claims und Kriterienprüfungen getrennt. Dies ist kein allgemeiner Importdienst.

## Nutzerabläufe

Codex inventarisiert zuerst den tatsächlichen Luufi-Bestand und prüft die zugehörigen Git-/PR-/CI- beziehungsweise Sites-Nachweise. Erst danach liefert es genau18 Nachweise und den konkreten Bestätigungsverweis. Das Manifest1.0.0 legt Projekteigenschaften, Milestones, IDs, Titel, Kriterien und Spezifikationen fest; der Aufrufer kann keinen eigenen Scope oder SQL übergeben. Die finalen Provenienz-SHAs der letzten Aufträge können erst nach deren Integration übergeben werden.

Nach erfolgreichem Abgleich zeigen die vorhandenen Projektansichten die erledigten Aufträge und geschlossenen Bootstrapmilestones. Auftragsdetails können ihren getrennten Bootstrapbeleg lesen. Neue normale Aufträge beginnen oberhalb des reservierten Bereichs.

## Regeln und Zustände

- Ziel ist ausschließlich `LUUFI`, Repository `nexa16/Luufi`, Integration `develop`, Produktion `main`. Eine vorhandene passende Projekt-ID und zusätzliche Konfiguration bleiben erhalten. Ein neues Projekt erhält die feste ID `bootstrap-luufi-project`.
- Aufträge heißen `bootstrap-luufi-order-N`, Nummer1–18, jeweils Fassung1 und Zustand erledigt. Die fünf festen geschlossenen Milestones enthalten1–3,4–9,10–12,13–15 und16–18 in dieser Reihenfolge. Spezifikationen enthalten reichhaltigen Ziel-/Scope-/Kriterien-/Test-/Dokumentationskontext und sichtbare Quellenverweise. Der verwendete Refinementkontext ist der bereits bestehende develop-Stand49c400a5e815d88a2837dc5ccd3dd770671f87bf.
- LUUFI-1 besitzt private Sites-Provenienz und ausdrücklich null für öffentlichen Implementierungs-/Integrationscommit, PR und CI. Es wird kein öffentlicher Auftragscommit erfunden.2–18 benötigen vollständige öffentliche Commit-SHAs und konkrete Luufi-GitHub-PR-/CI-Links. Source-SHA, tatsächlicher Prüfzeitpunkt und Prüfverweis sind erforderlich.
- Es entstehen keine historischen W5-Claims, Freigaben, Prüfberichte oder Nutzerbestätigungen, die nicht tatsächlich vorlagen. Der Bootstrapbeleg bezeichnet eine owner-authentifizierte Codex-Beobachtung und keine unabhängige Serververifikation.
- Vorhandene abweichende IDs, Nummern, Spezifikationen, Milestones und Provenienz erzeugen benannte Konflikte. Passende vorhandene Bestandteile werden erhalten, fehlende ergänzt. Die reservierten Milestonepositionen0–4 werden nicht mit fremder bestehender Planung überlagert.
- Der Auftragszähler ist mindestens19 und wird nie gesenkt. Spätere echte Aufträge ab19 bleiben unverändert. Ein neuer Schlüssel für denselben vollständigen Abgleich erzeugt keine Duplikate und erhöht keine Domainrevision. Ein bestehender Schlüssel ist weiterhin an Actor und den exakten normalisierten Inhalt gebunden.

## Sonder- und Fehlerfälle

Der atomare Guard vergleicht den inventarisierten Zielbestand nochmals vollständig, einschließlich Projektrevision/Zähler, reservierten Aufträgen/Fassungen und Provenienz. Parallele Änderungen erzeugen einen Konflikt; der Bestand muss erneut gelesen werden. Alle Ergänzungen und der Originalantwort-Receipt werden in einem gemeinsamen D1-Batch geschrieben. Fehler im Receipt rollen Projekt, Milestones, Aufträge und Provenienz vollständig zurück.

Der Statusgetter unterscheidet fehlendes Projekt, Teilbestand und vollständig passendes Manifest. Der Auftragsgetter prüft Projekt, feste ID/Nummer, erledigten Status, Fassung und gültige Provenienz. Normale spätere Aufträge besitzen keinen Bootstrapbeleg. Ein nicht gefundenes oder fremdes Ziel erscheint nicht als erfolgreiche Installation.

## Grenzen

Die Bereitstellung dieses Codes bedeutet nicht, dass Live-Daten bereits übernommen wurden. Der Koordinator muss vor tatsächlicher Ausführung erneut inventarisieren und reale Nachweise liefern. Fehlt der native Werkzeugkatalog, wird kein Zugangsschutz umgangen und kein installierter Zustand behauptet. Produktion bleibt ausdrücklich separat freizugeben. Private Sicherung und Wiederherstellungsprüfung sind lokale Betriebsaufgaben, kein Runtime-SQL-/Backup-/Import-Endpunkt.

## Technische Verweise

[`bootstrap.ts`](../../lib/domain/bootstrap.ts) ist das feste Manifest; [`lib/services/bootstrap.ts`](../../lib/services/bootstrap.ts) enthält den geschützten Abgleich und Getter. Gemeinsame Provenienztypen/Serialisierung und Migration0009 gehören zum Versions-/Integrationsvertrag. [`recovery.md`](../operations/recovery.md) dokumentiert den präzisen Sicherungsumfang und lokalen SQLite-Nachweis.

## Verifikation

[`tests/worker/bootstrap.test.ts`](../../tests/worker/bootstrap.test.ts) prüft mit synthetischen Nachweisen feste Installation, vollständige Specs, getrennte private/öffentliche Provenienz, keine erfundenen Claims, Idempotenz/Replay, bestehende Projekt-ID, höheren Zähler und spätere Arbeit, Kollisionen, unveränderte Daten, parallele Inventur und Receipt-Rollback. [`scripts/verify-recovery.test.ts`](../../scripts/verify-recovery.test.ts) prüft echte SQLite-Wiederherstellung und referenzierte synthetische Mediendateien. Diese Tests sind kein tatsächlicher Produktionsrestore. Dokumentations-/Planungsrichtlinie1.0.0 und Implementierungs-/Datenzugriffsrichtlinie1.0.1 wurden durch den Koordinator nativ gelesen; lokal keine Coverage.
