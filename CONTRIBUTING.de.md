[English](CONTRIBUTING.md) · **Deutsch**

# Contributing to Lumio

Danke, dass du beitragen möchtest!

## Schnellstart

1. Issue lesen oder neues Issue eröffnen, bevor du an größeren Änderungen arbeitest.
2. Fork des Repos, neuer Branch (`feat/dein-feature` oder `fix/dein-fix`).
3. `cp .env.example .env`, `docker compose up -d` — siehe [docs/DEVELOPMENT.md](docs/DEVELOPMENT.de.md).
4. Code schreiben, Tests dazu wenn sinnvoll.
5. Pull Request mit klarer Beschreibung.

## Was wir gerne sehen

- **Bug-Fixes** mit reproduzierbarem Testfall
- **Performance-Verbesserungen** mit Vorher/Nachher-Messung
- **Übersetzungen** — siehe [Eine Übersetzung hinzufügen](#eine-übersetzung-hinzufügen)
- **Dokumentation** — auch kleine Tippfehler-Fixes
- **RAW-Format-Tests** — wenn du eine ungewöhnliche Kamera hast, sind Beispieldateien Gold wert

## Code-Konventionen

- **TypeScript**: strict mode, kein `any` ohne Begründung
- **Python**: PEP 8, type hints, ruff für Linting
- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`)
- **PR-Titel**: gleiche Konvention wie Commits

## Lizenz-Hinweis

Lumio steht unter der **Functional Source License 1.1 (FSL-1.1-ALv2)** — einer *source-available* Lizenz (nicht OSI-Open-Source). Mit deinem Beitrag stimmst du zu, dass dein Code unter dieser Lizenz veröffentlicht wird.

Falls eine kommerzielle Dual-Lizenz für proprietäre Forks angeboten werden soll, behalten wir uns ein DCO oder CLA für signifikante Beiträge vor — wird diskutiert, sobald das praxisrelevant wird.

## Eine Übersetzung hinzufügen

Die UI-Texte des Frontends liegen als TypeScript-Dictionaries in
`apps/frontend/src/lib/i18n/` — kein externer Lokalisierungsdienst, nur einfache Dateien.

Neue Sprache hinzufügen (Beispiel: Tschechisch, `cs`):

1. **`en.ts` nach `cs.ts` kopieren** (in `apps/frontend/src/lib/i18n/`) und die
   Werte übersetzen. Alle Keys und die Verschachtelung exakt wie in `en.ts`
   lassen — der `Dict`-Typ erlaubt nur String-Werte, fehlende Keys fallen auf
   Englisch zurück.
2. **Locale in `dict.ts` registrieren**: Import ergänzen, den `Locale`-Typ
   erweitern (`"en" | "de" | "cs"`) und den Eintrag zu `dictionaries` hinzufügen.
3. **Locale in `SUPPORTED` aufnehmen** (in `apps/frontend/src/lib/i18n.tsx`),
   damit Cookie-/`navigator.language`-Erkennung greift.
4. **Sprach-Umschalter aktualisieren.** Einige Komponenten tragen die
   Locale-Union und die Anzeigenamen direkt. Fundstellen:
   ```bash
   grep -rn '"en" | "de"' apps/frontend/src
   ```
   (aktuell `components/gallery/GalleryShell.tsx` und
   `app/studio/settings/page.tsx`) — dort die neue Sprache ergänzen.
5. **Prüfen**: `npx tsc --noEmit` in `apps/frontend` muss durchlaufen — das
   Typsystem fängt fehlende oder überzählige Keys.

Teilübersetzungen sind für einen ersten PR völlig okay — nicht übersetzte Keys
fallen auf Englisch zurück. Bitte im PR erwähnen, welche Bereiche noch fehlen.

Die Doku (`docs/*.md`) folgt einer eigenen Konvention: Englisch ist die
kanonische `.md`, Deutsch liegt in `*.de.md`. Weitere Doku-Sprachen sind
willkommen — bitte vorher ein Issue eröffnen, damit wir das Namensschema abstimmen.

## Code of Conduct

Sei freundlich. Sei konkret. Sei geduldig. Wir bauen das hier in unserer Freizeit oder zwischendurch — gegenseitiger Respekt macht das viel angenehmer.

Persönliche Angriffe, Diskriminierung oder Spam führen zum Ausschluss.

## Fragen?

Issue eröffnen oder im Forgejo-Repo unter Discussions schreiben.
