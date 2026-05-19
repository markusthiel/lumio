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

export default function PublicGalleryPage() {
  const params = useParams<{ slug: string }>();
  const search = useSearchParams();
  const slug = params.slug;
  const urlToken = search.get("t") ?? undefined;

  const [meta, setMeta] = useState<PublicGalleryMeta | null>(null);
  const [files, setFiles] = useState<PublicFile[] | null>(null);
  const [mySelections, setMySelections] = useState<Record<string, MySelection>>(
    {}
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Files laden, sobald freigeschaltet
  const loadFiles = useCallback(async () => {
    try {
      const res = await api.listPublicFiles(slug);
      setFiles(res.files);
      setMySelections(res.mySelections ?? {});
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

        // Wenn ein Token in der URL ist und/oder kein Passwort nötig:
        // direkt unlocken (silent).
        const needsPassword = gallery.requiresPassword;
        if (!gallery.unlocked && (!needsPassword || urlToken)) {
          try {
            await api.unlockGallery(slug, {
              token: urlToken,
              // Passwort kommt aus dem UnlockForm — hier nur Token-Pfad
            });
            if (!needsPassword) {
              // Meta neu laden, um unlocked=true zu reflektieren
              const { gallery: g2 } = await api.getPublicGallery(slug);
              if (!cancelled) setMeta(g2);
              if (!cancelled) await loadFiles();
            }
          } catch {
            // Token war ungültig — egal, Anonym-Modus
            if (!needsPassword) await loadFiles();
          }
        } else if (gallery.unlocked) {
          await loadFiles();
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error && err.message.includes("not_found")
              ? "Diese Galerie existiert nicht oder ist nicht mehr verfügbar."
              : err instanceof Error
              ? err.message
              : "Fehler beim Laden"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, urlToken, loadFiles]);

  if (loading) {
    return (
      <GalleryShell branding={null}>
        <div className="text-sm opacity-60 text-center py-20">Lädt…</div>
      </GalleryShell>
    );
  }
  if (error || !meta) {
    return (
      <GalleryShell branding={null}>
        <div className="text-center py-20 max-w-md mx-auto">
          <div className="text-lg font-medium">Nicht verfügbar</div>
          <div className="text-sm opacity-60 mt-2">
            {error ?? "Galerie konnte nicht geladen werden."}
          </div>
        </div>
      </GalleryShell>
    );
  }

  if (!meta.unlocked) {
    return (
      <GalleryShell branding={meta.branding}>
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
    <GalleryShell branding={meta.branding}>
      <GalleryView
        meta={meta}
        slug={slug}
        files={files ?? []}
        mySelections={mySelections}
        onSelectionChange={(fileId, sel) =>
          setMySelections((prev) => ({ ...prev, [fileId]: sel }))
        }
      />
    </GalleryShell>
  );
}
