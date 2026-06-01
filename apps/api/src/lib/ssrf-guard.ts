/**
 * Lumio API — SSRF-Guard für ausgehende Requests (Webhooks).
 *
 * Studio-User können beliebige Webhook-URLs hinterlegen. Ohne Schutz
 * könnte ein Tenant-Owner den Server dazu bringen, Requests an interne
 * Ziele zu schicken (Cloud-Metadata, das private Netz 10.0.0.0/16 mit
 * Redis/Postgres, Docker-interne Service-Namen). Das ist eine klassische
 * SSRF.
 *
 * Schutz:
 *   1) Nur https:// (wird zusätzlich schon im Route-Schema geprüft).
 *   2) Hostname auflösen und JEDE aufgelöste IP gegen private/loopback/
 *      link-local/metadata-Ranges prüfen — VOR dem Connect.
 *   3) Keine Redirects folgen (sonst ließe sich ein öffentlicher https-
 *      Endpoint nutzen, der per 30x auf ein internes Ziel umleitet).
 *
 * Restrisiko: DNS-Rebinding (Auflösung ändert sich zwischen Check und
 * Connect). Vollständige Absicherung bräuchte einen auf die geprüfte IP
 * gepinnten Socket; für das Bedrohungsmodell (blind SSRF, authentifizierter
 * Owner, https-only, keine Body-Rückgabe) ist der Pre-Check + No-Redirect
 * eine deutliche Härtung. Dokumentiert, damit es bewusst bleibt.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Prüft eine einzelne IP (v4 oder v6) gegen gesperrte Bereiche. */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedIpv4(ip);
  if (kind === 6) return isBlockedIpv6(ip);
  // Unbekanntes Format → sicherheitshalber blocken.
  return true;
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts;
  // 0.0.0.0/8  — "this" network
  if (a === 0) return true;
  // 10.0.0.0/8 — privat (u.a. das Hetzner-Private-Net)
  if (a === 10) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local + Cloud-Metadata (169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 — privat
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 — privat
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10 — CGNAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 192.0.0.0/24, 198.18.0.0/15 — IETF-Sonderzwecke/Benchmark
  if (a === 192 && b === 0 && parts[2] === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

function isBlockedIpv6(raw: string): boolean {
  const ip = raw.toLowerCase();
  // ::1 loopback, :: unspezifiziert
  if (ip === "::1" || ip === "::") return true;
  // IPv4-mapped (::ffff:a.b.c.d) → die eingebettete v4 prüfen
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  const head = ip.split(":")[0];
  const first = parseInt(head || "0", 16);
  // fc00::/7 — Unique Local (fc.. / fd..)
  if ((first & 0xfe00) === 0xfc00) return true;
  // fe80::/10 — link-local
  if ((first & 0xffc0) === 0xfe80) return true;
  return false;
}

/**
 * Wirft, wenn die URL nicht https ist oder der Host auf eine gesperrte
 * IP auflöst. Nutzt {all:true}, damit ALLE A/AAAA-Records geprüft werden
 * (ein Angreifer könnte sonst eine öffentliche + eine interne IP mischen).
 */
export async function assertPublicHttpsUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("invalid url");
  }
  if (url.protocol !== "https:") {
    throw new Error("only https urls are allowed");
  }
  const host = url.hostname;

  // Literal-IP direkt prüfen (kein DNS nötig).
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new Error("target ip is not allowed");
    return;
  }
  // "localhost" und Co. werden meist nicht über lookup zu 127.0.0.1, also
  // explizit abfangen.
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("target host is not allowed");
  }

  const results = await lookup(host, { all: true });
  if (results.length === 0) throw new Error("host did not resolve");
  for (const r of results) {
    if (isBlockedIp(r.address)) {
      throw new Error("target host resolves to a blocked ip");
    }
  }
}
