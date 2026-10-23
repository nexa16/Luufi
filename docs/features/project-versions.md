---
feature: project-versions
documentation_policy: 1.0.0
---

# Projektversionen und Bereitstellungsnachweise

## Zweck und Umfang

Luufi hält nachvollziehbare Projektstände mit deutschen Änderungsnotizen, eingefrorenen Aufträgen und tatsächlichen Bereitstellungsbeobachtungen fest. Ein Label ist frei wählbar und je Projekt und Kanal eindeutig. `develop` bezeichnet Integrationsstände; `production` ist bis zu einem gesonderten Releasebeleg ausdrücklich ein Produktionskandidat.

## Nutzerabläufe

Codex erstellt eine Version aus einer Auswahl von höchstens 50 erledigten Aufträgen oder einem vollständigen, nicht leeren Milestone. Große Milestones werden vollständig erfasst; ihre Mitgliedschaft wird beim Lesen unabhängig paginiert. Titel, Fassung, finaler Auftragscommit und Herkunftsnachweis bleiben als Snapshot erhalten. Eine spätere Änderung des Projektplans ergänzt die Version nicht automatisch.

Zu einer Version zeichnet Codex Site- oder APK-Beobachtungen auf. Verfügbare Builds erhalten einen geschützten beziehungsweise geeigneten HTTP(S)-Link und einen Prüfverweis. Fehlende oder gescheiterte Builds erhalten einen Grund. Die letzte verfügbare Version bleibt sichtbar, wenn eine neuere Version noch keinen verfügbaren Build besitzt.

Eine Produktionsfreigabe ist ein gesonderter Vorgang mit konkreter Nutzerreferenz. Der Releasebeleg verknüpft einen aktuell verfügbaren Produktionsbuild, den exakten Produktionsbranch, Commit und Tag sowie die erfolgreiche aktuelle CI. Das Speichern erzeugt weder ein Deployment noch einen Git-Tag oder eine GitHub-Veröffentlichung.

## Regeln und Zustände

Versionsinhalt und Mitgliedschaft sind nach Erstellung unveränderlich. Neue Build- und Releasebelege erhöhen ausschließlich die Versionsrevision. Mitglieder benötigen eine aktuelle erfolgreiche W5-Integration oder ausdrücklich aufgezeichnete öffentliche Bootstrap-Gitprovenienz. Der private Sites-Proof von LUUFI-1 zählt nicht als öffentlicher Versionsumfang.

Öffentlicher Projektcommit und Hostingquelle sind getrennte Felder. Ein Sites-Spiegel darf einen anderen SHA und Branch haben; seine Zuordnung muss ausdrücklich dokumentiert werden. Ein späterer öffentlicher Buildstand muss die Version nachweislich enthalten. Ein GitHub-Quellbuild muss denselben Quell- und Projektcommit nennen.

Aktuelle Verfügbarkeit wird je Version, Buildart und Umgebung durch die neueste Beobachtungszeit bestimmt; bei gleichem Zeitpunkt gilt der zuletzt gespeicherte Beleg. Eine neue fehlgeschlagene Beobachtung entwertet einen älteren Erfolg desselben Ziels. Historische Nachträge verdrängen keine späteren Beobachtungen. Ein anderer noch verfügbarer Site-/APK- oder Umgebungsbeleg bleibt unabhängig davon gültig. Verfügbarkeit ist eine datierte Beobachtung, keine dauerhafte Erreichbarkeitsgarantie.

## Sonder- und Fehlerfälle

Veraltete Revisionen, doppelte Labels, fremde oder unvollständige Aufträge und unpassende Provenienz erzeugen Fehler. Technische Wiederholungen mit identischem Schlüssel und Inhalt liefern das ursprüngliche Ergebnis. Ein Speicherfehler lässt keine teilweise Version oder Veröffentlichung zurück.

Releasebelege werden bei fehlender Nutzerreferenz, falschem Produktionsbranch, abweichendem Tag-/Branchcommit, falschem CI-Head oder inzwischen nicht mehr verfügbarem Produktionsbuild abgelehnt. Ein Releasebeleg ist unveränderlich und je Version eindeutig. Spätere Buildfehler bleiben zusätzliche Beobachtungen und schreiben den historischen Releasebeleg nicht um.

## Grenzen

Luufi validiert interne Zuordnung und Zustandsregeln unter der persönlichen Owner-Anmeldung. Git-, Hosting- und CI-Fakten werden ausdrücklich von Codex geprüft und aufgezeichnet; es gibt keine unabhängige serverseitige Gitverifikation, automatische Veröffentlichung oder neue Runtime-GitHub-Zugangsdaten. Der lokale Githelper unterstützt zunächst GitHub; andere Provider werden verständlich abgelehnt. Versionsnummern haben keinen Semverzwang.

## Technische Verweise

[Versionen, Buildzuordnung und Releaseprüfung](../technical/project-versions.md), `lib/services/project-versions.ts`, `scripts/verify-release-git.mjs` und die gemeinsamen Typen in `lib/domain/releases.ts`.

## Verifikation

`tests/worker/project-versions.test.ts` prüft echte D1-Snapshots, mehr als 50 Milestonemitglieder, W5-/Bootstrap-Herkunft, Buildzuordnung, aktuelle Verfügbarkeit, Releasegrenzen, Replay und Rollback. `scripts/verify-release-git.test.ts` verwendet echte temporäre Gitrepositorys mit normalen und annotierten Tags sowie negativen Branch-/Ancestry-/CI-Fällen. Der tatsächliche Read-only-Smoke gegen das noch unveränderte Luufi-`main` wurde erwartungsgemäß abgelehnt, weil es den neuen Versionsstand noch nicht enthält; dadurch entstand kein Produktionsrelease.
