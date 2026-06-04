/**
 * Lumio API — System-Health / Update-Check / Backup-Status
 *
 * Drei Bereiche fuer Self-Hosting-Operations, die alle auf der /super/system-
 * Page landen:
 *
 *   1. checkSystemHealth(): DB, Redis, S3, Worker-Activity, Queue-Lengths
 *   2. checkForUpdate(): fetcht latest Forgejo-Release-Tag, vergleicht mit
 *      lokaler version aus package.json. Cached In-Memory fuer 1h damit
 *      wir Forgejo nicht hammern.
 *   3. checkBackupStatus(): liest ENV BACKUP_STATUS_PATH — eine Datei in
 *      die das Backup-Skript einen Timestamp schreibt nach erfolgreichem
 *      Backup. Wenn nicht konfiguriert: 'not_configured' zurueck und das
 *      Frontend zeigt einen Hinweis.
 *
 * Bewusste Pragmatik:
 *  - Health-Checks haben 2s Timeout — wenn etwas nicht antwortet, ist es
 *    de facto down, kein 30s-Wait
 *  - Update-Check ist opt-out via DISABLE_UPDATE_CHECK env var (Cloud-
 *    Variante deaktiviert das, weil ich selbst deploye)
 *  - Backup-Status braucht keine eigene DB-Tabelle — eine Datei reicht,
 *    das Backup-Skript ist sowieso ausserhalb der App
 */
import { promises as fs } from "node:fs";

import { prisma } from "../db.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { LUMIO_VERSION } from "../version.js";
import { Queues } from "./queue.js";
import Redis from "ioredis";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";

// Eigener Redis-Client mit kurzen Timeouts fuer Health-Check. Wir
// teilen NICHT den queue.ts-Redis weil der maxRetriesPerRequest=null
// hat — bei Outage wuerde der Health-Check ewig haengen.
let _healthRedis: Redis | null = null;
function healthRedis(): Redis {
  if (_healthRedis) return _healthRedis;
  _healthRedis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 2000,
    lazyConnect: true,
    enableReadyCheck: false,
    retryStrategy: () => null, // kein automatic-Retry
  });
  _healthRedis.on("error", () => {
    // schluck — wir wollen den Connection-Status synchron sehen
  });
  return _healthRedis;
}

// Eigener S3-Client fuer Health, ebenfalls mit kurzen Timeouts
let _healthS3: S3Client | null = null;
function healthS3(): S3Client {
  if (_healthS3) return _healthS3;
  _healthS3 = new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT || undefined,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    },
    forcePathStyle: !!config.S3_ENDPOINT,
    requestHandler: {
      requestTimeout: 2000,
      connectionTimeout: 2000,
    },
  });
  return _healthS3;
}

// =============================================================================
// System-Health
// =============================================================================

export interface HealthCheck {
  ok: boolean;
  latencyMs: number | null;
  message?: string;
  details?: Record<string, unknown>;
}

export interface SystemHealth {
  db: HealthCheck;
  redis: HealthCheck;
  s3: HealthCheck;
  worker: HealthCheck;
  /** Queue-Lengths pro Stream, fuer schnelles Spotten von Backlogs. */
  queues: Record<string, number>;
  /** Disk-Frei in MiB. null wenn nicht ermittelbar. */
  diskFreeMib: number | null;
}

async function timed<T>(
  fn: () => Promise<T>
): Promise<{ result: T | null; error: Error | null; latencyMs: number }> {
  const start = Date.now();
  try {
    const result = await fn();
    return { result, error: null, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      result: null,
      error: err instanceof Error ? err : new Error(String(err)),
      latencyMs: Date.now() - start,
    };
  }
}

async function checkDb(): Promise<HealthCheck> {
  const { error, latencyMs } = await timed(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  return {
    ok: !error,
    latencyMs,
    message: error?.message,
  };
}

async function checkRedis(): Promise<HealthCheck> {
  const { error, latencyMs } = await timed(async () => {
    await healthRedis().ping();
  });
  return {
    ok: !error,
    latencyMs,
    message: error?.message,
  };
}

async function checkS3(): Promise<HealthCheck> {
  const { error, latencyMs } = await timed(async () => {
    await healthS3().send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
  });
  return {
    ok: !error,
    latencyMs,
    message: error?.message,
  };
}

async function checkQueues(): Promise<Record<string, number>> {
  const r = healthRedis();
  const result: Record<string, number> = {};
  for (const [name, key] of Object.entries(Queues)) {
    try {
      const len = await r.xlen(key);
      result[name] = len;
    } catch {
      result[name] = -1; // -1 = error
    }
  }
  return result;
}

async function checkWorker(): Promise<HealthCheck> {
  // Worker-Heartbeat-Pattern: wir haben aktuell keinen expliziten
  // Heartbeat. Pragmatischer Proxy: wann wurde der letzte Event
  // 'system.*' Job-bezogen geschrieben? Oder noch besser: der letzte
  // File-Processing-Event (file.ready / file.failed). Wenn der length-
  // Wert der File-Queue >0 ist aber kein File in den letzten 5 Min
  // verarbeitet wurde, ist der Worker tot.
  //
  // Wir messen: letzter File-Status-Update in der letzten Stunde.
  // Wenn nichts, dann 'unknown' — kein klares Aussagen 'down'.
  const start = Date.now();
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await prisma.file.findFirst({
      where: {
        OR: [
          { status: "ready", updatedAt: { gte: oneHourAgo } },
          { status: "failed", updatedAt: { gte: oneHourAgo } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true, status: true },
    });
    const latencyMs = Date.now() - start;
    if (!recent) {
      return {
        ok: true,
        latencyMs,
        message: "no recent processed files (last 1h) — no signal",
        details: { lastProcessedAt: null },
      };
    }
    return {
      ok: true,
      latencyMs,
      details: {
        lastProcessedAt: recent.updatedAt.toISOString(),
        lastStatus: recent.status,
      },
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkDiskFree(): Promise<number | null> {
  // statvfs ueber den Working-Dir. Auf vielen Hostings nicht aussagekraeftig
  // (Container-Storage != Host-Storage), aber besser als nix.
  try {
    const stats = await fs.statfs("/");
    const free = stats.bavail * stats.bsize;
    return Math.floor(free / (1024 * 1024));
  } catch {
    return null;
  }
}

export async function checkSystemHealth(): Promise<SystemHealth> {
  const [db, redis, s3, worker, queues, diskFreeMib] = await Promise.all([
    checkDb(),
    checkRedis(),
    checkS3(),
    checkWorker(),
    checkQueues(),
    checkDiskFree(),
  ]);
  return { db, redis, s3, worker, queues, diskFreeMib };
}

// =============================================================================
// Update-Check (Forgejo)
// =============================================================================

export interface UpdateInfo {
  /** Aktuelle Version aus package.json */
  currentVersion: string;
  /** Latest-Tag aus Forgejo (null wenn check disabled oder failed) */
  latestVersion: string | null;
  /** True wenn lokal < latest (Semver-Compare) */
  updateAvailable: boolean;
  releaseUrl: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  /** Zeitpunkt der letzten erfolgreichen Pruefung */
  checkedAt: string | null;
  /** Wenn nicht null: Begruendung warum kein Check moeglich war */
  disabled: string | null;
}

const UPDATE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 Stunde
let _updateCache: { data: UpdateInfo; expires: number } | null = null;

const CURRENT_VERSION = (() => {
  // Single Source of Truth ist /VERSION → version.ts (vom Bump-Script
  // gestempelt), mit optionalem ENV-Override LUMIO_VERSION. Früher wurde
  // hier package.json via require() gelesen, was im dist/-Build je nach
  // Pfad als "unknown" durchfiel.
  const v = LUMIO_VERSION?.trim();
  return v && v.length > 0 ? v : "unknown";
})();

function semverGreater(a: string, b: string): boolean {
  // Sehr simpel: M.m.p Vergleich, ignoriert Pre-Release-Tags.
  const pa = a
    .replace(/^v/, "")
    .split(".")
    .map((x) => parseInt(x, 10) || 0);
  const pb = b
    .replace(/^v/, "")
    .split(".")
    .map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

export async function checkForUpdate(force = false): Promise<UpdateInfo> {
  const disabledReason = process.env.DISABLE_UPDATE_CHECK
    ? "Update-Check via DISABLE_UPDATE_CHECK deaktiviert."
    : null;
  if (disabledReason) {
    return {
      currentVersion: CURRENT_VERSION,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      releaseNotes: null,
      publishedAt: null,
      checkedAt: null,
      disabled: disabledReason,
    };
  }

  if (!force && _updateCache && _updateCache.expires > Date.now()) {
    return _updateCache.data;
  }

  // Default: das kanonische Lumio-Repo auf Forgejo. Die Forgejo-Release-API
  // ist GitHub-kompatibel (tag_name/name/body/html_url/published_at). Da das
  // Repo derzeit privat ist, braucht der Check ein Token — optional via
  // LUMIO_UPDATE_REPO_TOKEN (Read-only-Token genügt). Ohne Token liefert
  // Forgejo 404 und der Check zeigt sich als "nicht erreichbar".
  const repoBase =
    process.env.LUMIO_UPDATE_REPO_URL?.trim() ||
    "https://forgejo.thiel.tools/api/v1/repos/thiel/lumio";
  const repoToken = process.env.LUMIO_UPDATE_REPO_TOKEN?.trim();

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (repoToken) {
      headers.Authorization = `token ${repoToken}`;
    }
    const resp = await fetch(`${repoBase}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const release = (await resp.json()) as {
      tag_name?: string;
      name?: string;
      body?: string;
      html_url?: string;
      published_at?: string;
    };
    const latestTag = release.tag_name ?? release.name ?? "";
    const data: UpdateInfo = {
      currentVersion: CURRENT_VERSION,
      latestVersion: latestTag,
      updateAvailable:
        CURRENT_VERSION !== "unknown" &&
        latestTag !== "" &&
        semverGreater(latestTag, CURRENT_VERSION),
      releaseUrl: release.html_url ?? null,
      releaseNotes: release.body ?? null,
      publishedAt: release.published_at ?? null,
      checkedAt: new Date().toISOString(),
      disabled: null,
    };
    _updateCache = { data, expires: Date.now() + UPDATE_CACHE_TTL_MS };
    return data;
  } catch (err) {
    logger.warn({ err }, "update-check failed");
    return {
      currentVersion: CURRENT_VERSION,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      releaseNotes: null,
      publishedAt: null,
      checkedAt: null,
      disabled: `Forgejo-API nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// =============================================================================
// Backup-Status
// =============================================================================

export interface BackupStatus {
  configured: boolean;
  statusPath: string | null;
  lastBackupAt: string | null;
  ageHours: number | null;
  sizeBytes: number | null;
  health: "ok" | "warning" | "critical" | "unknown";
  message: string;
}

/** Liest einen Status-File mit Format 'TIMESTAMP\nSIZE_BYTES\n'. Das
 *  Backup-Skript schreibt nach erfolgreichem pg_dump z.B.:
 *
 *      echo "$(date -u +%FT%TZ)\n$(stat -c%s "$DUMP")" > /backups/latest.txt
 */
export async function checkBackupStatus(): Promise<BackupStatus> {
  const path = process.env.BACKUP_STATUS_PATH ?? null;
  if (!path) {
    return {
      configured: false,
      statusPath: null,
      lastBackupAt: null,
      ageHours: null,
      sizeBytes: null,
      health: "unknown",
      message:
        "Backup-Monitoring nicht aktiv. Setze BACKUP_STATUS_PATH und schreibe dort den Timestamp nach jedem pg_dump.",
    };
  }

  try {
    const content = await fs.readFile(path, "utf-8");
    const lines = content.trim().split(/\r?\n/);
    const timestampStr = lines[0]?.trim();
    const sizeStr = lines[1]?.trim();
    if (!timestampStr) {
      return {
        configured: true,
        statusPath: path,
        lastBackupAt: null,
        ageHours: null,
        sizeBytes: null,
        health: "critical",
        message: "Status-Datei vorhanden aber leer.",
      };
    }
    const ts = new Date(timestampStr);
    if (isNaN(ts.getTime())) {
      return {
        configured: true,
        statusPath: path,
        lastBackupAt: null,
        ageHours: null,
        sizeBytes: null,
        health: "critical",
        message: `Status-Datei enthält ungültigen Timestamp: ${timestampStr}`,
      };
    }
    const ageHours = (Date.now() - ts.getTime()) / (60 * 60 * 1000);
    const sizeBytes = sizeStr ? parseInt(sizeStr, 10) || null : null;
    const health: BackupStatus["health"] =
      ageHours > 72 ? "critical" : ageHours > 24 ? "warning" : "ok";
    const message =
      ageHours > 72
        ? `Letzter erfolgreicher Backup ist ${Math.floor(ageHours)}h alt — sofort prüfen!`
        : ageHours > 24
          ? `Backup ist ${Math.floor(ageHours)}h alt — nightly läuft offenbar nicht mehr.`
          : `Letzter erfolgreicher Backup vor ${Math.floor(ageHours)}h.`;
    return {
      configured: true,
      statusPath: path,
      lastBackupAt: ts.toISOString(),
      ageHours,
      sizeBytes,
      health,
      message,
    };
  } catch (err) {
    return {
      configured: true,
      statusPath: path,
      lastBackupAt: null,
      ageHours: null,
      sizeBytes: null,
      health: "critical",
      message: `Status-Datei nicht lesbar: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
