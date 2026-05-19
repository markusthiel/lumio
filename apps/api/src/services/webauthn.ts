/**
 * Lumio API — WebAuthn / Passkeys Service
 *
 * Modernes 2FA via FIDO2-Credentials: Touch-ID, Face-ID, Windows Hello,
 * YubiKeys, etc. Alternative zu TOTP — User können beide haben, müssen
 * aber mindestens eine Methode aktiv haben (oder gar keine, dann Passwort-
 * only-Login).
 *
 * Bibliothek: @simplewebauthn/server v11. Macht die ganze CBOR/COSE/
 * Attestation-Parserei für uns.
 *
 * Challenges werden temporär in Redis abgelegt (TTL 5 min). In-Memory
 * scheidet aus, weil dieselbe API-Instanz nicht garantiert beide Requests
 * sieht (Registration-Start vs. Finish können auf verschiedene Pods
 * laufen, falls wir mal skalieren).
 *
 * RP-Konfiguration:
 *   rpID     = host ohne Port (also "lumio-cloud.de", nicht "https://...")
 *   rpName   = "Lumio"
 *   origin   = config.PUBLIC_URL (mit Protokoll, ohne Trailing-Slash)
 *
 * In Dev (http://localhost:3000) erlaubt WebAuthn Insecure Origins NUR
 * für localhost — das ist im Standard so. Auf anderen Hostnamen muss
 * HTTPS sein.
 */
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from "@simplewebauthn/server";
import Redis from "ioredis";

import { prisma } from "../db.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

const RP_NAME = "Lumio";

function rpID(): string {
  // PUBLIC_URL ist z.B. "https://lumio-cloud.de" — wir wollen nur den Host.
  try {
    return new URL(config.PUBLIC_URL).hostname;
  } catch {
    return "localhost";
  }
}

function origin(): string {
  return config.PUBLIC_URL.replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// Challenge-Storage in Redis
// ---------------------------------------------------------------------------
let _redis: Redis | null = null;
function redis(): Redis {
  if (_redis) return _redis;
  _redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  _redis.on("error", (err) =>
    logger.warn({ err: err.message }, "webauthn: redis error")
  );
  return _redis;
}

const CHALLENGE_TTL_S = 300; // 5 Minuten

function regKey(userId: string): string {
  return `lumio:webauthn:reg:${userId}`;
}
function authKey(challengeId: string): string {
  return `lumio:webauthn:auth:${challengeId}`;
}

// ---------------------------------------------------------------------------
// Registration: bestehender, eingeloggter User fügt Passkey hinzu
// ---------------------------------------------------------------------------
export async function startRegistration(
  userId: string
): Promise<ReturnType<typeof generateRegistrationOptions> extends Promise<infer R> ? R : never> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      webauthnCredentials: { select: { credentialId: true, transports: true } },
    },
  });
  if (!user) throw new Error("user_not_found");

  const opts = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpID(),
    // user.id darf laut spec maximal 64 byte sein und sollte stabil sein
    userID: Buffer.from(user.id),
    userName: user.email,
    userDisplayName: user.name ?? user.email,
    // Bestehende Credentials ausschließen, damit der User nicht denselben
    // Authenticator zweimal registriert
    excludeCredentials: user.webauthnCredentials.map((c) => ({
      id: c.credentialId,
      transports: c.transports
        ? (JSON.parse(c.transports) as AuthenticatorTransportLike[])
        : undefined,
    })),
    authenticatorSelection: {
      // residentKey="preferred": Browser darf einen "Discoverable Credential"
      // (alias Passkey) anlegen, ist aber nicht zwingend. Damit funktioniert
      // sowohl Touch-ID als auch USB-Security-Keys.
      residentKey: "preferred",
      userVerification: "preferred",
    },
    attestationType: "none",
  });

  await redis().setex(regKey(userId), CHALLENGE_TTL_S, opts.challenge);
  return opts;
}

export interface RegistrationVerificationInput {
  userId: string;
  response: Parameters<typeof verifyRegistrationResponse>[0]["response"];
  label: string;
}

export async function finishRegistration(
  input: RegistrationVerificationInput
): Promise<{ ok: boolean; credentialId?: string; reason?: string }> {
  const expected = await redis().get(regKey(input.userId));
  if (!expected) return { ok: false, reason: "challenge_expired" };
  await redis().del(regKey(input.userId));

  let verification: VerifiedRegistrationResponse;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: expected,
      expectedOrigin: origin(),
      expectedRPID: rpID(),
      requireUserVerification: false,
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "webauthn: register verify failed");
    return { ok: false, reason: "verification_failed" };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, reason: "not_verified" };
  }

  const info = verification.registrationInfo;
  const cred = info.credential;
  const transports = input.response.response.transports;

  const row = await prisma.webauthnCredential.create({
    data: {
      userId: input.userId,
      credentialId: cred.id,
      publicKey: Buffer.from(cred.publicKey),
      signCount: BigInt(cred.counter),
      transports: transports ? JSON.stringify(transports) : null,
      label: input.label.slice(0, 100),
    },
    select: { id: true },
  });
  return { ok: true, credentialId: row.id };
}

// ---------------------------------------------------------------------------
// Authentication: User authentifiziert sich beim Login mit Passkey
// ---------------------------------------------------------------------------
/**
 * Erzeugt Options für die WebAuthn-Authentication. Erwartet, dass die
 * Passwort-Phase schon durch ist — der userId-Parameter kommt aus dem
 * Login-Challenge-Token, das wir nach erfolgreichem Passwort ausstellen.
 * Gibt eine Challenge-ID zurück, die der Client im Finish-Call mitschickt.
 */
export async function startAuthentication(
  userId: string
): Promise<{
  options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
  challengeId: string;
}> {
  const creds = await prisma.webauthnCredential.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });
  if (creds.length === 0) throw new Error("no_credentials");

  const opts = await generateAuthenticationOptions({
    rpID: rpID(),
    userVerification: "preferred",
    allowCredentials: creds.map((c) => ({
      id: c.credentialId,
      transports: c.transports
        ? (JSON.parse(c.transports) as AuthenticatorTransportLike[])
        : undefined,
    })),
  });

  // Eindeutige Challenge-ID, damit wir den Eintrag im Finish wiederfinden
  const challengeId = crypto.randomUUID();
  await redis().setex(
    authKey(challengeId),
    CHALLENGE_TTL_S,
    JSON.stringify({ challenge: opts.challenge, userId })
  );
  return { options: opts, challengeId };
}

export interface AuthenticationVerificationInput {
  challengeId: string;
  response: Parameters<typeof verifyAuthenticationResponse>[0]["response"];
}

export async function finishAuthentication(
  input: AuthenticationVerificationInput
): Promise<{ ok: boolean; userId?: string; reason?: string }> {
  const raw = await redis().get(authKey(input.challengeId));
  if (!raw) return { ok: false, reason: "challenge_expired" };
  await redis().del(authKey(input.challengeId));

  let payload: { challenge: string; userId: string };
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "malformed_challenge" };
  }

  // Credential aus der DB holen anhand der credentialId, die der Browser
  // mitschickt. Achtung: wir haben verifyAuthenticationResponse so vor-
  // konfiguriert, dass nur Credentials aus allowCredentials akzeptiert
  // werden — aber das prüft die Library nicht selbst, nur den Signature-
  // Mismatch. Wir checken zusätzlich, dass die Credential zum User gehört.
  const cred = await prisma.webauthnCredential.findUnique({
    where: { credentialId: input.response.id },
  });
  if (!cred || cred.userId !== payload.userId) {
    return { ok: false, reason: "credential_unknown" };
  }

  let verification: VerifiedAuthenticationResponse;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: payload.challenge,
      expectedOrigin: origin(),
      expectedRPID: rpID(),
      credential: {
        id: cred.credentialId,
        publicKey: Buffer.from(cred.publicKey),
        counter: Number(cred.signCount),
        transports: cred.transports
          ? (JSON.parse(cred.transports) as AuthenticatorTransportLike[])
          : undefined,
      },
      requireUserVerification: false,
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "webauthn: auth verify failed");
    return { ok: false, reason: "verification_failed" };
  }

  if (!verification.verified) {
    return { ok: false, reason: "not_verified" };
  }

  // signCount mitziehen, um Replay-Attacks gegen geklonte Authenticators
  // zu erkennen. Manche Authenticators (insbesondere Passkeys mit
  // Cloud-Sync) reporten 0 — dann lassen wir den Wert auf 0 stehen.
  if (verification.authenticationInfo.newCounter > 0) {
    await prisma.webauthnCredential.update({
      where: { id: cred.id },
      data: {
        signCount: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });
  } else {
    await prisma.webauthnCredential.update({
      where: { id: cred.id },
      data: { lastUsedAt: new Date() },
    });
  }

  return { ok: true, userId: payload.userId };
}

// ---------------------------------------------------------------------------
// Management
// ---------------------------------------------------------------------------
export async function listCredentials(userId: string) {
  return prisma.webauthnCredential.findMany({
    where: { userId },
    select: {
      id: true,
      label: true,
      createdAt: true,
      lastUsedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function deleteCredential(
  userId: string,
  credentialId: string
): Promise<boolean> {
  const res = await prisma.webauthnCredential.deleteMany({
    where: { id: credentialId, userId },
  });
  return res.count > 0;
}

// AuthenticatorTransport-Typ ist im SimpleWebAuthn-Modul aus den Browser-
// Defs, die wir hier nicht direkt importieren wollen.
type AuthenticatorTransportLike =
  | "usb"
  | "nfc"
  | "ble"
  | "internal"
  | "hybrid"
  | "smart-card";
