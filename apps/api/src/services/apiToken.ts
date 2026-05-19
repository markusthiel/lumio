/**
 * Lumio API — API-Token-Service
 *
 * Persönliche Access-Tokens für Plugin-/CLI-Zugriff. Format:
 *
 *   lumio_<32 random hex bytes>     (Plaintext)
 *   tokenHash = sha256(plaintext)   (in DB gespeichert)
 *
 * Token wird nur EINMAL beim Erstellen ausgegeben. Wer ihn verliert, muss
 * einen neuen erzeugen.
 *
 * Validierung im Auth-Plugin: bei Bearer-Token wird sha256 berechnet und
 * gegen die DB geprüft. Treffer → wir setzen req.session genauso wie bei
 * Cookie-Login. Damit funktionieren alle Studio-Endpoints auch per Token.
 */
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db.js";

const TOKEN_PREFIX = "lumio_";
const TOKEN_BYTES = 32; // 64 hex chars

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Neuen Token erzeugen. Gibt Plaintext + DB-Eintrag zurück.
 * Plaintext wird NICHT in der DB gespeichert.
 */
export async function createApiToken(opts: {
  userId: string;
  name: string;
  expiresAt?: Date | null;
}): Promise<{ plaintext: string; record: { id: string; name: string; createdAt: Date } }> {
  const plaintext = TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = hashToken(plaintext);
  const record = await prisma.apiToken.create({
    data: {
      userId: opts.userId,
      name: opts.name.slice(0, 100),
      tokenHash,
      expiresAt: opts.expiresAt ?? null,
    },
    select: { id: true, name: true, createdAt: true },
  });
  return { plaintext, record };
}

/**
 * Token validieren. Gibt den User zurück, falls gültig und nicht abgelaufen.
 * lastUsedAt wird best-effort aktualisiert (ohne den Request zu blockieren).
 */
export async function validateApiToken(plaintext: string): Promise<{
  userId: string;
  tokenId: string;
} | null> {
  if (!plaintext.startsWith(TOKEN_PREFIX)) return null;
  const tokenHash = hashToken(plaintext);
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true },
  });
  if (!row) return null;
  if (row.expiresAt && row.expiresAt < new Date()) return null;

  // Last-used touch — kein await, damit der Request schneller fertig ist
  prisma.apiToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { userId: row.userId, tokenId: row.id };
}

export async function listApiTokens(userId: string) {
  return prisma.apiToken.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function revokeApiToken(
  userId: string,
  tokenId: string
): Promise<boolean> {
  const res = await prisma.apiToken.deleteMany({
    where: { id: tokenId, userId },
  });
  return res.count > 0;
}
