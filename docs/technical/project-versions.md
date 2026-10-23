# Versionen, Buildzuordnung und Releaseprüfung

Gelesene Richtlinien: Dokumentation 1.0.0, Implementierung 1.0.1, Datenzugriff 1.0.1. Das additive gemeinsame Schema `0009` ergänzt `project_versions`, unveränderliche `version_orders`, append-only `version_builds` und `version_releases`. Öffentliche Bootstrapprovenienz liegt separat in `bootstrap_provenance`.

## Versionssnapshot und Mitgliedschaft

`createProjectVersion` bindet den normalisierten Inhalt an die erwartete Projektplanrevision. Eine Auswahl besitzt 1 bis 50 eindeutige Auftrags-IDs; ein Milestone wird vollständig durch `INSERT SELECT` eingefroren und besitzt kein verstecktes 50er-Limit. Der atomare Guard prüft Projekt, Planrevision, Eindeutigkeit des Labels/Kanals, vollständige Mitgliedschaft, erledigten Status und gültige Herkunft erneut.

Der Herkunftsquery bindet die aktuelle Fassung sowie die aktuellen erfolgreichen Implementierungs- und Integrationsreferenzen des Auftrags. Beide W5-Belege müssen denselben Auftragscommit betreffen. Alternativ ist ausdrücklich gespeicherte `public-git`-Bootstrapprovenienz mit öffentlichem Commit und Integrationsreferenz zulässig. `sites-proof` besitzt keinen öffentlichen Auftragscommit und wird abgelehnt. Der Snapshot hält Titel, Fassung, öffentliche Commitkennung, Verweise und `execution`/`bootstrap` getrennt fest; er erfindet keine W5-Claims für Bootstrapaufträge.

Versionen besitzen keine Updatefunktion für Label, Text, Repositorycommit oder Mitglieder. Sie bleiben nach späteren Änderungen des Projektplans unverändert. Mitglieder werden nach ihrer eingefrorenen numerischen Auftragsnummer gelesen, nicht lexikographisch nach dem Anzeigenamen. Label ist je Projekt/Kanal eindeutig und muss kein Semverwert sein. Alle IDs sind maximal 256 Zeichen, Label maximal 80, Titel maximal 280 und Änderungsnotizen maximal 20.000 Zeichen. Branches/Tags sind maximal 200, Links/Referenzen maximal 1.000, Gründe maximal 4.000 Zeichen; SHAs sind vollständig und werden kleingeschrieben normalisiert.

## Buildbeobachtungen und Hostingidentität

`recordVersionBuild` speichert unveränderliche `available`, `unavailable` oder `failure`-Belege. Verfügbarkeit verlangt einen sicheren HTTP(S)-Link und einen konkreten Prüfverweis. Andere Ergebnisse verlangen nullURL und einen Grund. Beobachtungszeiten werden als ISO-UTC normalisiert. Ein erfolgreicher Beleg muss die Version tatsächlich enthalten.

`projectCommit` ist der tatsächlich gebaute öffentliche Projektstand. `sourceKind`, `sourceBranch` und `sourceCommit` beschreiben die konkrete Hostingquelle. `github` verlangt `sourceCommit=projectCommit`. `sites` verlangt eine nachvollziehbare `mappingReference`, auch wenn die SHAs zufällig übereinstimmen. Weicht `projectCommit` vom eingefrorenen `repositoryCommit` der Version ab, sind `versionCommitIncluded=true` und eine ausdrückliche Zuordnung erforderlich. Codex prüft die privaten Hostingfakten, Health und Banner separat und verlinkt diese Prüfung; der Service behauptet keine eigene Sites-Verifikation.

Die aktuell gültige Beobachtung je Version/Art/Umgebung wird durch `observed_at DESC, rowid DESC` bestimmt. Ein historisch später eingetragener, aber früher beobachteter Fehler verdrängt deshalb keine neuere Erfolgsmeldung. `getLatestAvailableVersion` berücksichtigt nur aktuelle verfügbare Ziele und wählt die zuletzt angelegte solche Version. Eine neuere Version ohne verfügbares Ziel verdrängt keine ältere verfügbare. Bei mehreren verfügbaren Zielen derselben Version wird die neueste verfügbare Beobachtung geliefert. Die Rückgabe ist klein: Version und ein Build oder null, keine unbeschränkte Historie.

## Releasebeleg und Transaktionen

`recordVersionRelease` verlangt einen Produktionskandidaten und konkrete Nutzerfreigabe-/Deploymentprüfverweise. Produktionsbranch und Repository müssen zur aktuellen Projektkonfiguration passen. Beobachteter Branchhead, Tagtarget, eingegebener Produktionscommit und gebauter öffentlicher `projectCommit` müssen exakt übereinstimmen. Der beobachtete Versionscommit ist der eingefrorene Versionsstand und muss im Produktionscommit enthalten sein. Es muss aktuelle erfolgreiche CI für genau diesen Produktionscommit vorliegen, ohne entgegenstehenden aktuellen Befund. Der referenzierte Produktionsbuild muss noch die jüngste verfügbare Beobachtung seines Art-/Umgebungsziels sein.

Releaseeintrag, `releaseId`, Versions-/Projektversionsrevisionen und Receipt werden gemeinsam gespeichert. Je Version gibt es höchstens einen Release, je Projekt ist ein Tag eindeutig. Gleichzeitige neue Buildbeobachtungen oder Konfigurationsänderungen entwerten veraltete Releaseversuche atomar. Es findet kein Git-Tag-, Branch-, Hosting- oder GitHub-Release-Schreibzugriff statt.

Alle Mutationen verwenden den gemeinsamen `planningAttempt`-/`planningMutation`-Ledger mit Akteur, Operation, normalisiertem Inhalt und Revision. Wiederholungen liefern das ursprüngliche Ergebnis; derselbe Schlüssel mit anderem Inhalt kollidiert. Verlorene veränderliche Voraussetzungen wie aktuelle Buildverfügbarkeit oder Produktionskonfiguration sind Konflikte: Vor der Fehlerrückgabe wird ein möglicherweise inzwischen gespeicherter identischer Receipt erneut gelesen. Dadurch erhält auch ein verspäteter paralleler Aufruf das ursprüngliche Releaseergebnis, wenn danach ein Build ausfällt oder sich Konfiguration ändert. Listen binden Cursor an Projekt, Version, Listenart und `versions_revision` beziehungsweise Versionsrevision. Vor Rückgabe wird der Snapshot erneut geprüft. `getProjectVersion` liefert ausschließlich Stammdaten und Zähler, keine großen Arrays.

## Lokaler schreibgeschützter Releasehelper

Codex führt `node scripts/verify-release-git.mjs` aus und übergibt maximal 16 KiB JSON über stdin:

```json
{
  "cwd": ".",
  "repository": "owner/repository",
  "productionBranch": "main",
  "productionCommit": "0000000000000000000000000000000000000000",
  "tag": "release-1",
  "versionCommit": "1111111111111111111111111111111111111111"
}
```

Die SHAs sind Platzhalter. Repository darf `owner/name` oder eine GitHub-HTTPS-Adresse mit optionalem `.git`-Suffix sein. Die GitHub-API-Adresse wird intern kanonisiert; die Beobachtung behält die exakt konfigurierte Repositoryidentität. Andere Provider, unsichere Referenzen, Zugangsdaten in URLs und unbekannte Parameter werden abgelehnt. Windows verwendet die bestehende erhöhte GitHub-CLI-Anmeldung gemäß Datenzugriffsrichtlinie, keine neuen Runtime-Secrets.

Der Helper liest ausschließlich lokale Gitobjekte und explizite GitHub-GET-Endpunkte über `gh api`. Er prüft lokalen Produktionshead und tatsächlichen Remote-Branchhead gegen den angegebenen Produktionscommit. Der ursprüngliche Versionscommit muss im lokalen vollständigen Graph enthalten sein. Lokaler Tag und tatsächlicher Remote-Tag müssen auf denselben Produktionscommit zeigen. Annotierte Remote-Tags werden höchstens vier Ebenen tief aufgelöst. Checkruns und Workflowruns gehören genau zum Produktionscommit; je Check-/Workflowidentität gilt der neueste Lauf. Fehlende, abgeschnittene, ausstehende oder gescheiterte CI sowie mehr als 100 Rohwerte beziehungsweise 50 aktuelle Fakten führen zum Fehler.

Gitkommandos verwenden Argumentarrays, deaktivierte Hooks/Fsmonitor und keine Replacementobjekte. Lokale `info/grafts` im tatsächlichen Git- oder gemeinsamen Worktreeverzeichnis sowie geerbtes `GIT_GRAFT_FILE` werden vor der Prüfung abgelehnt. Zusätzlich setzt jeder Gitprozess `GIT_GRAFT_FILE` auf das plattformspezifische Nullgerät, damit auch nach der Vorprüfung angelegte Grafts keine Eltern oder Ancestry umschreiben können. Es gibt keinen Checkout, Fetch, Remotehelper, Build, PR-Codeaufruf, Tag-Schreibzugriff oder Releaseaufruf. Bereits fehlende lokale Objekte verlangen eine gesonderte Aktualisierung durch Codex. Prozesse, Antworten, Tagtiefe und Ergebnisgrößen sind begrenzt. CLI-Fehler geben keine Credential-/Remote-URLs oder Rohantworten aus. Der explizite Read-Adapter von `verifyReleaseGit` dient synthetischen Tests; die CLI selbst hat keinen Adapterparameter.

## Verifikation

Worker-Tests verwenden echte D1-Tabellen für unveränderliche Snapshots, vollständige Milestones, getrennte öffentliche/Hosting-SHAs, Beobachtungsreihenfolge, Releasevoraussetzungen und atomaren Rollback. Git-Tests erzeugen echte temporäre Repositorys und Tags ohne Remote-CI-Abhängigkeit; Plattformantworten sind dort synthetisch.

Der zusätzliche tatsächliche Read-only-Aufruf am 23. Oktober 2026 gegen `nexa16/Luufi` bestätigte die bestehende Produktionsgrenze: `main` enthält noch den anfänglichen Root und nicht den aktuellen Integrationsstand. Der Helper brach mit „Der Versionscommit ist nicht im Produktionscommit enthalten“ ab, bevor ein Tag abgefragt wurde. Es wurde kein Tag angelegt, kein Releasebeleg gespeichert und keine Produktion veröffentlicht. Coverage gehört ausschließlich zum finalen Integrationsgate.
