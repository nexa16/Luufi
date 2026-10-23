---
policy: implementation
version: 1.0.1
language: de
---

# Implementierung und Auslieferung

## Beginn und Freigabe

Nur Codex implementiert. Vor Beginn lädt es die zentralen Richtlinien, Projektregeln, aktuellen Aufträge und relevanten Dokumentationsstand. Default-Integrationsbranch ist `develop`; Produktionsbranch ist projektspezifisch `main` oder `master`.

Codex zeigt die vorgesehenen Auftrags-IDs, Titel und Fassungen. Der Nutzer gibt einzelne Aufträge, eine Auswahl oder den aktuellen Umfang eines Milestones ausdrücklich im Chat frei. Codex speichert konkrete IDs und Fassungen mit einem nachvollziehbaren Freigabeverweis. Spätere Ergänzungen eines Milestones sind nicht eingeschlossen. Die Kennzeichnung bereit ist keine Freigabe.

Vor Beginn prüft Codex die unveränderten Fassungen und Voraussetzungen. Eine Voraussetzung ist erfüllt, wenn sie bereits erledigt ist oder als vollständig geprüfter Auftragscommit im gleichen Implementierungszweig vorliegt. Inhaltliche Änderungen vor Beginn entwerten die betroffene Freigabe. Bedeutungsgleiche Schreibkorrekturen bleiben protokolliert, erweitern aber keinen Umfang.

Beim Beginn wird der Auftrag in Implementierung gesetzt und seine Spezifikation gesperrt. Fortschritt, Probleme, Tests und Nachweise dürfen ergänzt werden. Ein Auftrag besitzt höchstens eine aktive Bearbeitung. Neue Wünsche erzeugen normalerweise Folgeaufträge. Nur ausdrückliches Stoppen und Neuplanen darf den laufenden Umfang ändern.

Eine unterbrochene Runde wird auf Aufforderung des Nutzers unter bestehender Freigabe fortgesetzt, wenn Umfang und Voraussetzungen unverändert bleiben. Kein automatischer Neustart aufgrund abgelaufener Zeit. Ein anderer Bearbeiter übernimmt ausdrücklich und dokumentiert den bisherigen Stand.

## Arbeit und Tests

Code, Tests und betroffene Dokumentation werden gemeinsam bearbeitet. Zuerst die kleinsten relevanten vorhandenen Tests ausführen, dann neue Verhaltenstests neben der Umsetzung entwickeln. Fehlerkorrekturen erhalten einen Test, der den Fehler vorher zeigt. Keine Testanpassung nur zur Bestätigung falschen Verhaltens.

Jedes Kriterium erhält eine primäre geeignete Prüfebene: Unit, Integration, API/MCP, UI oder E2E. Zusätzliche Ebenen nur für einen eigenen Grenzrisikonachweis. Reale Plattformverbindungen und Deployment-Smoke-Prüfungen werden zusätzlich geprüft, aber nicht als deterministische PR-Abhängigkeit eingesetzt.

Nach Stabilisierung folgen Formatierung, Typprüfung und Lint. Lokal werden fokussierte Tests ohne Coverage ausgeführt. Coverage läuft einmal im finalen CI-Gate, ohne zusätzliche vollständige Coverage-Runde davor und ohne doppelte Ausführung derselben Tests mit und ohne Coverage. Es gelten je Suite insgesamt mindestens 80 % Statements und Zeilen, 70 % Funktionen und 60 % Branches. Einzeldatei- und Changed-Module-Gates sowie automatische Ratchet-Erhöhungen entfallen. Alle eigenen ausführbaren Module bleiben im Bericht enthalten; keine Aufteilung oder Ausschlüsse zur Umgehung der Messung. Aussagekräftige Sicherheits-, Konflikt-, Replay- und Datenverlustregressionen bleiben verbindlich.

Änderung in 1.0.1: Der Nutzer hat am 23. Oktober 2026 ausdrücklich weniger Coverage-Wiederholungen und niedrigere Qualitätsgates zugunsten geringeren Prüfaufwands freigegeben. Die veröffentlichte Version 1.0.0 bleibt unverändert erhalten.

Nach Bereinigung und Commit der finalen Historie vollständiges Testgate, Typprüfung, Lint und Produktionsbuild ausführen. Vollständige Gates nur nach ausführbaren Änderungen erneut ausführen; reine Dokumentations- oder Metadatenänderungen entwerten erfolgreiche Codeprüfungen nicht. Akzeptanzkritische Prüfungen dürfen nicht still übersprungen werden.

Manuelle Nutzerabnahme ist keine Abschlussbedingung. Codex prüft bei Bedarf selbst die laufende Anwendung. Subjektive oder nicht prüfbare Aspekte ausdrücklich benennen; spätes Nutzerfeedback ist ein neuer Auftrag und öffnet abgeschlossene Arbeit nicht erneut. Arbeitszeitabrechnung entfällt.

## Ein Auftrag, ein finaler Commit

Jeder final integrierte Auftrag besitzt genau einen Implementierungscommit, einschließlich Code, Tests, Migrationen und relevanter Dokumentation. Beispiel: `feat(LUUFI-12): Projektfeedback mit Anhängen erfassen`. Technische Arbeit verwendet einen passenden konventionellen Typ; die Auftrags-ID muss eindeutig im Commit-Titel stehen.

Zwischencommits sind erlaubt. Fehler und fehlgeschlagene Tests, die vor Integration zum gleichen Auftrag gehören, werden per Fixup beziehungsweise Amend in dessen Commit eingearbeitet. Gemeinsame Vorarbeiten mehrerer Aufträge erhalten eine eigene ID und einen eigenen Commit. Nach Bereinigung gilt die CI dem endgültigen PR-Stand.

Standard ist ein PR pro Runde; dieser darf mehrere auch unabhängige Aufträge enthalten. Eine Aufteilung vor Integration ist möglich. PR-Beschreibung benennt Aufträge, Kriterien-/Testzuordnung, Regressionen, Coverage und Gate-Ergebnisse; unvollständige Vorarbeit wird ausdrücklich getrennt. Kein automatisches Schließen alter GitHub Issues.

Integration ausschließlich per normalem Merge, ohne Squash-Merge und ohne Rebase-Merge. Technische Merge-Commits sind keine weiteren Implementierungscommits eines Auftrags. Es werden nur die erfolgreich geprüften finalen PR-Inhalte integriert. Nach Integration wird gemeinsame Historie nicht umgeschrieben; danach entdeckte Korrekturen sind neue Aufträge, auch innerhalb derselben Arbeitsrunde.

Luufi speichert den endgültigen Auftragscommit, PR und Integrationscommit. Vorläufige SHAs dürfen ersetzt werden und sind keine endgültigen Abschlussnachweise. Implementiert setzt Verifikation, Dokumentation und Push voraus; erledigt setzt nachgewiesene Integration nach `develop` voraus.

## Parallele Umsetzung

Ein koordinierender Agent hält gemeinsame Typen, Schema, Migrationen, Paketdateien, Lockfile und Integrationshistorie zusammen. Bis zu drei Unteragenten dürfen klar abgegrenzte freigegebene Aufträge bearbeiten. Gemeinsame Verträge stehen vorher fest; gemeinsam geänderte Dateien besitzen einen benannten Eigentümer. Isolierte Checkouts vermeiden konkurrierende Änderungen am Git-Index.

Jede Aufgabe enthält Code, Tests und Dokumentation. Der koordinierende Agent integriert die Ergebnisse, stellt einen finalen Commit je Auftrag sicher und führt das vollständige Gate aus. Sicherung, Schemaanwendung und Veröffentlichung erfolgen geordnet. Unteragenten dürfen nicht eigenständig Produktionsveröffentlichungen vornehmen.

## Builds und Releases

Nach einer Runde stellt Codex nach Möglichkeit einen Develop-Build bereit: APK auf Google Drive oder URL einer laufenden Site. Luufi erhält exakten Branch/SHA, enthaltene Aufträge, Link und kurze deutsche Änderungsnotizen. Fehlende Bereitstellung erhält einen Grund und verhindert keinen bereits erreichten Auftragsabschluss.

Produktionsreleases benötigen ausdrückliche Release-Freigabe; diese darf schon im Implementierungsauftrag enthalten sein. Release-Nachweise werden erst nach Prüfung des tatsächlichen Produktionsbranch- und Tag-Stands gespeichert. Nach Deployment Zugriffsschutz, Migrationen, Umgebung und exakten SHA prüfen.

Preview und Produktion besitzen getrennte Sites, D1-Datenbanken und R2-Dateispeicher. Produktion nicht durch Preview-Daten ersetzen. Migrationen zuerst in Preview prüfen. Sicherungen und Wiederherstellungsweg vor Produktionsumstellung nachweisen. Rückfall darf alte GitHub-Schreibaktionen nicht reaktivieren.
