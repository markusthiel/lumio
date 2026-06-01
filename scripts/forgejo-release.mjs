#!/usr/bin/env node
// =============================================================================
// Forgejo-Release aus Tag + CHANGELOG-Abschnitt anlegen/aktualisieren
// =============================================================================
// Wird von .forgejo/workflows/release.yml beim Tag-Push aufgerufen. Hintergrund:
// Der Push-Mirror überträgt Releases NICHT (das sind Plattform-Metadaten), und
// auch ein reiner Tag erzeugt auf keiner Forge automatisch ein Release. Diese
// Action baut daher das Forgejo-Release; das Pendant für GitHub liegt unter
// .github/workflows/release.yml.
//
// Auth: der automatische Actions-Token (github.token) hat Repo-Schreibrecht.
// Idempotent — existiert das Release zum Tag schon, werden nur die Notes
// aktualisiert (PATCH) statt neu angelegt (POST).
//
// Erwartete Env: FORGE_URL (z.B. https://forgejo.thiel.tools), REPO
// (owner/repo), TAG (z.B. v0.10.0), TOKEN.
import { readFileSync } from "node:fs";

const { FORGE_URL, REPO, TAG, TOKEN } = process.env;
if (!FORGE_URL || !REPO || !TAG || !TOKEN) {
  console.error("Fehlende Env: FORGE_URL, REPO, TAG, TOKEN erforderlich.");
  process.exit(1);
}

const version = TAG.replace(/^v/, "");
const base = `${FORGE_URL}/api/v1/repos/${REPO}`;
const headers = {
  Authorization: `token ${TOKEN}`,
  "Content-Type": "application/json",
};

// Den Abschnitt "## [version] ..." bis zur nächsten "## [" Überschrift ziehen.
function changelogSection(ver) {
  let lines;
  try {
    lines = readFileSync("CHANGELOG.md", "utf8").split("\n");
  } catch {
    return null;
  }
  const start = lines.findIndex((l) => l.startsWith(`## [${ver}]`));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## \[/.test(l));
  const section = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  return section || null;
}

const body = changelogSection(version) ?? "Siehe CHANGELOG.md";
const payload = JSON.stringify({
  tag_name: TAG,
  name: `Lumio ${TAG}`,
  body,
});

const existing = await fetch(
  `${base}/releases/tags/${encodeURIComponent(TAG)}`,
  { headers }
);

let res;
if (existing.ok) {
  const current = await existing.json();
  res = await fetch(`${base}/releases/${current.id}`, {
    method: "PATCH",
    headers,
    body: payload,
  });
} else {
  res = await fetch(`${base}/releases`, {
    method: "POST",
    headers,
    body: payload,
  });
}

if (!res.ok) {
  console.error("Release-API-Fehler", res.status, await res.text());
  process.exit(1);
}

const out = await res.json();
console.log("Forgejo-Release ok:", out.html_url ?? out.url ?? TAG);
