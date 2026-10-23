---
document: order-execution-architecture
documentation_policy: 1.0.0
---

# Lifecycle, Freigaben und Claims

## Verantwortung und Datenmodell

`order-lifecycle.ts` bietet die Operationen zum Bereitstellen, Zurückgeben, Archivieren, Freigeben/Widerrufen und expliziten Milestone-Abschluss sowie getrennte Leseansichten. `order-execution.ts` bietet Beginn, Pause, Fortsetzung, Übernahme, Stop/Replan und datierte Fortschritte. Es gibt keinen allgemeinen Statussetter. Der gemeinsame `planning-store` hält Autorisierung, CAS, sichere Fehler und dauerhaften Replay.

Migration0008 ergänzt Lifecycle-Revision und Kandidat-/Integrationsreferenzen am Auftrag sowie getrennte Freigabe-, Item-, Execution-, Fortschritts-, Ereignis- und Belegtabellen. Frühere Migrationen bleiben unverändert. `specVersion` bezeichnet die historische Spezifikation; Orderrevision schützt Mutationen; `lifecycleRevision` schützt getrennte Historien. Claimrevision und Generation sind davon getrennt. Der partielle Unique-Index auf aktive/pausierte Executions verhindert zwei offene Claims pro Auftrag.

Freigaben speichern ein unveränderliches Item je ausgewähltem Auftrag: Version, Titel, kanonisch sortierte Abhängigkeiten, Repository und Integrationsbranch. `approvalValid` vergleicht den Snapshot mit dem aktuellen Scope und einem etwaigen Widerruf beziehungsweise Invalidierungsgrund. Items werden bei fachlicher Invalidierung markiert, ohne den ursprünglichen Umfang zu überschreiben. Neue Freigaben invalidieren innerhalb desselben Batches alle früheren Items genau der neu ausgewählten Aufträge; übrige Mitglieder alter Sammelfreigaben bleiben erhalten. Ein späterer Widerruf der neuen Freigabe reaktiviert keine alte Bindung. Die letzte Freigabe wird in der Summary gezeigt; Start nennt ausdrücklich eine gültige passende Freigabe.

## Atomare Mutationen

Alle Mutationen bilden zunächst einen strikten normalisierten Payload. `planningAttempt` liest den Receipt vor veränderlichen Vorprüfungen und bei zwischenzeitlichen Konflikten erneut. `planningMutation` beansprucht den Requestschlüssel unter vollständigem SQL-Guard. Jeder nachfolgende Schreibschritt ist an diesen noch offenen Schlüssel gebunden. Die vollständige Originalantwort entsteht im selben Batch. Fehler im Receipt rollen alle Domainänderungen zurück.

Die Auswahlfreigabe ist auf fünfzig angegebene IDs begrenzt. Milestonefreigabe verwendet einen vollständigen `INSERT ... SELECT` ohne LIMIT; die vorab gelesene Anzahl, alle ready-Zustände, offene Mitgliedschaft und Projektplanrevision werden im Guard erneut geprüft. Unbereite oder bereits abgeschlossene Mitglieder führen zum Konflikt mit Hinweis auf ausdrückliche Auswahl. Neue Mitglieder nach einem erfolgreichen Snapshot ändern dessen Items nicht. Widerruf prüft, dass kein betroffener Auftrag einen offenen Claim besitzt.

Begin prüft bereit, aktuelle Freigabebindung, Orderrevision und alle `depends_on`-Vorgänger. `done` genügt; andernfalls muss der Vorgänger `implemented` sein und auf seinen aktuellen erfolgreichen Implementierungsbeleg derselben Spezifikationsfassung zeigen. Dessen Codex-Beobachtung nennt dasselbe Repository und denselben Arbeitsbranch sowie Push und Commit-Ancestry. Der Server führt dabei weder Git-Befehle aus noch stellt er neue GitHub-Verbindungen her.

Pause und Fortsetzung bewahren die gesperrte Spezifikation; Fortsetzung prüft Freigabe und Voraussetzungen erneut. Übernahme hält die bisherige Phase und erhöht die Generation. Generation, Execution-ID und Orderrevision stehen im Guard jeder Steuerung und Notiz. Stop schließt den Claim, erhöht seine Generation, invalidiert Freigabeitems, entfernt aktuelle Belegreferenzen und setzt Entwurf. Historische Nachweise bleiben bestehen. Erfolgreiche Integration und Abschlussbelege gehören zum getrennten Evidence-Service.

`reconcileMilestones` ist ein gemeinsamer SQL-Baustein derselben Transaktion, wenn Archivierung/Abschluss/Zuordnung die Vollständigkeit verändern. Es schließt nur offene nicht leere Milestones ohne unerledigte nicht archivierte Mitglieder. Explizites Schließen prüft zusätzlich bekannte Milestonerevision; für leere ist eine ausdrückliche Bestätigung erforderlich.

## Lesen und Fehlerverträge

Die Summary enthält aktuelle Revisionen, letzte Freigabebindung mit Gültigkeitsgrund, offenen Claim und aktuelle Belegreferenzen. Fortschritt, Ereignisse und Freigaben werden getrennt paginiert. Statische gemeinsame SQL-JSON-Ausdrücke halten Feldnamen und null-Werte über Services/MCP/Browser konsistent. Scope und Caller-Daten werden als gebundene SQL-Parameter verwendet.

Die Listenrevision berücksichtigt Lifecycle- und Projektkonfigurationsrevision. Freigabeitemlisten binden zusätzlich die Freigaberevision und betroffene Aufträge. Daten und erneute Revision werden im selben D1-Batch gelesen; eine Abweichung erzeugt einen Konflikt. History-Sortierung nutzt Datum plus stabile Datenbankreihenfolge beziehungsweise Item-ID. Fehlende/fremde Ziele sind `not_found`, fachliche Stale-/Zustandsgrenzen `conflict`, ungültiger Inhalt `validation`. Infrastrukturfehler werden bereinigt; keine Secrets oder rohe SQL-Details verlassen den Service.

## Tests und Grenzen

Die Tests verwenden echte migrierte D1 mit synthetischen Projekten. Besonders geprüft sind Scopegrößen oberhalb fünfzig, keine spätere implizite Freigabe, konkurrierender Start, Widerruf vor dem atomaren Guard, Übernahmegeneration und verspätete Writes, Pause ohne Ablaufautomatik, tatsächliche interne Belegzuordnung für Vorgänger, Stop/Neuplanung, geschlossene Milestones und Receipt-Rollback. Lokal bleiben Tests fokussiert ohne Coverage; der Koordinator integriert bestehende Order-/Milestonepfade und führt das finale CI-Gate aus. Es gibt keine automatische Agentausführung, Zeitabrechnung, neue Runtime-GitHub-Credentials oder Produktionsfreigabe.
