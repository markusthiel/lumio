"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  api,
  type SmartCollection,
  type TagSummary,
  type GalleryFilter,
} from "@/lib/api";
import { PageHeader } from "@/components/studio/PageHeader";
import { Button, Input } from "@/components/ui";
import { useT } from "@/lib/i18n";

/**
 * Smart-Collection-Bearbeiten-Seite. Wird verlinkt aus der Galerien-
 * Liste wenn eine Collection aktiv ist. Erlaubt Umbenennen, Icon,
 * und die Filter-Werte zu editieren.
 */
export default function CollectionEditPage() {
  const t = useT();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [collection, setCollection] = useState<SmartCollection | null>(null);
  const [allTags, setAllTags] = useState<TagSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [filter, setFilter] = useState<GalleryFilter>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cs, tagsRes] = await Promise.all([
        api.listCollections(),
        api.listTags(),
      ]);
      const c = cs.collections.find((cc) => cc.id === id);
      if (!c) {
        router.replace("/studio");
        return;
      }
      setCollection(c);
      setName(c.name);
      setIcon(c.icon ?? "");
      setFilter(c.filter ?? {});
      setAllTags(tagsRes.tags);
    } catch {
      router.replace("/login");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      await api.updateCollection(id, {
        name: name.trim(),
        icon: icon.trim() || null,
        filter,
      });
      router.push("/studio");
    } finally {
      setSaving(false);
    }
  }

  function toggleTag(tagId: string) {
    setFilter((f) => {
      const cur = new Set(f.tagIds ?? []);
      if (cur.has(tagId)) cur.delete(tagId);
      else cur.add(tagId);
      return { ...f, tagIds: cur.size > 0 ? Array.from(cur) : undefined };
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-ui text-ink-tertiary">
        Lädt…
      </div>
    );
  }
  if (!collection) return null;

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Studio", href: "/studio" },
          { label: "Smart Collections" },
        ]}
        title="Smart Collection bearbeiten"
      />
      <div className="px-6 sm:px-8 lg:px-12 py-6 max-w-2xl space-y-6">
        <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 space-y-3">
          <h2 className="text-sm font-medium">{t("collections.nameIcon")}</h2>
          <div>
            <label className="block text-ui-xs uppercase tracking-wide text-ink-tertiary mb-1">
              Name
            </label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="block text-ui-xs uppercase tracking-wide text-ink-tertiary mb-1">
              Icon (Emoji, optional)
            </label>
            <Input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              maxLength={4}
            />
          </div>
        </section>

        <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 space-y-3">
          <h2 className="text-sm font-medium">{t("collections.filter")}</h2>
          <p className="text-xs text-ink-tertiary">
            Alle Filter sind UND-verknüpft — eine Galerie muss alle
            gesetzten Bedingungen erfüllen um in der Collection zu
            erscheinen.
          </p>

          <div>
            <label className="block text-ui-xs uppercase tracking-wide text-ink-tertiary mb-1">
              Modus
            </label>
            <select
              value={filter.mode ?? ""}
              onChange={(e) =>
                setFilter((f) => ({
                  ...f,
                  mode: (e.target.value as GalleryFilter["mode"]) || undefined,
                }))
              }
              className="h-9 px-2 rounded-xs text-ui-sm bg-surface-sunken border border-line-subtle w-full"
            >
              <option value="">{t("collections.any")}</option>
              <option value="collaboration">{t("collections.selProofing")}</option>
              <option value="presentation">{t("collections.presentation")}</option>
            </select>
          </div>

          <div>
            <label className="block text-ui-xs uppercase tracking-wide text-ink-tertiary mb-1">
              Status
            </label>
            <select
              value={filter.status ?? ""}
              onChange={(e) =>
                setFilter((f) => ({
                  ...f,
                  status:
                    (e.target.value as GalleryFilter["status"]) || undefined,
                }))
              }
              className="h-9 px-2 rounded-xs text-ui-sm bg-surface-sunken border border-line-subtle w-full"
            >
              <option value="">{t("collections.any")}</option>
              <option value="draft">{t("collections.draft")}</option>
              <option value="live">{t("collections.active")}</option>
              <option value="archived">{t("collections.archived")}</option>
            </select>
          </div>

          {allTags.length > 0 && (
            <div>
              <label className="block text-ui-xs uppercase tracking-wide text-ink-tertiary mb-2">
                Tags (alle gewählten müssen vorhanden sein)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {allTags.map((tag) => {
                  const active = (filter.tagIds ?? []).includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className="inline-flex items-center gap-1 h-7 px-2.5 rounded-xs text-ui-xs transition-all duration-motion"
                      style={{
                        backgroundColor: active ? tag.color : tag.color + "22",
                        color: active ? "#fff" : tag.color,
                        border: `1px solid ${tag.color}${active ? "" : "44"}`,
                      }}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => router.push("/studio")}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={save} disabled={saving || !name.trim()}>
            {saving ? "Speichert…" : t("common.save")}
          </Button>
        </div>
      </div>
    </>
  );
}
