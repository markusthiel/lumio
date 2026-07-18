**English** · [Deutsch](CONTRIBUTING.de.md)

# Contributing to Lumio

Thanks for wanting to contribute!

## Quick start

1. Read an issue or open a new one before working on larger changes.
2. Fork the repo, new branch (`feat/your-feature` or `fix/your-fix`).
3. `cp .env.example .env`, `docker compose up -d` — see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
4. Write code, add tests where it makes sense.
5. Pull request with a clear description.

## What we like to see

- **Bug fixes** with a reproducible test case
- **Performance improvements** with before/after measurements
- **Translations** — see [Adding a translation](#adding-a-translation)
- **Documentation** — even small typo fixes
- **RAW format tests** — if you have an unusual camera, sample files are worth gold

## Code conventions

- **TypeScript**: strict mode, no `any` without justification
- **Python**: PEP 8, type hints, ruff for linting
- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`)
- **PR titles**: same convention as commits

## License note

Lumio is under the **Functional Source License 1.1 (FSL-1.1-ALv2)** — a *source-available* license (not OSI open source). By contributing, you agree that your code is published under this license.

If a commercial dual license for proprietary forks is to be offered, we reserve the right to a DCO or CLA for significant contributions — to be discussed once it becomes practically relevant.

## Adding a translation

The frontend UI strings live as TypeScript dictionaries in
`apps/frontend/src/lib/i18n/` — no external localization service, just plain files.

To add a new language (example: Czech, `cs`):

1. **Copy `en.ts` to `cs.ts`** in `apps/frontend/src/lib/i18n/` and translate the
   values. Keep every key and the nesting structure exactly as in `en.ts` —
   the `Dict` type only allows string values, and missing keys fall back to English.
2. **Register the locale in `dict.ts`**: add the import, extend the
   `Locale` type (`"en" | "de" | "cs"`) and add the entry to `dictionaries`.
3. **Add the locale to `SUPPORTED`** in `apps/frontend/src/lib/i18n.tsx` so
   cookie/`navigator.language` detection picks it up.
4. **Update the language pickers.** A few components carry the locale union
   and human-readable labels directly. Find them with:
   ```bash
   grep -rn '"en" | "de"' apps/frontend/src
   ```
   (currently `components/gallery/GalleryShell.tsx` and
   `app/studio/settings/page.tsx`) and add your language there.
5. **Verify**: `npx tsc --noEmit` in `apps/frontend` must pass — the type
   system catches missing or extra keys.

Partial translations are fine for a first PR — untranslated keys fall back to
English. Please mention in the PR which sections are still missing.

The docs (`docs/*.md`) follow a separate convention: English is the canonical
`.md`, German lives in `*.de.md`. Additional doc languages are welcome but
please open an issue first so we can agree on the naming scheme.

## Code of conduct

Be kind. Be specific. Be patient. We're building this in our spare time or on the side — mutual respect makes it much more pleasant.

Personal attacks, discrimination or spam lead to exclusion.

## Questions?

Open an issue or post under Discussions on the GitHub repo.
