**English** · [Deutsch](VERSIONING.de.md)

# Versioning

Lumio follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

The version is above all a **signal to self-hosters** about how risky an update is – because they update manually via `git pull` + `docker compose up`.

## The three positions

| Position | Example | Meaning | Self-hoster action |
|--------|----------|-----------|--------------------------|
| **PATCH** | 0.9.0 → 0.9.**1** | bugfix, backward compatible | just pull + deploy |
| **MINOR** | 0.**9** → 0.**10**.0 | new feature, backward compatible (e.g. a new *optional* env with a default) | just pull + deploy |
| **MAJOR** | 0.x → **1**.0.0 | breaking change | manual intervention per the upgrade notes |

### The one rule of thumb

> After the `git pull`, does the self-hoster have to touch anything in `.env`, the Compose command or the DB, or it breaks?
> **Yes → MAJOR.** Otherwise MINOR (feature) or PATCH (fix).

Examples of breaking changes (MAJOR):
- renamed or new **mandatory** env variables
- a changed Compose invocation (e.g. the `--profile wildcard` refactor)
- removed features or endpoints
- a DB migration that doesn't run through cleanly automatically

## Pre-1.0

We're at `0.x`. This deliberately signals: structurally things can still move. Breaking changes are still clearly marked in `CHANGELOG.md` under **⚠️ Upgrade notes**. We'll set `1.0.0` when we want to promise stability.

## Single source of truth

The canonical version lives in **`/VERSION`** (repo root). Derived from it:

- `apps/api/src/version.ts` → `LUMIO_VERSION` (in `/health` and `/meta`)
- `apps/worker/version.py` → `__version__` (startup log)
- `version` in the workspaces' `package.json`

These files are **not edited by hand** but kept in sync by the bump script. A set `LUMIO_VERSION` env overrides the built-in value at runtime (e.g. for CI-stamped images).

## Release flow

```bash
# 1. Bump the version (syncs all files + creates a Git tag)
./scripts/bump-version.sh 0.10.0

# 2. CHANGELOG.md: move entries from [Unreleased] into the new section,
#    for breaking changes add a "⚠️ Upgrade notes" block.

# 3. Push commit + tag
git push && git push --tags
```

Afterwards create a release from the tag in Forgejo (the changelog section as release notes). Self-hosters see the running version in the studio footer and under `GET /health`.

## Marketing sites

`lumio-app-de` and `lumio-cloud-de` are rolling-deployed content and need **no** SemVer. Versioning concerns only the app (`lumio`).
