"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  api,
  type BrandingDetail,
  type GalleryTemplate,
} from "@/lib/api";

export default function TemplateEditorPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [template, setTemplate] = useState<GalleryTemplate | null>(null);
  const [brandings, setBrandings] = useState<BrandingDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lokaler Edit-State
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"collaboration" | "presentation">(
    "collaboration"
  );
  const [downloadEnabled, setDownloadEnabled] = useState(true);
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [ratingsEnabled, setRatingsEnabled] = useState(true);
  const [defaultExpiryDays, setDefaultExpiryDays] = useState<string>("");
  const [defaultDescription, setDefaultDescription] = useState("");
  const [brandingId, setBrandingId] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const res = await api.getTemplate(id);
      setTemplate(res.template);
      setName(res.template.name);
      setDescription(res.template.description ?? "");
      setMode(res.template.mode as "collaboration" | "presentation");
      setDownloadEnabled(res.template.downloadEnabled);
      setWatermarkEnabled(res.template.watermarkEnabled);
      setCommentsEnabled(res.template.commentsEnabled);
      setRatingsEnabled(res.template.ratingsEnabled);
      setDefaultExpiryDays(
        res.template.defaultExpiryDays
          ? String(res.template.defaultExpiryDays)
          : ""
      );
      setDefaultDescription(res.template.defaultDescription ?? "");
      setBrandingId(res.template.brandingId ?? "");

      const bs = await api.listBrandings();
      setBrandings(bs.brandings);
    } catch (err) {
      if (err instanceof Error && err.message.includes("401")) {
        router.replace("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const days = defaultExpiryDays.trim()
        ? Number.parseInt(defaultExpiryDays, 10)
        : null;
      const { template: updated } = await api.updateTemplate(id, {
        name,
        description: description.trim() || null,
        mode,
        downloadEnabled,
        watermarkEnabled,
        commentsEnabled,
        ratingsEnabled,
        defaultExpiryDays: Number.isFinite(days) ? days : null,
        defaultDescription: defaultDescription.trim() || null,
        brandingId: brandingId || null,
      });
      setTemplate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (
      !confirm(
        "Template löschen? Bereits angelegte Galerien sind nicht betroffen."
      )
    )
      return;
    await api.deleteTemplate(id);
    router.push("/studio/templates");
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-slate-500">Lädt…</div>
      </main>
    );
  }
  if (!template) {
    return (
      <main className="min-h-screen p-8">
        <div className="text-sm text-red-700">
          {error ?? "Template nicht gefunden."}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="border-b border-slate-200 pb-4 flex items-end justify-between flex-wrap gap-2">
          <div>
            <div className="text-xs">
              <Link
                href="/studio/templates"
                className="text-slate-500 hover:text-slate-900"
              >
                ← Templates
              </Link>
            </div>
            <h1 className="text-2xl font-semibold mt-2">{template.name}</h1>
          </div>
          <div className="flex gap-2">
            <button
              onClick={remove}
              className="text-sm px-3 py-1.5 rounded-md border border-red-300 text-red-700 hover:bg-red-50"
            >
              Löschen
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="text-sm px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? "Speichert…" : "Speichern"}
            </button>
          </div>
        </header>

        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Beschreibung (intern)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Wann nutze ich dieses Template?"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Modus">
            <select
              value={mode}
              onChange={(e) =>
                setMode(e.target.value as "collaboration" | "presentation")
              }
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              <option value="collaboration">
                Collaboration (Auswahl, Likes, Kommentare)
              </option>
              <option value="presentation">
                Presentation (nur anschauen)
              </option>
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Toggle
              label="Download erlauben"
              value={downloadEnabled}
              onChange={setDownloadEnabled}
            />
            <Toggle
              label="Wasserzeichen aktiv"
              value={watermarkEnabled}
              onChange={setWatermarkEnabled}
            />
            <Toggle
              label="Kommentare"
              value={commentsEnabled}
              onChange={setCommentsEnabled}
            />
            <Toggle
              label="Ratings"
              value={ratingsEnabled}
              onChange={setRatingsEnabled}
            />
          </div>

          <Field label="Standard-Ablauf in Tagen (leer = unbegrenzt)">
            <input
              value={defaultExpiryDays}
              onChange={(e) =>
                setDefaultExpiryDays(e.target.value.replace(/[^0-9]/g, ""))
              }
              inputMode="numeric"
              placeholder="z.B. 30"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Default-Beschreibung für neue Galerien">
            <textarea
              value={defaultDescription}
              onChange={(e) => setDefaultDescription(e.target.value)}
              rows={3}
              placeholder="Wird als Default-Text in die Galerie übernommen — pro Galerie editierbar."
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Branding">
            <select
              value={brandingId}
              onChange={(e) => setBrandingId(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
            >
              <option value="">Tenant-Default</option>
              {brandings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        </section>
      </div>
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-slate-700">{label}</label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer py-1">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-slate-300"
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}
