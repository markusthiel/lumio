"use client";

/**
 * Lumio Frontend — Gallery Events Hook
 *
 * Verbindet sich per WebSocket mit /ws/galleries/:id und liefert Events
 * (file.status, file.deleted, file.added). Auto-Reconnect mit Backoff,
 * automatischer Heartbeat alle 30s, sauberes Cleanup beim Unmount.
 *
 * Verwendung:
 *
 *   useGalleryEvents(galleryId, (event) => {
 *     if (event.type === "file.status" && event.status === "ready") {
 *       // File im State auf ready setzen
 *     }
 *   });
 *
 * Bewusst nur ein Hook, keine globale Subscription: jede Seite, die
 * Events sehen will, hält ihre eigene Verbindung. Bei einer einzigen
 * offenen Studio-Galerie pro Tab ist das pragmatisch — wir gehen nicht
 * davon aus, dass dutzende Komponenten parallel dasselbe abonnieren.
 */
import { useEffect, useRef } from "react";

export type GalleryEvent =
  | {
      type: "file.status";
      fileId: string;
      status: "uploading" | "processing" | "ready" | "failed" | "hidden";
      width?: number | null;
      height?: number | null;
    }
  | { type: "file.deleted"; fileId: string }
  | { type: "file.added"; fileId: string }
  | {
      type: "selection.changed";
      fileId: string;
      accessId: string | null;
      accessLabel: string | null;
      color: string | null;
      rating: number | null;
      liked: boolean;
      status: string | null;
    }
  | {
      type: "comment.posted";
      fileId: string;
      commentId: string;
      authorLabel: string;
      body: string;
    }
  | {
      type: "selection.finalized";
      accessId: string;
      accessLabel: string | null;
      count: number;
    }
  | {
      type: "file.visibility";
      fileId: string;
      publicVisibility: "visible" | "hidden" | "rejected";
    }
  | {
      type: "upload_link.received";
      fileId: string;
      uploadLinkId: string;
      filename: string;
    }
  | { type: "hello"; galleryId: string }
  | { type: "pong"; t: number };

type Handler = (event: GalleryEvent) => void;

function wsUrl(galleryId: string): string {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws/galleries/${galleryId}`;
}

export function useGalleryEvents(
  galleryId: string | null | undefined,
  handler: Handler
): void {
  // Den Handler in einer Ref halten, damit Re-Renders nicht jedes Mal
  // die WebSocket-Verbindung neu aufbauen. Effect-Deps können dann auf
  // [galleryId] reduziert bleiben.
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!galleryId) return;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let attempts = 0;

    function clearTimers() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    function connect() {
      if (cancelled) return;
      ws = new WebSocket(wsUrl(galleryId!));

      ws.onopen = () => {
        attempts = 0;
        // Heartbeat alle 30s — manche Proxies werfen idle Verbindungen
        // nach 60s raus. Server antwortet mit "pong".
        heartbeatTimer = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 30_000);
      };

      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as GalleryEvent;
          handlerRef.current(event);
        } catch {
          // ignore garbage
        }
      };

      ws.onclose = (e) => {
        clearTimers();
        if (cancelled) return;
        // Auth- und Not-Found-Closes nicht reconnecten — die werden
        // sich von selbst nicht heilen.
        if (e.code === 4401 || e.code === 4404) return;
        // Backoff mit jitter: 500ms · 2^attempts, max 30s
        attempts += 1;
        const delay = Math.min(30_000, 500 * 2 ** attempts);
        const jitter = Math.random() * 200;
        reconnectTimer = setTimeout(connect, delay + jitter);
      };

      ws.onerror = () => {
        // onclose räumt auf; wir wollen den Fehler nicht aus dem
        // Browser-Log pushen
      };
    }

    connect();

    return () => {
      cancelled = true;
      clearTimers();
      if (ws && ws.readyState !== WebSocket.CLOSED) {
        ws.close(1000, "unmount");
      }
    };
  }, [galleryId]);
}
