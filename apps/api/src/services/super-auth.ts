/**
 * Lumio API — Super-Admin Authentication
 *
 * Eigene Auth-Schicht für Plattform-Operatoren (siehe schema.prisma
 * SuperAdmin). Spiegelt die normale User-Auth-Logik wider, ist aber
 * komplett getrennt:
 *
 *   - Eigene Tabelle (super_admins) + Sessions (super_admin_sessions)
 *   - Eigener Session-Cookie-Name (lumio_super_session)
 *   - Eigene Plugins/Guards (request.requireSuperAdmin)
 *
 * Wir teilen Crypto-Konstanten (Argon2id-Parameter, Token-Bytes) mit
 * der normalen Auth — kein Grund dort zu divergieren.
 */
import { randomBytes, createHash } from "node:crypto";
import argon2 from "argon2";
import type { SuperAdmin, SuperAdminSession } from "@prisma/client";

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

export const SUPER_ADMIN_COOKIE = "lumio_super_session";

// ---------------------------------------------------------------------------
// Passwort
// ---------------------------------------------------------------------------
export async function verifySuperAdminPassword(
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
function generateToken(): string {
  return randomBytes(SESSION_BYTES).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SuperAdminContext {
  admin: SuperAdmin;
  session: SuperAdminSession;
}

export async function createSuperAdminSession(args: {
  superAdminId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<{ token: string; session: SuperAdminSession }> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const session = await prisma.superAdminSession.create({
    data: {
      superAdminId: args.superAdminId,
      tokenHash,
      ipAddress: args.ipAddress ?? null,
      userAgent: args.userAgent?.slice(0, 500) ?? null,
      expiresAt,
    },
  });
  return { token, session };
}

export async function lookupSuperAdminSession(
  token: string
): Promise<SuperAdminContext | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = await prisma.superAdminSession.findUnique({
    where: { tokenHash },
    include: { superAdmin: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    // Best-Effort-Cleanup; ignorier den Fehler falls Race
    await prisma.superAdminSession
      .delete({ where: { id: session.id } })
      .catch(() => {});
    return null;
  }
  return { admin: session.superAdmin, session };
}

export async function revokeSuperAdminSession(sessionId: string): Promise<void> {
  await prisma.superAdminSession
    .delete({ where: { id: sessionId } })
    .catch(() => {});
}
