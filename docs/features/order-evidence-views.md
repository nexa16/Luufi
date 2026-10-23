---
feature: order-evidence-views
documentation_policy: 1.0.0
---

# Freigabe, Bearbeitung und Nachweise lesen

## Zweck und Umfang

Der Nachweisbereich eines Auftrags macht aufgezeichnete Nutzerfreigaben, den aktuellen Bearbeitungsanspruch, Fortschritt, Lebenszyklusereignisse und Prüf-/Gitnachweise lesbar. Er unterscheidet den tatsächlichen Auftragszustand von einer gültigen Freigabe und von einzelnen historischen Prüfergebnissen. Das Lesen löst weder Bearbeitung noch Freigabe aus.

## Nutzerabläufe

Die Auftragsdetails zeigen unter **Freigabe, Bearbeitung und Nachweise** zunächst den aktuellen Freigabe- und Bearbeitungsstand. Eine Freigabe nennt die gebundene Fassung und ihre tatsächliche Gültigkeit. Eine laufende Bearbeitung nennt Bearbeiter, Branch, Generation und Zeitpunkt. **Bearbeitung unterbrochen** bezeichnet einen pausierten Anspruch. **Keine aktive Bearbeitung** sagt nichts über frühere Bearbeitungen aus. Deren Abschluss oder Neuplanung bleibt in den Ereignissen lesbar.

**Freigabesnapshots** zeigt die eingefrorenen Auftragsdaten: Titel, Fassung, Abhängigkeiten, Repository, Integrationsbranch, Bestätigungsreferenz und gegebenenfalls Widerruf oder Entwertung. Eine Milestonefreigabe ist als eingefrorene Auswahl bezeichnet. Ihre angezeigte Gesamtzahl ist die gespeicherte Auswahlgröße, auch wenn sie mehr als 50 Aufträge enthält. Die hier lesbare Momentaufnahme betrifft den geöffneten Auftrag.

**Fortschritt und Hindernisse** zeigt datierte Einträge mit Bearbeitungsgeneration, Text und nächster Aktion. **Lebenszyklusereignisse** zeigt die aufgezeichneten Zustandsübergänge samt Fassung, Anlass, Referenz und Akteur. Zusätzliche strukturierte Ereignisdetails können über die native Aufklappfunktion gelesen werden.

**Prüf- und Gitnachweise** zeigt Kriterienprüfung, Implementierung und Integration getrennt mit ihrem tatsächlichen Ergebnis. Jeder Nachweis enthält Commit, Fassung, Bearbeitungsbezug, Datum, Dokumentationsreferenz und aufgezeichnete Kriterienergebnisse. Vorhandene Gitbeobachtungen ergänzen Repository, Branch, Remote-Referenz, Commitbetreff, Eltern-/Headcommits, Push-/Abstammungsfakten sowie PR- und CI-Ergebnisse. Ein fehlender Build erscheint mit seinem gespeicherten Grund.

Jeder Bereich besitzt eigenes **Aktualisieren**, eigenes Nachladen über **Weitere laden** und eigene Wiederholung bei Fehlern. Die Sammlung von Freigaben, Fortschritt, Ereignissen und Belegen wird unabhängig paginiert.

## Regeln und Zustände

**Bereit** allein ist keine Nutzerfreigabe. Eine gültige Freigabe allein startet keine Arbeit. **Bearbeitung aktiv** und **Bearbeitung unterbrochen** beschreiben den aktuellen Anspruch. Der Auftragszustand **Implementiert** beziehungsweise **Erledigt** bleibt in den vorhandenen Auftragsdetails sichtbar; ein einzelner erfolgreicher Beleg setzt diese Anzeige nicht eigenständig.

Ein Nachweis behält **Erfolgreich**, **Fehlgeschlagen** oder **Nicht verfügbar**. Historische Fehler werden nach einer späteren erfolgreichen Prüfung nicht grün umgedeutet. Ein erfolgreicher Implementierungskandidat wird nur bei passender aktueller Referenz als aktuell gekennzeichnet. Andere erfolgreiche Kandidaten bleiben historisch. Geladene erfolgreiche Ersetzungsbelege nennen ihre Vorgänger; deren Vorgängeranzeige nennt den ersetzenden Beleg. Ein fehlgeschlagener Ersetzungsversuch entwertet keinen erfolgreichen Kandidaten.

Eine noch nicht geladene aktuelle Referenz weist auf weitere Nachweisseiten hin. Fehlt die referenzierte ID nach vollständigem Laden weiterhin, wird sie ausdrücklich als in der Historie nicht verfügbar bezeichnet. Eine Kriterienklassifikation **Manuelle Prüfebene** bleibt von einem automatischen Prüfergebnis unterscheidbar und zeigt ihre hinterlegte Begründungsreferenz.

Die Provenienz lautet **von Codex aufgezeichnet** beziehungsweise **von Codex lokal geprüft**. Luufi speichert diese Fakten innerhalb seiner autorisierten Codex-Verbindung; die Oberfläche behauptet keine unabhängige Laufzeitprüfung durch GitHub.

## Sonder- und Fehlerfälle

Fehlende Freigaben, aktive Bearbeitung, Kriterienergebnisse, Gitbeobachtungen, PRs, CI-Prüfungen und Bereitstellungsangaben erhalten eigene ehrliche Leerzustände. Ein fehlgeschlagener aktueller Abruf verhindert nicht das Lesen historischer Belege. Ein zuvor geladener aktueller Stand wird bei einem späteren Abruffehler als zuletzt geladener Stand bezeichnet; dessen Nachweise erhalten dann keine bestätigten aktuellen Zuordnungsmarkierungen.

Fehler einer Folgeseite erhalten bereits geladene historische Einträge. Die Wiederholung verwendet denselben Cursor. HTTP 409 bezeichnet einen veränderten Lebenszyklusstand; **Liste neu laden** beginnt dann bewusst auf der ersten Seite. Doppelte Seiteninhalte werden anhand ihrer stabilen IDs zusammengeführt. Ein Wechsel von Projekt oder Auftrag bricht alte Abrufe ab und blendet deren Antworten aus.

Referenzen sind nur bei absoluten HTTP(S)-Adressen ohne Zugangsdaten und Steuerzeichen anklickbar. Andere Referenzen, relative Pfade, Commit-SHAs und unzulässige URL-Schemata erscheinen als Text. PR-/CI-Links öffnen mit `noopener noreferrer`. Es werden keine URLs aus beliebigen Repositoryadressen oder Committexten erfunden. Alle Inhalte und strukturierten Details werden als Text gerendert.

## Grenzen

Der Bereich bietet keine Browseraktionen für Freigabe, Start, Pause, Übernahme, Neuplanung, Archivierung oder Belegschreiben. Er startet keine Agenten und synchronisiert nichts mit GitHub. Eine aufgehobene oder historische Freigabe wird durch das Lesen nicht erneuert. Hier sind keine Versionen, Releasefreigaben, Bereitstellungsverwaltung oder Zeiterfassung enthalten. Die Referenz eines Nachweises allein belegt keinen neuen Prüflauf.

## Technische Verweise

[`app/order-evidence.tsx`](../../app/order-evidence.tsx) exportiert `OrderEvidencePanel({projectId, orderId})` zur Einbindung in vorhandene Auftragsdetails. Die Typen stehen in [`lib/domain/execution.ts`](../../lib/domain/execution.ts). Der Bereich verwendet die geschützten lesenden Endpunkte `GET /api/projects/{projectId}/orders/{orderId}/lifecycle`, `/approvals`, `/progress`, `/events` und `/evidence`.

Der erste Endpunkt liefert `LifecycleSummary`, die Historien liefern jeweils `{items, nextCursor}`. Abrufe nutzen `cache: no-store`, JSON-Akzeptanzheader und einen eigenen Abbruchcontroller je Bereich. Fachliche Fehler folgen `{code, error}`. Aktuelle Nachweiszuordnungen stammen aus der Lebenszykluszusammenfassung; die Oberfläche leitet sie nicht allein aus dem Datum oder einem Erfolgstext ab.

## Verifikation

[`tests/ui/order-evidence.test.tsx`](../../tests/ui/order-evidence.test.tsx) prüft fehlende und ungültige Freigaben, eingefrorene Auswahl, unterbrochene Bearbeitung, Fortschritt und Ereignisse, historische Fehler, Git-/PR-/CI-Fakten, Buildgründe, sichere Links, paginierte Ersetzungen, unabhängige Fehlerbehandlung, Cursorneustart und Kontextwechsel.

[`tests/e2e/order-evidence.spec.ts`](../../tests/e2e/order-evidence.spec.ts) beschreibt die lesende Auftragsintegration mit synthetischen lokalen Daten auf Desktop und Handy: erledigter Auftrag, passende Freigabe, kein offener Bearbeitungsanspruch, normaler PR-Merge, CI, Buildgrund und erhaltene Anzeige nach Neuladen. Die Browserprüfung wird nach Integration mit dem zugehörigen lokalen Seed ausgeführt; sie ist kein Produktionsnachweis.
