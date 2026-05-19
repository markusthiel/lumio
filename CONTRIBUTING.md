# Contributing to Lumio

Danke, dass du beitragen möchtest!

## Schnellstart

1. Issue lesen oder neues Issue eröffnen, bevor du an größeren Änderungen arbeitest.
2. Fork des Repos, neuer Branch (`feat/dein-feature` oder `fix/dein-fix`).
3. `cp .env.example .env`, `docker compose up -d` — siehe [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
4. Code schreiben, Tests dazu wenn sinnvoll.
5. Pull Request mit klarer Beschreibung.

## Was wir gerne sehen

- **Bug-Fixes** mit reproduzierbarem Testfall
- **Performance-Verbesserungen** mit Vorher/Nachher-Messung
- **Übersetzungen** (sobald i18n drin ist)
- **Dokumentation** — auch kleine Tippfehler-Fixes
- **RAW-Format-Tests** — wenn du eine ungewöhnliche Kamera hast, sind Beispieldateien Gold wert

## Code-Konventionen

- **TypeScript**: strict mode, kein `any` ohne Begründung
- **Python**: PEP 8, type hints, ruff für Linting
- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`)
- **PR-Titel**: gleiche Konvention wie Commits

## Lizenz-Hinweis

Lumio steht unter **AGPL-3.0**. Mit deinem Beitrag stimmst du zu, dass dein Code unter dieser Lizenz veröffentlicht wird.

Falls eine kommerzielle Dual-Lizenz für proprietäre Forks angeboten werden soll, behalten wir uns ein DCO oder CLA für signifikante Beiträge vor — wird diskutiert, sobald das praxisrelevant wird.

## Code of Conduct

Sei freundlich. Sei konkret. Sei geduldig. Wir bauen das hier in unserer Freizeit oder zwischendurch — gegenseitiger Respekt macht das viel angenehmer.

Persönliche Angriffe, Diskriminierung oder Spam führen zum Ausschluss.

## Fragen?

Issue eröffnen oder im Forgejo-Repo unter Discussions schreiben.
