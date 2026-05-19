/**
 * Lumio API — Authentication Service
 *
 * Verantwortlich für:
 *   - Passwort-Hashing & -Verifikation (Argon2id)
 *   - Erstellung/Validierung von Session-Tokens (kryptografisch zufällig,
 *     in DB als SHA-256-Hash gespeichert)
 *
 * Wir nutzen explizit KEIN JWT, weil:
 *   - Sessions sollen serverseitig invalidierbar sein (Logout-Everywhere)
 *   - Wir wollen keine Public-Key-Komplexität
 *   - Cookies + HMAC ist einfacher und auditierbar
 */
import { randomBytes, createHash } from "node:crypto";
import argon2 from "argon2";
import type { Session, User } from "@prisma/client";

import { prisma } from "../db.js";

const SESSION_BYTES = 32;
const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

const ARGON2_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: Number(process.env.ARGON2_MEMORY_KIB ?? 19_456),
  timeCost: 2,
  parallelism: 1,
};

// ---------------------------------------------------------------------------
// Passwort-Hashing
// ---------------------------------------------------------------------------
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTS);
}

export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
function generateSessionToken(): string {
  return randomBytes(SESSION_BYTES).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SessionContext {
  user: User;
  session: Session;
}

/** Erzeugt eine neue Session und liefert das Klartext-Token (geht in den Cookie). */
export async function createSession(opts: {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{ token: string; session: Session }> {
  const token = generateSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const session = await prisma.session.create({
    data: {
      userId: opts.userId,
      tokenHash,
      ipAddress: opts.ipAddress ?? null,
      userAgent: opts.userAgent ?? null,
      expiresAt,
    },
  });

  await prisma.user.update({
    where: { id: opts.userId },
    data: { lastLoginAt: new Date() },
  });

  return { token, session };
}

/** Validiert ein Token aus dem Cookie und gibt User + Session zurück. */
export async function validateSession(
  token: string
): Promise<SessionContext | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) return null;
  if (session.expiresAt < new Date()) {
    // Abgelaufen — direkt aufräumen
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (session.user.status !== "active") return null;

  return { user: session.user, session };
}

export async function deleteSession(token: string): Promise<void> {
  if (!token) return;
  const tokenHash = hashToken(token);
  await prisma.session.deleteMany({ where: { tokenHash } });
}

/** Logout von allen Geräten. */
export async function deleteAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
