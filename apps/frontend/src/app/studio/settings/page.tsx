"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, type TenantSettings } from "@/lib/api";

export default function StudioSettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [textSaving, setTextSaving] = useState(false);
  const [imageSaving, setImageSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function load() {
    try {
      const res = await api.getTenantSettings();
      setSettings(res.tenant);
      setText(res.tenant.watermarkText ?? "");
    } catch (err) {
      if (err instanceof Error && err.message.includes("401")) {
        router.replace("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveText() {
    setTextSaving(true);
    setError(null);
    try {
      const res = await api.updateTenantSettings({
        watermarkText: text.trim() || null,
      });
      setSettings(res.tenant);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setTextSaving(false);
    }
  }

  async function uploadImage(file: File) {
    setImageSaving(true);
    setError(null);
    try {
      const init = await api.initWatermarkImageUpload({
        contentType: file.type,
        sizeBytes: file.size,
      });
      // Direkt zu S3
      const put = await fetch(init.uploadUrl, {
        method: "PUT",
        headers: init.headers,
        body: file,
      });
      if (!put.ok) {
        throw new Error(`Upload fehlgeschlagen: HTTP ${put.status}`);
      }
      await api.completeWatermarkImageUpload(init.key);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setImageSaving(false);
    }
  }

  async function removeImage() {
    if (!confirm("Watermark-Bild wirklich entfernen?")) return;
    setImageSaving(true);
    try {
      await api.deleteWatermarkImage();
      await load();
    } finally {
      setImageSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-slate-500">Lädt…</div>
      </main>
    );
  }
  if (!settings) {
    return (
      <main className="min-h-screen p-8">
        <div className="text-sm text-red-700">
          {error ?? "Settings konnten nicht geladen werden."}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="border-b border-slate-200 pb-4">
          <div className="text-xs">
            <Link href="/studio" className="text-slate-500 hover:text-slate-900">
              ← Studio
            </Link>
          </div>
          <h1 className="text-2xl font-semibold mt-2">Einstellungen</h1>
          <p className="text-sm text-slate-500">{settings.name}</p>
        </header>

        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {/* Watermark-Text */}
        <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-medium">Wasserzeichen — Text</h2>
          <p className="text-xs text-slate-500">
            Wird als wiederholtes diagonales Muster über Vorschaubilder gelegt,
            wenn eine Galerie auf <em>watermarkEnabled</em> steht und kein
            Bild-Wasserzeichen hochgeladen ist. Leer = Studio-Name wird
            verwendet.
          </p>
          <div className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={settings.name}
              maxLength={200}
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              onClick={saveText}
              disabled={textSaving}
              className="text-sm px-3 py-2 rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {textSaving ? "Speichert…" : "Speichern"}
            </button>
          </div>
        </section>

        {/* Watermark-Bild */}
        <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-medium">Wasserzeichen — Bild</h2>
          <p className="text-xs text-slate-500">
            PNG oder JPEG, transparenter Hintergrund empfohlen. Wird mit 35 %
            Opazität mittig über die Vorschau gelegt — bei aktiviertem
            Wasserzeichen statt des Text-Musters.
          </p>

          {settings.watermarkImageKey ? (
            <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded px-3 py-2">
              <div className="text-xs font-mono truncate">
                {settings.watermarkImageKey.split("/").pop()}
              </div>
              <button
                onClick={removeImage}
                disabled={imageSaving}
                className="text-xs text-red-600 hover:underline disabled:opacity-50"
              >
                Entfernen
              </button>
            </div>
          ) : (
            <div className="text-xs text-slate-400">
              Kein Wasserzeichen-Bild hochgeladen.
            </div>
          )}

          <div>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadImage(f);
                if (e.target) e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInput.current?.click()}
              disabled={imageSaving}
              className="text-sm px-3 py-2 rounded-md border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
            >
              {imageSaving
                ? "Lädt hoch…"
                : settings.watermarkImageKey
                ? "Bild ersetzen"
                : "Bild hochladen"}
            </button>
            <span className="text-xs text-slate-400 ml-2">
              Max. 20 MiB · PNG/JPEG
            </span>
          </div>

          <div className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded p-2">
            <strong>Hinweis:</strong> Eine Änderung wirkt erst, wenn das
            Wasserzeichen einer Galerie neu generiert wird. Schalte
            <em> watermarkEnabled</em> aus und wieder an, oder warte auf den
            nächsten Upload.
          </div>
        </section>
      </div>
    </main>
  );
}
