"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  api,
  type PublicGalleryMeta,
  type PublicFile,
  type MySelection,
} from "@/lib/api";
import { GalleryView } from "@/components/gallery/GalleryView";
import { UnlockForm } from "@/components/gallery/UnlockForm";
import { GalleryShell } from "@/components/gallery/GalleryShell";
import { useT } from "@/lib/i18n";

// Next.js 16 verlangt einen <Suspense>-Boundary um useSearchParams() —
// sonst kann die Page nicht prerendert werden.
export default function PublicGalleryPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-surface-canvas">
          <div className="text-ui text-ink-tertiary">Lädt…</div>
        </div>
      }
    >
      <PublicGalleryInner />
    </Suspense>
  );
}

function PublicGalleryInner() {
  const params = useParams<{ slug: string }>();
  const search = useSearchParams();
  const slug = params.slug;
  const urlToken = search.get("t") ?? undefined;
  const t = useT();

  const [meta, setMeta] = useState<PublicGalleryMeta | null>(null);
  const [files, setFiles] = useState<PublicFile[] | null>(null);
  const [mySelections, setMySelections] = useState<Record<string, MySelection>>(
    {}
  );
  const [finalizedAt, setFinalizedAt] = useState<string | null>(null);
  const [canSelect, setCanSelect] = useState(false);
  const [myCommentFileIds, setMyCommentFileIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Zugang verweigert: Link abgelaufen bzw. Galerie nur mit Freigabe-Link.
  const [accessState, setAccessState] = useState<"expired" | "denied" | null>(
    null
  );
  // Der Freigabe-Link hat ein eigenes Passwort, das noch fehlt.
  const [needsLinkPassword, setNeedsLinkPassword] = useState(false);
  // Print-Shop: prueft ob fuer diese Galerie verfuegbar (Feature-Flag,
  // Tenant-Config, Galerie-Override). Catalog-Call ist der eindeutige
  // Indikator — er liefert 404 wenn nicht verfuegbar oder 401 wenn
  // die Galerie noch nicht freigeschaltet ist. Beides: Banner aus.
  // Effect MUSS hier oben stehen (vor den Early-Returns weiter unten),
  // sonst Hook-Ordering-Bug: 'Rendered more/fewer hooks than during
  // the previous render' → Client-Side Crash.
  const [printShopAvailable, setPrintShopAvailable] = useState(false);

  // Files laden, sobald freigeschaltet
  const loadFiles = useCallback(async () => {
    try {
      const res = await api.listPublicFiles(slug);
      setFiles(res.files);
      setMySelections(res.mySelections ?? {});
      setFinalizedAt(res.finalizedAt);
      setCanSelect(res.canSelect);
      setMyCommentFileIds(res.myCommentFileIds ?? []);
    } catch (err) {
      console.error(err);
    }
  }, [slug]);

  // Initial: Meta laden, ggf. automatisch mit URL-Token unlocken
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { gallery } = await api.getPublicGallery(slug);
        if (cancelled) return;
        setMeta(gallery);

        // Auto-Unlock-Logik:
        //
        // - Wenn ein Token in der URL ist, IMMER unlocken — auch wenn schon
        //   ein Visitor-Cookie existiert. Sonst kommen wir nie aus dem
        //   "alter anonymer Besuch"-State raus, wenn der Kunde später einen
        //   personalisierten Link bekommt. Ohne diese Re-Unlock wäre ein
        //   Wechsel von der nackten /g/<slug>-URL auf /g/<slug>?t=<token>
        //   bedeutungslos: das Cookie hat accessId=null und der Server
        //   würde das Token in der URL nie einlösen.
        //
        // - Wenn KEIN Token in der URL ist, aber auch kein Cookie da
        //   (gallery.unlocked === false) und auch kein Passwort gefordert,
        //   silent als anonymer Besucher unlocken (alter Picdrop-Style).
        const needsPassword = gallery.requiresPassword;
        const shouldUnlock =
          !!urlToken || (!gallery.unlocked && !needsPassword);
        if (shouldUnlock) {
          try {
            await api.unlockGallery(slug, {
              token: urlToken,
              // Passwort kommt aus dem UnlockForm — hier nur Token-Pfad
            });
            // Meta neu laden, um unlocked=true zu reflektieren
            const { gallery: g2 } = await api.getPublicGallery(slug);
            if (!cancelled) setMeta(g2);
            if (!cancelled) await loadFiles();
          } catch (e) {
            // Abgelaufener Link bzw. nicht-öffentliche Galerie ohne
            // gültigen Link → eigene Hinweis-Seite. Link mit eigenem
            // Passwort → Passwortformular. Sonst (ungültiges/fehlendes
            // Token bei öffentlicher Galerie) anonym weiter.
            const msg = e instanceof Error ? e.message : "";
            if (msg.includes("link_expired")) {
              if (!cancelled) setAccessState("expired");
            } else if (msg.includes("access_required")) {
              if (!cancelled) setAccessState("denied");
            } else if (msg.includes("password_required")) {
              // Link- oder Galerie-Passwort nötig → UnlockForm rendert
              // (meta.unlocked ist false). Bei reinem Link-Passwort muss
              // das Feld erzwungen werden.
              if (!cancelled) setNeedsLinkPassword(true);
            } else if (!needsPassword) {
              await loadFiles();
            }
          }
        } else if (gallery.unlocked) {
          await loadFiles();
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error && err.message.includes("not_found")
              ? t("gallery.notAvailableDesc")
              : err instanceof Error
              ? err.message
              : t("gallery.loadError")
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, urlToken, loadFiles, t]);

  // Print-Shop-Verfuegbarkeits-Check. Eigener Effect (eigene Dependency
  // [slug]) damit er nicht jedes Mal feuert wenn die Galerie-Meta-Logik
  // re-runs.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api.getGalleryPrintShopCatalog(slug);
        if (!cancelled) setPrintShopAvailable(true);
      } catch {
        if (!cancelled) setPrintShopAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) {
    return (
      <GalleryShell branding={null}>
        <div className="text-sm opacity-60 text-center py-20">
          {t("common.loading")}
        </div>
      </GalleryShell>
    );
  }
  if (error || !meta) {
    return (
      <GalleryShell branding={null}>
        <div className="text-center py-20 max-w-md mx-auto">
          <div className="text-lg font-medium">{t("gallery.notAvailable")}</div>
          <div className="text-sm opacity-60 mt-2">
            {error ?? t("gallery.loadFailed")}
          </div>
        </div>
      </GalleryShell>
    );
  }

  if (accessState) {
    return (
      <GalleryShell branding={meta?.branding ?? null}>
        <div className="text-center py-20 max-w-md mx-auto">
          <div className="text-lg font-medium">
            {accessState === "expired"
              ? t("gallery.linkExpiredTitle")
              : t("gallery.noAccessTitle")}
          </div>
          <div className="text-sm opacity-60 mt-2">
            {accessState === "expired"
              ? t("gallery.linkExpiredBody")
              : t("gallery.noAccessBody")}
          </div>
        </div>
      </GalleryShell>
    );
  }

  // UnlockForm auch zeigen, wenn der Link ein Passwort verlangt — selbst
  // wenn ein altes (anonymes) Cookie die Galerie als "unlocked" meldet.
  // Sonst käme bei vorher offener Galerie die leere Galerie statt des
  // Passwort-Formulars.
  if (!meta.unlocked || needsLinkPassword) {
    return (
      <GalleryShell
        branding={meta.branding}
        overrides={{
          colorBackground: meta.colors.background,
          colorAccent: meta.colors.accent,
          footerMarkdown: meta.footerMarkdown,
          fontHeading: meta.fonts.heading,
          fontBody: meta.fonts.body,
          // Unlock-Screen rendert keinen Hero — Branding-Header
          // ist hier gewuenscht.
          hideHeaderLogo: false,
        }}
      >
        <UnlockForm
          slug={slug}
          meta={meta}
          urlToken={urlToken}
          requirePassword={needsLinkPassword}
          onUnlocked={async () => {
            setNeedsLinkPassword(false);
            const { gallery: g2 } = await api.getPublicGallery(slug);
            setMeta(g2);
            await loadFiles();
          }}
        />
      </GalleryShell>
    );
  }

  return (
    <GalleryShell
      branding={meta.branding}
      overrides={{
        colorBackground: meta.colors.background,
        colorAccent: meta.colors.accent,
        footerMarkdown: meta.footerMarkdown,
        fontHeading: meta.fonts.heading,
        fontBody: meta.fonts.body,
        hideHeaderLogo: !!meta.header.eventLogoUrl,
      }}
    >
      <GalleryView
        meta={meta}
        slug={slug}
        files={files ?? []}
        mySelections={mySelections}
        myCommentFileIds={myCommentFileIds}
        finalizedAt={finalizedAt}
        canSelect={canSelect}
        printShopAvailable={printShopAvailable}
        onSelectionChange={(fileId, sel) =>
          setMySelections((prev) => ({ ...prev, [fileId]: sel }))
        }
        onFinalize={async () => {
          try {
            const res = await api.finalizeSelection(slug);
            setFinalizedAt(res.finalizedAt);
          } catch (err) {
            console.error(err);
          }
        }}
      />
    </GalleryShell>
  );
}
