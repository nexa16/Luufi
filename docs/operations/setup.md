# Einrichtung und Betrieb

Node ab 22.13 und pnpm 11.25 verwenden. `pnpm install --frozen-lockfile` installiert die festgelegten Abhängigkeiten. `npm run dev` wendet ausschließlich lokale D1-Migrationen an und startet die Entwicklung.

Für lokale Browserprüfungen eine ignorierte `.dev.vars` mit `LUUFI_ENVIRONMENT=local`, `LUUFI_SOURCE_BRANCH=local`, `LUUFI_COMMIT_SHA=0000000000000000000000000000000000000000` und `LUUFI_LOCAL_TEST_MODE=1` anlegen. Nur die lokale Umgebung auf Loopback erhält eine synthetische Testidentität. Diese Einstellungen nie auf eine gehostete Umgebung übertragen.

Gehostete Browser- und MCP-Aufrufe werden durch Sites authentifiziert. Die Anwendung prüft den von Sites gesetzten Benutzerheader; Metadaten liefern keine Identität. Die Site bleibt ausschließlich dem Eigentümer zugänglich. `LUUFI_ENVIRONMENT`, `LUUFI_SOURCE_BRANCH` und `LUUFI_COMMIT_SHA` müssen den tatsächlich veröffentlichten Quellstand beschreiben. Health und Kontext liefern nur geprüfte Identität und Datenbankbereitschaft, keine GitHub-Zugangsvoraussetzung.

Preview und Produktion besitzen getrennte Sites, D1-Datenbanken und private R2-Buckets. Das private Binding BUCKET ist erforderlich; niemals einen Bucket zwischen den Umgebungen teilen. Health kontrolliert die Bindings und erforderlichen Tabellen, der Deployment-Smoke zusätzlich tatsächlichen Medienzugriff. `.openai/hosting.json` dieses Entwicklungsstands verweist auf Preview. Für Produktion dieselbe geprüfte Quelle mit der bestehenden Produktionszuordnung paketieren; keine neue Site und keine andere D1 anbinden. Jede Veröffentlichung verwendet den exakten gepushten Commit und ein daraus erstelltes Buildarchiv. Die Produktion verlangt eine separate Release-Freigabe.

Die bisherigen Migrationsdateien 0000 bis 0004 bleiben unverändert erhalten, damit bereits angewandte Schritte dieselbe Identität behalten. Alt-Tabellen bleiben ungenutzt bestehen. Neue SQL-Migrationen werden angehängt; kein gekürztes Drizzle-Schema zur Erzeugung automatischer Löschmigrationen verwenden.

Vor einer Produktionsumstellung Bestand, angewandte Migrationen und Ideen vollständig sichern. Wiederherstellung in einer isolierten Datenbank mit Vergleich aller IDs und Inhaltswerte prüfen. Backups und Live-Payloads bleiben außerhalb des Repositorys. Ein Rückfall verwendet ausschließlich einen geprüften kompatiblen neuen Build und reaktiviert keine alten GitHub-Schreibaktionen.

Unvollständige Medien werden über das begrenzte native Werkzeug media_cleanup bereinigt. Je Aufruf höchstens50Slots/Objekte; wiederholte neue Aufrufe führen den privaten Scancursor weiter. Bei unklarer Antwort denselben requestKey wiederholen. Nur mindestens24Stunden alte unreferenzierte Objekte werden entfernt; fertige Anhänge bleiben geschützt. Abgelaufene Plätze lassen sich nach aktueller Metadatenabfrage erneut übertragen.
