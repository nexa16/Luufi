import type { OrderSpec, OrderType } from './planning';
export const bootstrapManifestVersion = '1.0.0';
export const bootstrapProjectId = 'bootstrap-luufi-project';
const context = {
  repositoryCommit: '49c400a5e815d88a2837dc5ccd3dd770671f87bf',
  documentationPolicy: '1.0.0',
};
export const bootstrapMilestones = [
  {
    id: 'bootstrap-luufi-foundation',
    title: 'Grundlage und Projektideen',
    description:
      'Nativer Nachweis, bereinigter Neubau und eigenständige Ideen.',
    position: 0,
  },
  {
    id: 'bootstrap-luufi-planning',
    title: 'Projekte und Planung',
    description:
      'Projekte, versionierte Aufträge, Milestones und lesbare Planung.',
    position: 1,
  },
  {
    id: 'bootstrap-luufi-feedback',
    title: 'Feedback und private Medien',
    description: 'Unveränderliche Rückmeldungen, R2-Medien und mobile Eingabe.',
    position: 2,
  },
  {
    id: 'bootstrap-luufi-execution',
    title: 'Freigaben und Nachweise',
    description:
      'Konkrete Freigaben, exklusive Ausführung und tatsächliche Gitbelege.',
    position: 3,
  },
  {
    id: 'bootstrap-luufi-versions',
    title: 'Versionen und Betriebsabschluss',
    description:
      'Unveränderliche Versionen, ehrliche Bereitstellung und geprüfte Wiederherstellung.',
    position: 4,
  },
] as const;
type Definition = {
  title: string;
  type: OrderType;
  goal: string;
  flow: string;
  scope: string;
  criteria: [string, string][];
  test: string;
  docs: string;
  depends: number[];
};
const definitions: Definition[] = [
  {
    title: 'Nativer MCP-Nachweis',
    type: 'technical',
    goal: 'Persönlichen nativen Luufi-Zugriff vor dem Neubau tatsächlich nachweisen.',
    flow: 'Codex liest Richtlinien und Probe, schreibt kontrolliert, wiederholt und prüft Konflikt sowie Anhang.',
    scope:
      'Native Sites-Identität; isolierte Preview-Probe, Richtlinienbytes/-hashes und synthetischer Dateinachweis. Private Proof-Provenienz bleibt getrennt von öffentlicher Git-Historie.',
    criteria: [
      [
        'P-1',
        'Native Lese- und Schreibaufrufe gelingen mit bestätigter Identität.',
      ],
      [
        'P-2',
        'Replay und veraltete Revision sind unterscheidbar und verändern keine fremden Daten.',
      ],
      [
        'P-3',
        'Richtlinien und synthetischer Anhang besitzen überprüfte vollständige Hashes.',
      ],
    ],
    test: 'Tatsächliche native read/write/replay/conflict/guidelines/attachment-Probe; synthetische Daten.',
    docs: 'Plattform- und MCP-Proof-Dokumentation.',
    depends: [],
  },
  {
    title: 'Bereinigte Grundlage',
    type: 'technical',
    goal: 'Eigenständigen deutschen React/Worker-Neubau ohne alte Workflowdienste betreiben.',
    flow: 'Nutzer öffnet geschütztes Luufi; Codex prüft Umgebung, Richtlinien und Integrations-CI.',
    scope:
      'Neue öffentliche Historie, privates Archiv, Sites-Identität, D1, versionierte Richtlinien, branch-/SHA-genaue Health/Banner und sichere CI-/Mergegrundlage.',
    criteria: [
      ['F-1', 'Deutsche Navigation und ehrlicher leerer Projektbereich.'],
      [
        'F-2',
        'Sites-Identität schützt Health/MCP; Probedaten ausschließlich Preview.',
      ],
      [
        'F-3',
        'Kontext, Health und Banner stimmen mit Quelle/SHA/Umgebung überein, ohne alten GitHub-Token.',
      ],
      ['F-4', 'Richtlinienfassungen und exakte UTF-8-Hashes stimmen.'],
      [
        'F-5',
        'Alte Migrationen unverändert; keine Privatdaten oder private Historie im öffentlichen Repository.',
      ],
      [
        'F-6',
        'CI prüft Typen/Tests/Lint/Build; privilegierter Merge führt keinen PR-Code aus und integriert nicht automatisch nach main.',
      ],
    ],
    test: 'UI, Worker/API, Richtlinienhashes, Migrations-/Historienprüfung und Workflowprüfung.',
    docs: 'Plattform, technische Grundlage und Betrieb.',
    depends: [1],
  },
  {
    title: 'Eigenständige Projektideen',
    type: 'feature',
    goal: 'Ideen ohne bestehendes Projekt dauerhaft sammeln, ändern und löschen.',
    flow: 'Nutzer öffnet Ideen, erfasst Titel/Details, liest, bearbeitet und löscht nach Bestätigung.',
    scope:
      'Deutsche unabhängige CRUD-Oberfläche und gemeinsame Browser-/MCP-Persistenz mit Seiten, Revision und dauerhaftem Replay.',
    criteria: [
      ['I-1', 'Deutsche CRUD-Oberfläche auf Desktop und Handy.'],
      ['I-2', 'Titel<=280 und Detail<=4000 mit sicheren Fehlern.'],
      ['I-3', 'Bestands-IDs, Inhalte und Erstellzeit bleiben unverändert.'],
      [
        'I-4',
        'Browser/MCP teilen atomare Revisionen und dauerhafte Wiederholungsschlüssel.',
      ],
      [
        'I-5',
        'Pagination und Replay erzeugen keine Duplikate oder verlorenen Änderungen.',
      ],
      [
        'I-6',
        'Identität und Origin schützen Writes; keine Privatdaten in Fixtures.',
      ],
    ],
    test: 'Domain-/D1-/API-/MCP-CAS, Migrationserhalt und repräsentative Browserabläufe.',
    docs: 'Projektideen fachlich/technisch und Migration.',
    depends: [2],
  },
  {
    title: 'Projekte und gemeinsame Planungspersistenz',
    type: 'technical',
    goal: 'Projekte mit stabiler Konfiguration und eigener Auftragsnummerierung verwalten.',
    flow: 'Codex registriert, liest und aktualisiert Projektkonfiguration; Nutzer liest sie.',
    scope:
      'Eindeutiges dauerhaftes Kürzel, Repository/Branches, relative Dokumentationspfade, atomarer Zähler und gemeinsamer Transaktionskern.',
    criteria: [
      ['P-1', 'Kürzel unveränderlich und Dokumentationspfade relativ.'],
      [
        'P-2',
        'Registrieren/Lesen/Ändern geschützt über gemeinsame Services und MCP.',
      ],
      ['P-3', 'Revision, Actor-/Payload-Replay und vollständiger Rollback.'],
      ['P-4', 'Paginierte konfliktbewusste Listen.'],
      [
        'P-5',
        'Bestehende Ideen/Migrationen unverändert; Bootstrapnummern reserviert.',
      ],
    ],
    test: 'Echte D1-/MCP-/API-Grenzen und Migrationsinventar.',
    docs: 'Projekte und Planungskern.',
    depends: [2, 3],
  },
  {
    title: 'Geordnete Milestones',
    type: 'feature',
    goal: 'Planungsabschnitte explizit und konfliktbewusst ordnen.',
    flow: 'Codex erstellt/bearbeitet offene Milestones und verschiebt vor Anker; erster offener ist nächster.',
    scope:
      'Stabile projektgebundene IDs, Inhalts-/Planrevisionen, atomare Reihenfolge und klare leere Listen.',
    criteria: [
      ['M-1', 'Projektgrenzen und stabile IDs.'],
      ['M-2', 'Revisioniertes Erstellen/Bearbeiten mit Replay.'],
      ['M-3', 'Atomare Reihenfolge und revisionsgebundene Cursor.'],
      ['M-4', 'Geschlossene Ziele geschützt und leere Listen ehrlich.'],
    ],
    test: 'D1-Konkurrenz-/Move-/Rollbacktests und MCP.',
    docs: 'Milestones fachlich/technisch.',
    depends: [4],
  },
  {
    title: 'Versionierte Entwurfsaufträge',
    type: 'feature',
    goal: 'Arbeit mit dauerhaften Kennungen und unveränderlichen Spezifikationsfassungen erfassen.',
    flow: 'Codex erstellt Entwurf mit Titel/Ziel/Herkunft und speichert neue historische Fassungen.',
    scope:
      'Atomare projektweite Nummer, getrennte specVersion/revision, typisierte Spezifikation und paginierte Filter.',
    criteria: [
      [
        'O-1',
        'Eindeutige Nummern ohne Wiederverwendung bei Parallelität/Replay.',
      ],
      ['O-2', 'Historische Spezifikationen unveränderlich.'],
      ['O-3', 'Filter-/Seitenlisten mit Konflikten.'],
      [
        'O-4',
        'Strikte Eingabe und ausschließlich Entwurfsänderung, kein frei beschreibbarer Status.',
      ],
    ],
    test: 'Echte D1-Nummerierungs-, Versions-, Filter- und Rollbackfälle.',
    docs: 'Aufträge fachlich/technisch.',
    depends: [4],
  },
  {
    title: 'Auftragszuordnung und Beziehungen',
    type: 'feature',
    goal: 'Aufträge ohne Veränderung ihrer historischen Spezifikation planen und verknüpfen.',
    flow: 'Codex ordnet in offene Milestones oder unverplant ein und pflegt gerichtete Beziehungen.',
    scope:
      'Explizite Ankerreihenfolge, doppelte CAS-Grenze, projektinterne Beziehungen und Abhängigkeits-DAG.',
    criteria: [
      ['R-1', 'Explizite Reihenfolge/Anker und unverplante Aufträge.'],
      ['R-2', 'Atomare Auftrags-/Planrevision.'],
      ['R-3', 'Kein Fremdprojekt, Selbstbezug oder Abhängigkeitszyklus.'],
      ['R-4', 'Replay/Rollback erhalten Ergebnis und Historie.'],
      [
        'R-5',
        'Aktive/abgeschlossene Aufträge und geschlossene Milestones geschützt.',
      ],
    ],
    test: 'D1-Reindex-/Graph-/Race-/Replaytests und MCP.',
    docs: 'Aufträge, Planung und Beziehungen.',
    depends: [5, 6],
  },
  {
    title: 'Projekt- und Milestone-Leseansichten',
    type: 'feature',
    goal: 'Registrierte Projekte und nächsten Milestone verständlich anzeigen.',
    flow: 'Nutzer liest Projektliste, Übersicht, Konfiguration und geordnete Milestones am Handy/Desktop.',
    scope:
      'Deutsche lesbare Ansichten, Pagination und ehrliche Lade-/Leer-/Fehler-/Wiederholungszustände.',
    criteria: [
      ['V-1', 'Deutsche lesbare Navigation.'],
      ['V-2', 'Projektliste/Detail/Milestones mit ehrlichen Zuständen.'],
      ['V-3', 'Seitennavigation ohne versteckte Auslassung.'],
      ['V-4', 'Keine Browser-Verwaltungsaktionen.'],
    ],
    test: 'Fokussierte UI und synthetischer lokaler D1-Browserablauf in beiden Viewports.',
    docs: 'Projektansichten.',
    depends: [4, 5],
  },
  {
    title: 'Lesbare Aufträge mit Filtern und Historie',
    type: 'feature',
    goal: 'Scope und Historie einzelner Aufträge nachvollziehen.',
    flow: 'Nutzer filtert nach Milestone/Zustand/Typ und liest Spezifikation, Tests, Herkunft und Beziehungen.',
    scope:
      'Liste/Detail mit dauerhafter Kennung, historischen Fassungen und sicherem Kontextwechsel.',
    criteria: [
      ['A-1', 'Filter/Pagination einschließlich unverplant.'],
      ['A-2', 'Detail mit Status, Spezifikation, Historie und Beziehungen.'],
      ['A-3', 'Deutsche mobile Darstellung und keine veralteten Antworten.'],
    ],
    test: 'UI und repräsentative echte lokale D1-Browserabläufe.',
    docs: 'Projektansichten/Aufträge.',
    depends: [6, 7, 8],
  },
  {
    title: 'Projektfeedback und Refinementquellen',
    type: 'feature',
    goal: 'Beobachtungen unveränderlich sammeln und Verarbeitung nachvollziehen.',
    flow: 'Nutzer speichert Original und Ergänzungen; Codex dokumentiert versiongebundenes Refinement mit Quellen.',
    scope:
      'Projektgebundene Originaltexte/Slots, append-only Ergänzungen, Inhaltsrevision und viele-zu-viele Auftragsquellen.',
    criteria: [
      ['F-1', 'Originaltext exakt, <=20000 Zeichen und zehn Slots je Eintrag.'],
      ['F-2', 'Ergänzungen mit atomarem CAS/Replay.'],
      ['F-3', 'Projektgebundene Seiten und Browser-/MCP-Schutz.'],
      [
        'F-4',
        'Refinement nennt Repository/Richtlinien/Inhaltsrevision und Aufträge, Fragen oder begründete Entscheidung.',
      ],
      [
        'F-5',
        'Mehrere Quellen in beide Richtungen; neue Inhalte erfordern erneutes Refinement.',
      ],
    ],
    test: 'D1-Persistenz/Race/Rollback/Cursor und HTTP-/MCP-Identität/Origin/JSON.',
    docs: 'Feedback fachlich/technisch.',
    depends: [4, 6],
  },
  {
    title: 'Private Medien und sichere Wiederholung',
    type: 'feature',
    goal: 'Anhänge privat speichern, ohne bei Uploadfehlern den Text zu verlieren.',
    flow: 'Nutzer lädt reservierte Datei hoch, wiederholt unterbrochenen Upload und liest geschützt Vorschau/Download.',
    scope:
      'Strukturelle Format-/Größenprüfung, privates R2, CAS/Replay, Videobereiche und begrenzte sichere Bereinigung.',
    criteria: [
      ['M-1', 'JPEG/PNG/WebP<=10MB und MP4/MOV/WebM<=15MB tatsächlich prüfen.'],
      ['M-2', 'Private Objekte, sichere Header/Download und Range.'],
      ['M-3', 'Byte-/Actor-Replay und unveränderliche fertige Bytes.'],
      [
        'M-4',
        'Pending/expired wiederholbar, 24h-Cleanup erhält fertige Referenzen.',
      ],
      ['M-5', 'MCP-Dateistücke<=64KiB ohne beliebiges Bucket-/SQL-Werkzeug.'],
    ],
    test: 'Formatunits und echte D1/R2-/HTTP-/MCP-Race-/Unterbrechungsfälle.',
    docs: 'Medien und Betriebsbereinigung.',
    depends: [10],
  },
  {
    title: 'Mobile Feedbackeingabe und Uploadfortschritt',
    type: 'feature',
    goal: 'Projektbeobachtungen mit getrennt sichtbarem Text-/Dateistatus mobil erfassen.',
    flow: 'Nutzer speichert Text, beobachtet seriellen Upload, lädt neu und setzt fehlende Slots ohne neuen Text fort.',
    scope:
      'Deutsche Feedbacklisten/Details, echter Bytefortschritt, technische Wiederholung, geschützte Vorschau und sichere Routewechsel.',
    criteria: [
      [
        'U-1',
        'Originale/Ergänzungen/Refinements/Quellen paginiert deutsch lesen.',
      ],
      [
        'U-2',
        'Text/Slots vor Upload; Bytefortschritt und Serverprüfung unterscheiden.',
      ],
      ['U-3', 'Unklare Antworten/Reload sicher wiederholen ohne Textduplikat.'],
      [
        'U-4',
        'Geschützte Vorschau/Download; fertige Dateien bei weiteren Fehlern bewahren.',
      ],
      [
        'U-5',
        'Projektwechsel und neue Eingaben übernehmen keine fremden/laufenden Antworten.',
      ],
    ],
    test: 'UI-Netz-/Replay-/Kontextfälle und Desktop-/Handy-D1/R2-Browserprüfung.',
    docs: 'Feedbackansichten.',
    depends: [10, 11],
  },
  {
    title: 'Freigabe und exklusive Auftragsbearbeitung',
    type: 'feature',
    goal: 'Konkrete Nutzerfreigaben und genau eine Bearbeitung mit Fortschritt dokumentieren.',
    flow: 'Codex stellt bereit, friert Freigabe ein, beginnt, pausiert/übernimmt/stoppt und ergänzt Hindernis mit nächster Aktion.',
    scope:
      'Version-/Voraussetzungssnapshot, Claim/CAS/Generation, Stop/Replan, Archivierung und atomarer Milestoneabschluss.',
    criteria: [
      ['L-1', 'Bereit ist keine Freigabe; konkreter Scope bindet Bestätigung.'],
      [
        'L-2',
        'Vollständiger Milestone/konkrete Auswahl ohne spätere implizite Mitglieder.',
      ],
      ['L-3', 'Ein Claim; alte Generationen nach Übernahme unwirksam.'],
      [
        'L-4',
        'Laufender Scope gesperrt; neue Freigaben ersetzen ältere betroffene Bindungen.',
      ],
      [
        'L-5',
        'Voraussetzung done oder geprüfter gepushter Vorgänger desselben Branchs.',
      ],
      [
        'L-6',
        'Nicht leere erfüllte Milestones atomar schließen; leere nur bestätigt.',
      ],
    ],
    test: 'D1-Übergänge, Snapshot>50, Claim-/Widerruf-/Generationraces, Replay/Rollback.',
    docs: 'Auftragsbearbeitung fachlich/technisch.',
    depends: [4, 5, 6, 7],
  },
  {
    title: 'Tatsächliche Gitprüfung und Abschlussnachweise',
    type: 'technical',
    goal: 'Geprüfte gepushte Arbeit von erhaltener normaler Integration unterscheiden.',
    flow: 'Codex prüft read-only lokale/Remote-/PR-/CI-Fakten und speichert versiongebundene Beobachtungen.',
    scope:
      'Ein finaler Kandidat je Auftrag, Claim-/Kriterienbelege, normaler Merge, tatsächlicher Remotehead und ehrliche Codex-Provenienz.',
    criteria: [
      ['E-1', 'Kriterien/Dokumentation binden Scope/Claim/Generation/Commit.'],
      ['E-2', 'Ein aktueller finaler Kandidat mit Ersetzungshistorie.'],
      [
        'E-3',
        'Remotehead/Ancestry/eine Commitzuordnung tatsächlich prüfen, kein Checkout/PR-Code/Fetch.',
      ],
      [
        'E-4',
        'Done nur erhaltener normaler Merge zum Integrationsbranch mit passender aktueller CI.',
      ],
      [
        'E-5',
        'Fehler historisch; fehlender Buildgrund verhindert Integration nicht.',
      ],
      ['E-6', 'Codex-Beobachtung statt erfundener Runtime-Serververifikation.'],
    ],
    test: 'Echte Gitfixtures und D1-CAS/Scope-/Claim-/Rollback-/Integrationsfälle.',
    docs: 'Nachweise und Githelperbetrieb.',
    depends: [13],
  },
  {
    title: 'Lesbare Freigaben, Fortschritt und Nachweise',
    type: 'feature',
    goal: 'Nutzer sieht aktuelle und historische Freigabe-/Ausführungs-/Gitbelege klar getrennt.',
    flow: 'Nutzer liest im Auftragsdetail Freigaben, Claim, Notizen, Prüfung, Commit/PR/CI und fehlenden Buildgrund.',
    scope:
      'Deutsche reine Leseansicht mit getrennten Seiten, Kontextwechsel und sicheren Referenzlinks.',
    criteria: [
      [
        'N-1',
        'Bereit/freigegeben/aktiv/unterbrochen/implementiert/erledigt trennen.',
      ],
      ['N-2', 'Ungültige Freigaben, alte Kandidaten und Fehler ehrlich.'],
      ['N-3', 'Historien paginiert mit Lade-/Retry-/Routewechsel.'],
      ['N-4', 'Sichere Beleglinks und fehlender Buildgrund mobil lesbar.'],
      ['N-5', 'Bestehende Navigation erhalten, keine Browsermutation.'],
    ],
    test: 'UI-Sicherheits-/Statusfälle und synthetischer lokaler D1-Browserablauf.',
    docs: 'Nachweisansichten.',
    depends: [13, 14],
  },
  {
    title: 'Versionen, Änderungen, Builds und Releases',
    type: 'feature',
    goal: 'Unveränderliche Projektstände und tatsächliche Bereitstellungen nachvollziehen.',
    flow: 'Codex erstellt Version aus erledigten Aufträgen, dokumentiert Builds und nach gesonderter Freigabe reale Releasefakten.',
    scope:
      'Scope-Snapshot, deutsche Änderungen, Public-/Hosting-SHA-Trennung, neueste beobachtete Verfügbarkeit und separate Produktionsnachweise.',
    criteria: [
      [
        'PV-1',
        'Versionsinhalt/Mitgliedschaft unveränderlich, vollständige belegte done-Aufträge.',
      ],
      [
        'PV-2',
        'Builds datiert append-only, Fehler entwertet dasselbe Ziel ehrlich.',
      ],
      ['PV-3', 'Public-/Hostingcommit und Abbildung getrennt.'],
      [
        'PV-4',
        'Release nur mit ausdrücklicher Produktionsfreigabe, passendem Build/Branch/Tag/CI.',
      ],
      [
        'PV-5',
        'CAS/Replay/Rollback, Quellen/Seiten und neueste verfügbare Version konsistent.',
      ],
    ],
    test: 'D1-Snapshots/Verfügbarkeits-/Releasegrenzen und echte read-only Git-/Tagfixtures.',
    docs: 'Versionen fachlich/technisch und Releasehelper.',
    depends: [14],
  },
  {
    title: 'Versionen und Bereitstellungen lesen',
    type: 'feature',
    goal: 'Projektversionen und verfügbare Builds mobil verständlich lesen.',
    flow: 'Nutzer öffnet Versionen, liest Änderungen, enthaltene Aufträge, Builds/Releases und letzte verfügbare Version.',
    scope:
      'Deutsche Leseansichten mit unabhängigen Seiten, sicheren Site-/APKLinks und ehrlichem Produktionskandidatstatus.',
    criteria: [
      ['VV-1', 'Version/Scope/Änderungen und Public-/Hosting-SHA klar.'],
      [
        'VV-2',
        'Produktionskandidat nicht als veröffentlichte Produktion ausgeben.',
      ],
      ['VV-3', 'Pagination/Fehler/Retry/Abort beim Projektwechsel.'],
      [
        'VV-4',
        'Ältere verfügbare Version bleibt trotz neuer unverfügbarer sichtbar.',
      ],
    ],
    test: 'Fokussierte UI und Desktop-/Handy-Browserprüfung mit synthetischen Daten.',
    docs: 'Versionsansichten.',
    depends: [16],
  },
  {
    title: 'Bootstrap und geprüfte Wiederherstellung',
    type: 'technical',
    goal: 'Tatsächliche Neubauprovenienz ohne erfundene Claims übernehmen und Kerndatenverlust verhindern.',
    flow: 'Codex inventarisiert Bestand, liefert tatsächliche Proofs1–18 und prüft private Sicherung durch isolierten Restore.',
    scope:
      'Festes Manifest1–18 mit getrennten historischen Proofs, kollisionssicherer atomarer Abgleich und lokaler allowlist-basierter Wiederherstellungsnachweis.',
    criteria: [
      [
        'B-1',
        'Feste IDs/Fassungen/Scopes; bestehende abweichende Daten konfliktieren.',
      ],
      [
        'B-2',
        'Sites-Proof1 von öffentlichen Gitproofs2–18 trennen; keine erfundene Freigabe/Claims.',
      ],
      [
        'B-3',
        'Idempotenter atomarer Abgleich und Zähler>=19, spätere echte Arbeit bewahren.',
      ],
      [
        'B-4',
        'Allowlisted Vollrows, Migrations-/Medienhashes und echte SQLite-Wiederherstellung prüfen.',
      ],
      [
        'B-5',
        'Keine OAuth-/Token-/Cacheinhalte als neue Appdaten, keine Live-Daten in öffentlichen Fixtures.',
      ],
    ],
    test: 'D1-Abgleich/Race/Replay/Rollback und echte SQLite-/Datei-Hashfixtures; tatsächlicher privater Restore separat durch Koordinator.',
    docs: 'Bootstrap und Wiederherstellungsbetrieb.',
    depends: [16, 17],
  },
];
export const bootstrapOrders = definitions.map((definition, index) => {
  const number = index + 1,
    group =
      number <= 3
        ? 0
        : number <= 9
          ? 1
          : number <= 12
            ? 2
            : number <= 15
              ? 3
              : 4,
    start = [1, 4, 10, 13, 16][group];
  const spec: OrderSpec = {
    title: definition.title,
    goal: definition.goal,
    origin: `Ausdrücklich freigegebener Luufi-Neubau, Bootstrap LUUFI-${number} v1.`,
    problem: definition.goal,
    scope: definition.scope,
    exclusions:
      'Keine automatische Implementierung, keine GitHub-Issue-/Project-Synchronisation, keine Produktionsfreigabe oder Arbeitszeiterfassung. Umfang bleibt auf diesen Bootstrapauftrag begrenzt.',
    flows: definition.flow,
    criteria: definition.criteria.map(([id, text]) => ({ id, text })),
    testStrategy: definition.test,
    prerequisites: definition.depends.length
      ? definition.depends.map((n) => `LUUFI-${n}`).join(', ')
      : 'Keine; technischer vorgeschalteter Nachweis.',
    documentation: definition.docs,
    context: { ...context },
    sources: [
      `docs/operations/bootstrap-orders.md — LUUFI-${number} v1`,
      'Zentrale Richtlinien: Planung/Dokumentation1.0.0; Implementierung/Datenzugriff1.0.1.',
    ],
  };
  return {
    id: `bootstrap-luufi-order-${number}`,
    number,
    type: definition.type,
    milestoneId: bootstrapMilestones[group].id,
    position: number - start,
    spec,
  };
});
