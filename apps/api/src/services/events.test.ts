import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Logic-Test für den Events-Service. Wir testen nur den lokalen
 * In-Memory-Pub/Sub-Pfad — die Redis-Bridge ist über Integration-Tests
 * abgedeckt (und im Live-System sowieso die Quelle der Wahrheit).
 *
 * Statt das Modul direkt zu laden, mocken wir den Redis-Constructor —
 * subscribe/publish im Service triggern ohne Mock einen echten Connect.
 */
vi.mock("ioredis", () => {
  class FakeRedis {
    on() {}
    subscribe() {}
    unsubscribe() {}
    publish() {
      return Promise.resolve(0);
    }
    quit() {
      return Promise.resolve();
    }
  }
  return { default: FakeRedis };
});

import {
  subscribe,
  publish,
  subscriberCount,
  type GalleryEvent,
} from "./events.js";

const GALLERY_A = "11111111-1111-1111-1111-111111111111";
const GALLERY_B = "22222222-2222-2222-2222-222222222222";

describe("events service — local dispatch", () => {
  it("delivers events to subscribed listeners", () => {
    const calls: GalleryEvent[] = [];
    const unsub = subscribe(GALLERY_A, (e) => calls.push(e));

    publish(GALLERY_A, { type: "file.status", fileId: "f1", status: "ready" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ fileId: "f1", status: "ready" });

    unsub();
  });

  it("isolates events by galleryId", () => {
    const a: GalleryEvent[] = [];
    const b: GalleryEvent[] = [];
    const unsubA = subscribe(GALLERY_A, (e) => a.push(e));
    const unsubB = subscribe(GALLERY_B, (e) => b.push(e));

    publish(GALLERY_A, { type: "file.deleted", fileId: "f1" });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);

    publish(GALLERY_B, { type: "file.added", fileId: "f2" });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);

    unsubA();
    unsubB();
  });

  it("stops delivering after unsubscribe", () => {
    let count = 0;
    const unsub = subscribe(GALLERY_A, () => count++);
    publish(GALLERY_A, { type: "file.deleted", fileId: "f1" });
    expect(count).toBe(1);

    unsub();
    publish(GALLERY_A, { type: "file.deleted", fileId: "f2" });
    expect(count).toBe(1);
  });

  it("tracks subscriber count for a gallery", () => {
    expect(subscriberCount(GALLERY_A)).toBe(0);
    const u1 = subscribe(GALLERY_A, () => {});
    const u2 = subscribe(GALLERY_A, () => {});
    expect(subscriberCount(GALLERY_A)).toBe(2);
    u1();
    expect(subscriberCount(GALLERY_A)).toBe(1);
    u2();
    expect(subscriberCount(GALLERY_A)).toBe(0);
  });

  it("isolates one broken listener from the rest", () => {
    const log = vi.fn();
    const unsub1 = subscribe(GALLERY_A, () => {
      throw new Error("kaboom");
    });
    const unsub2 = subscribe(GALLERY_A, log);

    publish(GALLERY_A, { type: "file.deleted", fileId: "f1" });
    expect(log).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();
  });
});

describe("events service — message shape", () => {
  it("accepts the file.status variants we care about", () => {
    const received: GalleryEvent[] = [];
    const unsub = subscribe(GALLERY_A, (e) => received.push(e));

    publish(GALLERY_A, { type: "file.status", fileId: "x", status: "uploading" });
    publish(GALLERY_A, { type: "file.status", fileId: "x", status: "processing" });
    publish(GALLERY_A, {
      type: "file.status",
      fileId: "x",
      status: "ready",
      width: 4000,
      height: 3000,
    });
    publish(GALLERY_A, { type: "file.status", fileId: "x", status: "failed" });
    publish(GALLERY_A, { type: "file.status", fileId: "x", status: "hidden" });

    expect(received).toHaveLength(5);
    expect(received[2]).toMatchObject({ width: 4000, height: 3000 });

    unsub();
  });

  it("carries new selection.changed payload through dispatch", () => {
    // Wenn das Schema sich ändert, müssen die Felder hier mit umgezogen
    // werden. Andersrum: dieser Test stellt sicher, dass die neue
    // selection.changed-Variante typ-strukturell stabil bleibt.
    const received: GalleryEvent[] = [];
    const unsub = subscribe(GALLERY_A, (e) => received.push(e));

    publish(GALLERY_A, {
      type: "selection.changed",
      fileId: "f1",
      accessId: "a1",
      accessLabel: "Brautpaar",
      color: "green",
      rating: null,
      liked: true,
      status: null,
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: "selection.changed",
      fileId: "f1",
      accessLabel: "Brautpaar",
      liked: true,
    });

    unsub();
  });

  it("carries comment.posted and selection.finalized", () => {
    const received: GalleryEvent[] = [];
    const unsub = subscribe(GALLERY_A, (e) => received.push(e));

    publish(GALLERY_A, {
      type: "comment.posted",
      fileId: "f1",
      commentId: "c1",
      authorLabel: "Sophia",
      body: "Mein Favorit",
    });
    publish(GALLERY_A, {
      type: "selection.finalized",
      accessId: "a1",
      accessLabel: "Brautpaar",
      count: 42,
    });

    expect(received).toHaveLength(2);
    expect(received[0].type).toBe("comment.posted");
    expect(received[1].type).toBe("selection.finalized");

    unsub();
  });
});
