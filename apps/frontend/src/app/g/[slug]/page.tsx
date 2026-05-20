"use client";

import { useCallback, useEffect, useState } from "react";
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

export default function PublicGalleryPage() {
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Files laden, sobald freigeschaltet
  const loadFiles = useCallback(async () => {
    try {
      const res = await api.listPublicFiles(slug);
      setFiles(res.files);
      setMySelections(res.mySelections ?? {});
      setFinalizedAt(res.finalizedAt);
      setCanSelect(res.canSelect);
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
          } catch {
            // Token war ungültig oder fehlend — egal, wenn die Galerie
            // ohne Passwort ist, machen wir mit den vorhandenen Files
            // weiter (anonymer Modus). Bei passwortgeschützten Galerien
            // landet der User stattdessen im UnlockForm.
            if (!needsPassword) await loadFiles();
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

  if (!meta.unlocked) {
    return (
      <GalleryShell
        branding={meta.branding}
        overrides={{
          colorBackground: meta.colors.background,
          colorAccent: meta.colors.accent,
          footerMarkdown: meta.footerMarkdown,
        }}
      >
        <UnlockForm
          slug={slug}
          meta={meta}
          urlToken={urlToken}
          onUnlocked={async () => {
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
      }}
    >
      <GalleryView
        meta={meta}
        slug={slug}
        files={files ?? []}
        mySelections={mySelections}
        finalizedAt={finalizedAt}
        canSelect={canSelect}
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
