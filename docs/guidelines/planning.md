---
policy: planning
version: 1.0.0
language: de
---

# Planung und Refinement

## Quellen und Zuständigkeit

Luufi verwaltet zentral Feedback, Aufträge, Milestones und Auslieferungsnachweise. GitHub Issues und Projects sind für den neuen Prozess keine Quellen der Wahrheit. Repository-Code, Tests und branchbezogene Dokumentation belegen den tatsächlichen Produktstand. Nur Codex implementiert und nur nach ausdrücklicher Freigabe.

Die eigenständige Sammlung Projektideen bleibt von Feedback bestehender Projekte getrennt. Ideen werden nicht automatisch in Projekte oder Aufträge umgewandelt. Zunächst verwaltet Codex die Projektplanung über MCP; die deutsche Oberfläche zeigt sie an und erlaubt Feedback. Eine spätere KI in Luufi muss dieselben Regeln verwenden.

## Feedback

Jede Eingabe gehört zu genau einem bestehenden Projekt. Originaltext bleibt erhalten; neue Texte und Medien sind datierte Ergänzungen. Eine Eingabe kann mehrere Aufträge erzeugen, mehrere Eingaben können denselben Auftrag begründen. Quellen bleiben verknüpft.

Refinement berücksichtigt die Dokumentation des Integrationsbranches, den konkreten gelesenen Commit, offene Aufträge und bereits implementierte, noch nicht integrierte Arbeit. Es klassifiziert nicht allein anhand von Formulierungen. Codex prüft Überschneidungen, Abhängigkeiten und Konflikte, bevor es neue Aufträge anlegt.

Ein dokumentiertes Refinement-Ergebnis benennt entstandene oder ergänzte Aufträge, offene Fragen, eine begründete Zurückstellung oder Verwerfung. Damit gilt die Eingabe als verarbeitet; das bedeutet keine Implementierungsfreigabe und keine Erledigung der Wünsche. Neue Ergänzungen markieren erneuten Refinement-Bedarf. Ohne Refinement darf Feedback unverarbeitet gesammelt bleiben.

## Auftragsstruktur

Typen: Feature, Verbesserung, Fehlerbehebung, technische Arbeit. Alle folgen demselben Lebenszyklus.

Ein Entwurf enthält mindestens Titel, Ziel und Herkunft. Ein bereiter Auftrag enthält:

1. Nutzerproblem und gewünschtes beobachtbares Ergebnis.
2. Umfang und ausdrückliche Ausschlüsse.
3. Relevante Nutzerabläufe und überprüfbare Kriterien mit stabilen Kriterienkennungen.
4. Teststrategie unmittelbar nach den Kriterien, einschließlich betroffener Regressionen und Risiken.
5. Voraussetzungen und Beziehungen.
6. Herkunft aus Feedback oder früheren Aufträgen.
7. Betroffene Dokumentation und verwendeten Projektkontext.

Fehlende, nicht relevante Abschnitte mit kurzer Begründung kennzeichnen, statt künstliche Inhalte zu erfinden. Ein Auftrag muss als ein zusammenhängender Commit überprüfbar sein. Zu große oder sachlich getrennte Änderungen vor Freigabe aufteilen; echte gemeinsame Vorarbeiten als eigenen technischen Auftrag führen.

## Kennungen und Zustände

Jedes Projekt hat ein dauerhaftes eindeutiges Kürzel. Aufträge erhalten zentral und atomar `KÜRZEL-NUMMER`, etwa `LUUFI-12`. Nummern sind positive, fortlaufend vergebene Ganzzahlen. Kennungen bleiben bei Typ-, Status- oder Milestone-Änderungen unverändert und werden auch nach Archivierung nie wiederverwendet. Bootstrap-Kennungen im freigegebenen Neuaufbauplan werden bei späterer Übernahme erhalten; anschließend setzt der zentrale Zähler oberhalb der reservierten Nummern fort.

| Zustand | Bedeutung |
| --- | --- |
| Entwurf | Ziel erfasst, Informationen oder Entscheidungen fehlen noch |
| Bereit | Umfang, Kriterien, Tests und Voraussetzungen geklärt |
| In Implementierung | Codex bearbeitet die ausdrücklich freigegebene Fassung |
| Implementiert | Geprüfte und dokumentierte Umsetzung auf Branch gepusht |
| Erledigt | Nachweislich in den Integrationsbranch übernommen |
| Archiviert | Verworfen, ersetzt oder abgebrochen, jeweils mit Grund |

Beim beauftragten Refinement darf Codex eindeutige Dopplungen zusammenführen, Arbeit aufteilen und hinreichend geklärte Aufträge als bereit markieren. Widersprüchliche Wünsche, veränderte Ziele und unklare Entscheidungen legt es dem Nutzer vor. Es gibt keinen eigenen Blocker-Status. Hindernisse während der Umsetzung erhalten eine Fortschrittsnotiz mit nächster Aktion.

Beziehungen: abhängig von, verwandt mit, entstanden aus, ersetzt. Aufträge müssen eindeutig abgegrenzt, aber nicht vollständig unabhängig sein. Abgeschlossene Spezifikationen sind unveränderliche Historie; neue Wünsche erzeugen Folgeaufträge.

## Milestones

Milestones und ihre Aufträge haben ausdrückliche Reihenfolgen. Termine sind optional; zusätzliche Prioritätsstufen entfallen zunächst. Arbeit darf unverplant bleiben. Die erste offene Position bestimmt den nächsten Milestone.

Abhängigkeiten dürfen durch frühere Milestones oder vorherige geprüfte Auftragscommits derselben Runde erfüllt werden. Eine gemeinsame Milestone-Zuordnung ersetzt keine Prüfung der Ausführungsreihenfolge.

Ein nicht leerer Milestone schließt, sobald alle nicht archivierten enthaltenen Aufträge erledigt sind. Entwürfe verhindern den Abschluss. Leere Milestones schließen nicht automatisch. Neue Arbeit wird nicht stillschweigend in abgeschlossene Milestones aufgenommen. Milestone-Zuordnung und Vollständigkeit einer Planung sind keine Implementierungsfreigabe.
