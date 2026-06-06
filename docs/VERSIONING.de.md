[English](VERSIONING.md) · **Deutsch**

# Versionierung

Lumio folgt [Semantic Versioning](https://semver.org/lang/de/):
`MAJOR.MINOR.PATCH`.

Die Version ist vor allem ein **Signal an Self-Hoster**, wie riskant ein Update
ist – denn die updaten manuell per `git pull` + `docker compose up`.

## Die drei Stellen

| Stelle | Beispiel | Bedeutung | Aktion des Self-Hosters |
|--------|----------|-----------|--------------------------|
| **PATCH** | 0.9.0 → 0.9.**1** | Bugfix, abwärtskompatibel | nur Pull + Deploy |
| **MINOR** | 0.**9** → 0.**10**.0 | neues Feature, abwärtskompatibel (z.B. neue *optionale* Env mit Default) | nur Pull + Deploy |
| **MAJOR** | 0.x → **1**.0.0 | Breaking Change | manueller Eingriff laut Upgrade-Hinweisen |

### Die eine Faustregel

> Muss der Self-Hoster nach dem `git pull` irgendetwas an `.env`, am
> Compose-Befehl oder an der DB anfassen, sonst bricht es?
> **Ja → MAJOR.** Sonst MINOR (Feature) bzw. PATCH (Fix).

Beispiele für Breaking Changes (MAJOR):
- umbenannte oder neue **pflichtige** Env-Variablen
- geänderter Compose-Aufruf (z.B. das `--profile wildcard`-Refactor)
- entfernte Features oder Endpoints
- DB-Migration, die nicht automatisch sauber durchläuft

## Pre-1.0

Wir stehen bei `0.x`. Das signalisiert bewusst: strukturell kann sich noch
etwas bewegen. Breaking Changes werden trotzdem klar im `CHANGELOG.md` unter
**⚠️ Upgrade-Hinweise** markiert. `1.0.0` setzen wir, wenn wir Stabilität
zusagen wollen.

## Single Source of Truth

Die kanonische Version steht in **`/VERSION`** (Repo-Root). Daraus abgeleitet:

- `apps/api/src/version.ts` → `LUMIO_VERSION` (in `/health` und `/meta`)
- `apps/worker/version.py` → `__version__` (Startup-Log)
- `version` in den `package.json` der Workspaces

Diese Dateien werden **nicht von Hand** editiert, sondern durch den Bump-Script
synchron gehalten. Eine gesetzte `LUMIO_VERSION`-Env übersteuert zur Laufzeit
den eingebauten Wert (z.B. für CI-gestempelte Images).

## Release-Ablauf

```bash
# 1. Version anheben (synchronisiert alle Dateien + legt Git-Tag an)
./scripts/bump-version.sh 0.10.0

# 2. CHANGELOG.md: Einträge aus [Unreleased] in den neuen Abschnitt ziehen,
#    bei Breaking Changes einen "⚠️ Upgrade-Hinweise"-Block ergänzen.

# 3. Commit + Tag pushen
git push && git push --tags
```

Anschließend in Forgejo aus dem Tag ein Release erstellen (Changelog-Abschnitt
als Release-Notes). Self-Hoster sehen die laufende Version im Studio-Footer und
unter `GET /health`.

## Marketing-Sites

`lumio-app-de` und `lumio-cloud-de` sind rollend deployter Content und brauchen
**kein** SemVer. Versionierung betrifft nur die App (`lumio`).
