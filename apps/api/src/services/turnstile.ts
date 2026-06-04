/**
 * Lumio API — Cloudflare Turnstile (CAPTCHA) Verifikation
 *
 * Serverseitige Prüfung des Turnstile-Tokens beim Self-Service-Signup.
 * Aktiv nur, wenn TURNSTILE_SECRET_KEY gesetzt ist — sonst No-op (true),
 * damit Self-Hoster / Single-Mode nichts konfigurieren müssen.
 */
import { config } from "../config.js";
import { logger } from "../logger.js";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Ist Turnstile aktiv (Secret gesetzt)? */
export function isTurnstileEnabled(): boolean {
  return !!config.TURNSTILE_SECRET_KEY?.trim();
}

/**
 * Verifiziert einen Turnstile-Token bei Cloudflare. true = gültig.
 * Bei deaktiviertem Turnstile immer true. Fail-closed: kann nicht
 * verifiziert werden (Netzfehler/Timeout), gilt der Signup als abgelehnt —
 * Missbrauchsschutz geht hier vor maximaler Verfügbarkeit.
 */
export async function verifyTurnstile(
  token: string | undefined,
  remoteIp?: string
): Promise<boolean> {
  const secret = config.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return true; // aus → durchlassen
  if (!token) return false;

  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    if (remoteIp) form.set("remoteip", remoteIp);

    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "turnstile: siteverify http error");
      return false;
    }
    const data = (await res.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };
    if (data.success !== true) {
      logger.warn(
        { errors: data["error-codes"] },
        "turnstile: verification rejected"
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, "turnstile: siteverify request failed");
    return false;
  }
}
