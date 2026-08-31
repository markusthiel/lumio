/**
 * Tests für die Delete-Guards von DELETE /galleries/:id.
 *
 * canDeleteGallery() wird direkt aus gallery-access.ts importiert — die
 * Datei hat nur Typ-Imports (Prisma, SessionContext), also keine
 * Laufzeit-Abhängigkeit auf db.ts/config.ts (die beim Import fail-fast
 * echte Env-Vars/eine DB-Verbindung brauchen). Die Guard-Reihenfolge
 * (Berechtigung → archiviert → Druckbestellungen) selbst lebt inline in
 * der Route und wird hier als Kopie geprüft — Synchronisation per
 * Code-Review, gleiches Vorgehen wie in sections.test.ts/audit.test.ts.
 */
import { describe, it, expect } from "vitest";
import { canDeleteGallery } from "../lib/gallery-access.js";
import type { SessionContext } from "../services/auth.js";

const OWNER_ID = "11111111-2222-3333-4444-555555555555";
const OTHER_ID = "11111111-2222-3333-4444-666666666666";

function session(role: "owner" | "admin" | "member", userId: string) {
  return { user: { id: userId, role } } as unknown as SessionContext;
}

describe("canDeleteGallery", () => {
  it("admin may delete any gallery", () => {
    expect(
      canDeleteGallery(session("admin", OTHER_ID), { ownerId: OWNER_ID })
    ).toBe(true);
  });

  it("owner may delete their own gallery", () => {
    expect(
      canDeleteGallery(session("owner", OWNER_ID), { ownerId: OWNER_ID })
    ).toBe(true);
  });

  it("owner may not delete someone else's gallery", () => {
    expect(
      canDeleteGallery(session("owner", OTHER_ID), { ownerId: OWNER_ID })
    ).toBe(false);
  });

  it("member may never delete, even their own gallery", () => {
    expect(
      canDeleteGallery(session("member", OWNER_ID), { ownerId: OWNER_ID })
    ).toBe(false);
  });
});

// Guard-Reihenfolge aus der Route kopiert: Berechtigung zuerst, dann
// archiviert-Status, dann Druckbestellungen. Reihenfolge ist bewusst so,
// nicht vertauschbar — Test haelt das fest.
function evaluateDeleteGuards(
  s: SessionContext,
  gallery: { ownerId: string; status: string },
  printOrderCount: number
): "ok" | "delete_not_allowed" | "gallery_not_archived" | "gallery_has_print_orders" {
  if (!canDeleteGallery(s, gallery)) return "delete_not_allowed";
  if (gallery.status !== "archived") return "gallery_not_archived";
  if (printOrderCount > 0) return "gallery_has_print_orders";
  return "ok";
}

describe("DELETE /galleries/:id guard order", () => {
  it("allows deletion when archived, permitted and no print orders", () => {
    const s = session("owner", OWNER_ID);
    const gallery = { ownerId: OWNER_ID, status: "archived" };
    expect(evaluateDeleteGuards(s, gallery, 0)).toBe("ok");
  });

  it("rejects a live gallery even if otherwise deletable", () => {
    const s = session("owner", OWNER_ID);
    const gallery = { ownerId: OWNER_ID, status: "live" };
    expect(evaluateDeleteGuards(s, gallery, 0)).toBe("gallery_not_archived");
  });

  it("rejects an archived gallery with print orders", () => {
    const s = session("admin", OTHER_ID);
    const gallery = { ownerId: OWNER_ID, status: "archived" };
    expect(evaluateDeleteGuards(s, gallery, 1)).toBe("gallery_has_print_orders");
  });

  it("permission is checked before archived-state or print orders", () => {
    const s = session("owner", OTHER_ID); // not the gallery owner
    const gallery = { ownerId: OWNER_ID, status: "live" };
    expect(evaluateDeleteGuards(s, gallery, 5)).toBe("delete_not_allowed");
  });

  it("member is rejected regardless of ownership, status or orders", () => {
    const s = session("member", OWNER_ID);
    const gallery = { ownerId: OWNER_ID, status: "archived" };
    expect(evaluateDeleteGuards(s, gallery, 0)).toBe("delete_not_allowed");
  });
});
