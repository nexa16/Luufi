---
feature: version-views
documentation_policy: 1.0.0
---

# Projektversionen und Bereitstellungsnachweise lesen

## Zweck und Umfang

Die Versionsansichten machen deutsche Änderungsnotizen, den unveränderlichen Auftragsumfang und aufgezeichnete Build-/Releasefakten eines Projektstands lesbar. Die Projektübersicht nennt die letzte als verfügbar beobachtete Version. Öffentlicher Projektstand und tatsächliche Hostingquelle bleiben getrennt erkennbar.

## Nutzerabläufe

**Versionen** in der Projektnavigation öffnet die gespeicherte Sammlung. Ein Eintrag nennt Label, Titel, Channel, Projektbranch, öffentlichen Versionscommit, enthaltene Auftragszahl und Erfassungszeit. Sein Titel öffnet die Details. **Zur Versionsliste** führt zurück.

Die Detailansicht zeigt die deutschen **Änderungen** mit ihren Zeilenumbrüchen. **Enthaltene Aufträge** nennt die eingefrorene Kennung, den damaligen Titel, die Fassung, den finalen Auftragscommit und die Integrationsreferenz. Der Auftragslink führt zu den bestehenden Details einschließlich W5-Nachweisen. Bootstrapprovenienz bleibt ausdrücklich von einem regulären historischen Bearbeitungsclaim getrennt.

**Build- und Verfügbarkeitsbelege** zeigt Site oder APK, Zielumgebung, beobachtetes Ergebnis und Zeitpunkt. Verfügbare Belege besitzen einen sicheren Link. Fehlende oder gescheiterte Bereitstellungen nennen ihren gespeicherten Grund. Der gebaute öffentliche Commit, Hostingquellbranch, Hostingquellcommit und die Quellzuordnungs-/Prüfreferenz werden einzeln ausgewiesen. Das gilt auch dann, wenn der private Sites-Quellbranch `main` heißt und der öffentliche Versionsbranch `develop` ist.

**Produktionsreleasebelege** zeigt konkrete Nutzerfreigabereferenz, Produktionsbranch/-commit, Tagziel, zugeordneten Build, Deploymentreferenz und die von Codex beobachteten Git-/CI-Fakten. Die Ansicht selbst veröffentlicht nichts.

Der Bereich **Letzte verfügbare Version** auf der Projektübersicht zeigt den serverseitig ausgewählten verfügbaren Stand, Site-/APK-Link, Zielumgebung und Beobachtungszeit. Der Versionstitel öffnet dieselben Details. Eine neuere Version ohne verfügbaren Build verdrängt diesen Verweis nicht.

## Regeln und Zustände

Ein Develop-Channel heißt **Develop-Vorschau**. Ein Production-Channel ohne zugeordneten Releasebeleg heißt **Produktionskandidat · kein Releasebeleg**. Ein verfügbarer Produktionsbuild allein macht ihn nicht zum freigegebenen Produktionsrelease. Erst eine gespeicherte Releasezuordnung erhält die Einordnung **Produktion · Release aufgezeichnet**. Der Bereich unterscheidet diese Versionseinordnung von der sachlichen Zielumgebung eines einzelnen Builds.

Buildbelege behalten ihr damaliges Ergebnis: **Als verfügbar beobachtet**, **Nicht verfügbar** oder **Bereitstellung fehlgeschlagen**. Sie sind historische Beobachtungen und keine dauerhafte Erreichbarkeitsgarantie. Neuere Fehler desselben Buildziels entwerten frühere aktuelle Verfügbarkeit; die Auswahl der letzten verfügbaren Version erfolgt über den dafür vorgesehenen Serviceendpunkt. Historische Links behaupten keine erneute Liveprüfung.

Versionsinhalt und Mitgliedschaft werden in diesen Ansichten nicht geändert. Der öffentliche Versionscommit, der tatsächlich gebaute öffentliche Commit und ein gegebenenfalls abweichender privater Sites-Spiegelcommit werden nicht gleichgesetzt. Enthaltensein und Quellzuordnung erscheinen als aufgezeichnete Codexbeobachtungen. Freigabe-, Git-/Tag- und Deploymentnachweise bleiben getrennt; Luufi behauptet keine unabhängige serverseitige GitHub-Prüfung.

## Sonder- und Fehlerfälle

Leere Versionssammlungen, fehlende verfügbare Versionen und leere Auftrags-, Build- oder Releasehistorien haben eigene Leerzustände. Abrufe zeigen ihren Ladezustand und verständliche Fehler. Sammlung und Detailhistorien besitzen unabhängiges **Aktualisieren**, **Weitere laden** und eigene Wiederholungen. Ein Fehler eines Bereichs verhindert nicht das Lesen der anderen.

Ein fehlgeschlagener Folgeabruf erhält bisher geladene Einträge und verwendet beim Wiederholen denselben Cursor. Ein HTTP-409-Konflikt startet über **Liste neu laden** auf der ersten Seite. Doppelte Seiteneinträge werden anhand ihrer stabilen IDs zusammengeführt. Projekt- oder Versionswechsel brechen alte Abrufe ab und blenden verspätete Antworten aus.

Nur absolute HTTP(S)-Referenzen ohne eingebettete Zugangsdaten oder Steuerzeichen sind anklickbar. Unzulässige Schemata, protokollrelative Adressen und andere Referenztexte erscheinen als Text. Externe Links verwenden `noopener noreferrer`. Deutsche Änderungsnotizen und sämtliche Referenzen werden als Text dargestellt, nicht als HTML ausgeführt.

## Grenzen

Die Oberfläche erstellt oder bearbeitet keine Versionen, Builds oder Releasebelege. Sie gibt keine Produktion frei und startet weder Hosting noch APK-Builds. Sie synchronisiert keine Providerdaten und erzeugt keine Links aus beliebigen Commit- oder Repositorytexten. Eine datierte Verfügbarkeitsbeobachtung ersetzt keine neue Liveprüfung.

## Technische Verweise

[`app/versions.tsx`](../../app/versions.tsx) exportiert `VersionCollection({projectId})`, `VersionDetail({projectId, versionId})` und `LatestVersion({projectId})`. Die Seiten unter [`app/projects/[projectId]/versions`](../../app/projects/%5BprojectId%5D/versions/page.tsx) binden Sammlung und Details ein. Die gemeinsame Navigation kommt aus [`components/project-frame.tsx`](../../components/project-frame.tsx), die Datenformen aus [`lib/domain/releases.ts`](../../lib/domain/releases.ts).

Die Ansichten lesen ausschließlich `GET /api/projects/{projectId}/versions`, `/{versionId}`, `/{versionId}/orders`, `/{versionId}/builds`, `/{versionId}/releases` sowie `GET /api/projects/{projectId}/latest-available-version`. Listen liefern `{items, nextCursor}`, die letzte verfügbare Version liefert `{version, build}` oder `null`. Abrufe verwenden `cache: no-store`, JSON-Akzeptanzheader und Abbruchcontroller je Ressource; Fehler folgen `{code, error}`.

## Verifikation

[`tests/ui/versions.test.tsx`](../../tests/ui/versions.test.tsx) prüft Channel-/Kandidatenunterscheidung, Versionsumfang, deutsche Änderungen, getrennte öffentliche/Hosting-SHAs, fehlende Builds und Gründe, Release-/Tag-/CI-Fakten, ältere verfügbare Versionen, sichere Links, unabhängige Pagination/Fehlerbehandlung und Kontextwechsel.

[`tests/e2e/versions.spec.ts`](../../tests/e2e/versions.spec.ts) beschreibt den lokalen synthetischen Desktop-/Handy-Ablauf von der Projektübersicht über die verfügbare Version zu deren Umfang und Quellständen sowie nach Neuladen zurück zur Versionsliste. Die Ausführung erfolgt nach Integration mit den zugehörigen echten lokalen D1-Endpunkten und Seed-Daten. Sie ist kein Produktionsnachweis.
