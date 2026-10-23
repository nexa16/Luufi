# Auftragsnachweise und lokale Gitprüfung

Gelesene Richtlinien: Dokumentation 1.0.0, Implementierung 1.0.1, Datenzugriff 1.0.1. Gemeinsame Grundlage ist das additive Schema `0008_execution.sql` mit `order_evidence`, Bearbeitungen, Ereignissen und den aktuellen Nachweisreferenzen am Auftrag.

## Services und Vertrauensgrenze

`recordValidation`, `recordImplementation` und `recordIntegration` in `lib/services/order-evidence.ts` verwenden denselben strikten `EvidenceInput`. Fachliche Ergebnisse sind `success`, `failure` und `unavailable`; Fehlerhistorie ist kein erfolgreicher Abschluss. Alle Eingaben sind begrenzt, unbekannte Felder werden abgelehnt. IDs sind maximal 256 Zeichen, SHAs genau 40 Hexzeichen, Zusammenfassungen/Gründe maximal 4.000 und Verweise maximal 1.000 Zeichen. Höchstens 50 Kriterien und CI-Fakten werden angenommen. Links verwenden HTTP(S) ohne eingebetteten Benutzer oder Passwort.

Jeder Eintrag bindet die aktuelle Auftragsfassung, Bearbeitungskennung und Generation. Erfolg verlangt die aktive Phase und unveränderte Freigabe; fehlgeschlagene oder nicht verfügbare Prüfungen sind auch in der Pause erlaubt. Eine geänderte Projektkonfiguration oder Freigabe zwischen Vorprüfung und Schreiben wird im atomaren SQL-Guard erneut erkannt. Der Server verifiziert diese interne Konsistenz; die Gitfakten sind ausdrücklich von owner-authentifiziertem Codex lokal geprüft und aufgezeichnet.

Validierung verlangt die exakte, eindeutige Kriterienmenge der aktuellen Spezifikation und einen Dokumentationsnachweis. Erfolg enthält kein `fail`; `manual-only` verlangt einen ausdrücklichen Verweis mit Begründung, keine verpflichtende Nutzerabnahme. Implementierung verlangt zusätzlich einen erfolgreichen Validierungseintrag desselben Commits, Scopes und Claims, einen passenden Commitbetreff mit exakter Auftragskennung, höchstens einen Commit-Elternknoten, tatsächliche Push-/Ancestry-Beobachtung und den Arbeitsbranch. Kandidatersetzung erfordert den aktuellen `supersedesId` und eine passende neue Prüfung.

Integration bindet den aktuellen Implementierungskandidaten und seine Bearbeitung. Erforderlich sind normaler gemergter PR, richtige Basis, Merge-SHA, Erhalt des ursprünglichen Commits im Integrationsbranch sowie ausschließlich erfolgreiche aktuelle CI-Fakten für den PR-Head. Ein fehlender Build braucht `unavailableBuildReason`, etwa „Bereitstellung folgt im Folgeauftrag“. Gitfakten allein starten keine Tests; Codex muss die Kriterienprüfung tatsächlich durchgeführt haben.

## Atomare Persistenz und Historie

Der gemeinsame `planningAttempt`-/`planningMutation`-Ledger bindet Akteur, Operation, vollständigen normalisierten Inhalt und erwartete Revision an den Wiederholungsschlüssel. Nachweise, Revisionen, Status, Ereignis, Claimabschluss und Milestoneabgleich werden in einem D1-Batch gespeichert. Statusänderungen erhöhen zusätzlich die Projektplanrevision; reine Prüfbelege erhöhen Auftrags- und Lifecycle-Revision. Normale erfolgreiche Integration schließt die Bearbeitung und einen nicht leeren vollständig erledigten/archivierten Milestone.

`listOrderEvidence` liefert begrenzte Seiten mit `nextCursor`. Cursor binden Projekt, Auftrag und Lifecycle-Revision. Ein zweiter Snapshotcheck verhindert Antworten aus einer zwischenzeitlich geänderten Historie. Fertige Nachweise werden weder geändert noch gelöscht. Ersetzte Kandidaten bleiben über `supersedesId` nachvollziehbar. Nach Abschluss werden neue Einträge abgelehnt; ein ursprünglicher identischer Receipt bleibt wiederholbar abrufbar.

## Lokaler CLI-Helper

Codex führt `node scripts/verify-order-git.mjs` im lokalen Repository aus und übergibt ein begrenztes JSON-Objekt über stdin:

```json
{
  "cwd": ".",
  "repository": "owner/repository",
  "branch": "codex/feature",
  "integrationBranch": "develop",
  "orderId": "APP-14",
  "commitSha": "0000000000000000000000000000000000000000"
}
```

Der SHA im Beispiel ist ein Platzhalter. `repository` unterstützt `owner/name` sowie GitHub-HTTPS-Adressen mit optionalem `.git`-Suffix. Für GitHub-API-Abfragen wird die Adresse intern kanonisiert; die gespeicherte Beobachtung behält exakt den konfigurierten Repositorystring. Andere Provider werden ausdrücklich als nicht unterstützt abgelehnt. Bei Integration ist `branch` der Integrationsbranch und `prNumber` die tatsächliche PR-Nummer. Der lokale Repositorygraph muss die aktuellen Remote-/PR-/Mergeobjekte bereits besitzen; ein fehlendes Objekt ist ein Fehler. Einen notwendigen Fetch führt Codex separat aus, nicht der Prüfer. Für Windows gelten die bestehenden erhöhten GitHub-CLI-Anmelderegeln aus der Datenzugriffsrichtlinie.

Der Helper verwendet ausschließlich schreibgeschützte `git rev-parse`, `show`, `merge-base` und `log` sowie explizite `gh api`-GET-Aufrufe mit konfiguriertem Owner/Repository. Branchstrings werden in API-Pfaden kodiert. Die lokale Commitidentität, der Commitbetreff, Eltern und Ancestry werden tatsächlich gelesen. Der aktuelle Remote-Branch-SHA kommt aus GitHub und muss exakt dem geprüften lokalen Branchhead entsprechen. Bei Abweichung wird die Prüfung abgelehnt, auch wenn beide Commits lokal vorhanden sind. So beziehen sich Ausgabe und Ein-Commit-Prüfung auf denselben tatsächlichen Branchstand. Im Arbeitsbranch muss genau ein finaler Nicht-Mergecommit zur Auftragskennung existieren. Bei Integration muss genau dieser ursprüngliche Commit im PR-Head und im Integrationsbranch erhalten bleiben; ein normaler Merge besitzt zwei Eltern, von denen der zweite exakt dem PR-Head entspricht. Technische Mergecommits zählen nicht als weitere Auftragscommits.

CI wird über Checkruns und Workflowruns des exakten PR-Heads gelesen. Je Check-/Workflowidentität gilt der neueste Eintrag; ausstehende, abgebrochene oder nicht erfolgreiche Ergebnisse verhindern erfolgreiche Integration. Überschreitet eine Plattformantwort 100 Rohwerte oder das Ergebnis 50 aktuelle Fakten, bricht der Helper verständlich ab. Ausgabe und Prozesse sind zeitlich und in ihrer Größe begrenzt. Fehler geben keine Rohantworten, Credential- oder Remote-URLs aus. Es gibt keine Remotehelper-Aufrufe und kein Lesen/Ausgeben gespeicherter Credentials.

Der Prüfer verwendet keine Shellkommandostrings, Checkout-, Fetch-, Build- oder Testkommandos und führt niemals PR-Code aus. Git-Fsmonitor und Hooks sind für seine Gitaufrufe deaktiviert; Git-Replacementobjekte werden nicht verwendet. Der Default verwendet die vorhandene lokale GitHub-CLI-Anmeldung; es werden keine neuen Runtime-Secrets eingeführt. `verifyOrderGit` bietet einen expliziten Read-Adapter für isolierte Tests; die CLI besitzt keinen Adapterparameter.

## Verifikation und tatsächlicher Plattformnachweis

Worker-Tests verwenden echte D1-Tabellen samt Trigger-Ausfallinjektion und konkurrierenden Schreibversuchen. Helper-Tests erzeugen lokale temporäre Gitrepositorys, normale Mergehistorien und echte Squashverluste; Git wird dabei nicht gemockt. Die Plattformantworten im deterministischen Unit-Test sind synthetisch und keine entfernte CI-Abhängigkeit.

Der zusätzliche tatsächliche Read-only-Smoke am 23. Oktober 2026 prüfte `nexa16/Luufi`, Auftrag `LUUFI-11`, Commit `9ed76647b8de929805b18500152b73d12dadef48` und PR 3: ursprünglicher Commit gepusht/enthalten, normaler Merge `2ba70395173697a7e2f896e38e6e994cb07bd244`, erfolgreiche CI für PR-Head `4eea9707dcdb5e4bc4689b90feb7050a161d963e`. Er erzeugte keine Datenbankänderung. Coverage gehört ausschließlich zum finalen Integrationsgate.
