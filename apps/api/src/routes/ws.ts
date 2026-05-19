/**
 * Lumio API — WebSocket Routes
 *
 * Push-Channel statt Polling. Studio-Clients verbinden sich mit
 * `/ws/galleries/:id`, bekommen anschließend File-Status-Updates und andere
 * Gallery-Events live ohne Polling-Last.
 *
 * Auth: gleich wie für REST — der Cookie wird vom @fastify/cookie-Plugin
 * gelesen, das auth-Plugin setzt req.session. Wir greifen einfach auf
 * req.requireAuth() zu wie sonst auch.
 *
 * Protokoll: JSON-Messages vom Server an den Client, vom Client kommen
 * nur Pings (alle 30s) als Heartbeat. Wir antworten auf Pings mit Pongs,
 * sonst halten manche Proxies (auch Caddy bei langem Idle) die
 * Verbindung nicht offen.
 */
import type { FastifyInstance } from "fastify";
import websocketPlugin from "@fastify/websocket";

import { prisma } from "../db.js";
import { subscribe } from "../services/events.js";

export async function registerWsRoutes(app: FastifyInstance) {
  await app.register(websocketPlugin);

  app.get<{ Params: { id: string } }>(
    "/ws/galleries/:id",
    { websocket: true },
    async (socket, req) => {
      // requireAuth wirft, wenn nicht authentifiziert — Fastify würde das
      // beim REST in einen 401 wandeln. Bei WS schließen wir die Verbindung
      // mit Code 4401 (custom, "unauthorized"), damit der Client erkennt:
      // bitte zu /login.
      let session;
      try {
        session = req.requireAuth();
      } catch {
        socket.close(4401, "unauthorized");
        return;
      }

      // Ownership-Check: nur eigene Galerien dürfen subskribiert werden
      const gallery = await prisma.gallery.findFirst({
        where: {
          id: req.params.id,
          tenantId: req.tenantId,
          ownerId: session.user.id,
        },
        select: { id: true },
      });
      if (!gallery) {
        socket.close(4404, "not_found");
        return;
      }

      // Wenn alles passt: subscribe und Forward
      const unsubscribe = subscribe(gallery.id, (event) => {
        try {
          socket.send(JSON.stringify(event));
        } catch {
          // Socket ist auf dem Weg ins Off — ignorieren, der close-Handler
          // räumt gleich auf.
        }
      });

      socket.on("message", (raw: Buffer) => {
        // Wir interpretieren nur Heartbeats. Alles andere ignorieren.
        try {
          const msg = JSON.parse(raw.toString());
          if (msg?.type === "ping") {
            socket.send(JSON.stringify({ type: "pong", t: Date.now() }));
          }
        } catch {
          // ignore garbage
        }
      });

      socket.on("close", () => {
        unsubscribe();
      });

      // Erstes Lebenszeichen, damit der Client weiß: ich bin verbunden
      socket.send(JSON.stringify({ type: "hello", galleryId: gallery.id }));
    }
  );
}
