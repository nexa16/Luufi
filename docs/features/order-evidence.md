---
feature: order-evidence
documentation_policy: 1.0.0
---

# Kriterien-, Implementierungs- und Integrationsnachweise

## Zweck und Umfang

Luufi hält fest, welche Auftragsfassung geprüft wurde, welcher finale Commit sie implementiert und welcher normale Pull-Request-Merge diesen Commit integriert hat. Codex prüft Gitfakten lokal und über schreibgeschützte GitHub-Abfragen und zeichnet sie unter der persönlichen Owner-Anmeldung auf. Luufi prüft die interne Zuordnung und Zustandsregeln; es behauptet keine unabhängige serverseitige Gitverifikation.

## Nutzerabläufe

Nach freigegebener und begonnener Bearbeitung dokumentiert Codex jedes aktuelle Akzeptanzkriterium genau einmal und verlinkt die geprüfte Dokumentation. Ein erfolgreicher Implementierungsnachweis benötigt diese erfolgreiche Prüfung desselben Commits, derselben Fassung und derselben Bearbeitung. Der tatsächliche finale Commit muss gepusht und im Arbeitsbranch enthalten sein. Der Auftrag wird dadurch `implemented`.

Nach normalem PR-Merge prüft Codex den Integrationsbranch, den Erhalt des ursprünglichen Auftragscommits und die erfolgreiche aktuelle CI des PR-Heads. Der Integrationsnachweis setzt den Auftrag atomar auf `done`, schließt seine Bearbeitung und gleicht den Milestoneabschluss ab. Eine noch fehlende Bereitstellung erhält einen ausdrücklichen Grund und verhindert diesen Abschluss nicht. Es gibt keinen verpflichtenden manuellen Abnahmeschritt.

## Regeln und Zustände

Nachweise sind unveränderliche Historieneinträge mit Auftragsfassung, Bearbeitungskennung, Generation, Commit, Kriterien, Dokumentationsverweis und optionaler Gitbeobachtung. Ein erfolgreicher Eintrag verlangt eine aktive aktuelle Bearbeitung und eine weiterhin passende Freigabe. Fehlgeschlagene oder nicht verfügbare Prüfungen dürfen auch während einer Pause aufgezeichnet werden; sie ändern den Lieferstatus nicht.

Erfolg verlangt bestandene Kriterien oder ausdrücklich begründetes `manual-only`. Fehlende, doppelte oder fremde Kriterien werden abgelehnt. Implementierung und Integration müssen den projektspezifischen Repository- und Branchkontext erfüllen. Vor Integration kann ein neuer erfolgreich geprüfter Kandidat den aktuellen nur durch ausdrücklichen `supersedesId`-Verweis ersetzen. Erledigte oder archivierte Aufträge nehmen keine neuen Nachweise an. Technische Wiederholungen bereits gespeicherter Einträge bleiben möglich.

## Sonder- und Fehlerfälle

Veraltete Revisionen, alte Bearbeitungsgenerationen, fremde Aufträge oder nicht passende Prüfungen erzeugen Konflikte beziehungsweise Validierungsfehler. Ein fehlender Commit, Squash-/Rebaseintegration, falscher PR-Kontext, fehlende CI oder aktuelle gescheiterte/ausstehende CI darf keine erfolgreiche Integration erzeugen. Historische Fehler werden durch spätere erfolgreiche Einträge nicht überschrieben.

Nachweis, Statusänderung, Bearbeitungsabschluss, Ereignis, Milestoneabgleich und Wiederholungsergebnis werden gemeinsam gespeichert. Ein Speicherfehler lässt keinen halben Abschluss zurück. Listen sind unabhängig paginiert; zwischenzeitliche Änderungen verlangen einen Neustart der jeweiligen Liste.

## Grenzen

Die Owner-Vertrauensgrenze erlaubt Codex das Aufzeichnen tatsächlicher Prüfergebnisse. Luufi führt selbst weder Gitkommandos noch fremden PR-Code aus und besitzt dafür keine neuen GitHub-Runtime-Credentials, OAuth-Verbindung oder Provider-Synchronisation. Die Gitprüfung startet keine Tests und ersetzt nicht die Kriterien-/Dokumentationsprüfung. Bereitstellungs- und Versionsnachweise sind von der Integration getrennt.

## Technische Verweise

[Nachweispersistenz und lokaler Githelper](../technical/order-evidence.md), `lib/services/order-evidence.ts`, `scripts/verify-order-git.mjs` und die gemeinsamen Typen in `lib/domain/execution.ts`.

## Verifikation

`tests/worker/order-evidence.test.ts` prüft echte D1-Transaktionen, Kriterienzuordnung, Erfolg und Fehler, Kandidatersetzung, Claim-/Freigabekonflikte, Rollback und Pagination. `scripts/verify-order-git.test.ts` verwendet echte temporäre Gitrepositorys für normale Mergehistorien, verlorene Squashcommits und mehrfache Auftragscommits. Ein zusätzlicher schreibgeschützter Live-Smoke prüfte den bereits integrierten LUUFI-11-Commit über GitHub-PR 3 und dessen erfolgreiche CI; dabei wurde kein neuer Lifecycleeintrag gespeichert.
