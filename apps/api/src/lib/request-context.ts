/**
 * Request-scoped Kontext via AsyncLocalStorage.
 *
 * Einziger Zweck (Stand heute): den Host, über den der Browser die API
 * gerade erreicht, bis in services/storage.ts durchzureichen, OHNE
 * jede presign-Aufrufstelle um einen req-Parameter zu erweitern.
 *
 * Hintergrund (Quick Start, GitHub-nahe Bugserie): Ohne S3_PUBLIC_URL
 * fielen presigned URLs auf S3_ENDPOINT (http://minio:9000) zurück —
 * ein Container-DNS-Name, den kein Browser auflösen kann. Uploads UND
 * Bild-Anzeige waren damit in jedem Setup ohne explizite S3_PUBLIC_URL
 * tot. Mit dem Request-Host kann storage.ts stattdessen auf
 * http://<host>:<MINIO_API_PORT> signieren — funktioniert für
 * localhost, Server-IP und Domain gleichermaßen.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { FastifyInstance } from "fastify";

interface RequestContext {
  /** Hostname ohne Port, aus dem Host-/X-Forwarded-Host-Header
   *  (trustProxy ist aktiv, Caddy reicht den Original-Host durch). */
  hostname: string;
}

const als = new AsyncLocalStorage<RequestContext>();

export function getRequestHostname(): string | undefined {
  return als.getStore()?.hostname;
}

export function registerRequestContext(app: FastifyInstance) {
  app.addHook("onRequest", (req, _reply, done) => {
    // Fastify 4: req.hostname kann den Port enthalten — defensiv abtrennen.
    // IPv6-Literale ([::1]:80) treten hinter Caddy praktisch nicht auf und
    // wären für presigned URLs ohnehin ungeeignet — wir behandeln sie nicht.
    const hostname = (req.hostname ?? "").split(":")[0];
    als.run({ hostname }, done);
  });
}
