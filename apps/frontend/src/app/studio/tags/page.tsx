"use client";

/**
 * Studio /studio/tags
 *
 * Tag-Verwaltung pro Tenant: anlegen, umbenennen, Farbe ändern, löschen,
 * Hierarchie umsetzen via parent. Flache Liste, nach Parent gruppiert
 * (Root-Tags zuerst, dann ihre Kinder eingerückt). Tree-View ohne
 * Drag-and-Drop ist mit n=100 Tags noch lesbar; mehr ist unwahrscheinlich.
 *
 * Counts (galleries + files je Tag) zeigen wir an, damit der Aufräum-
 * Workflow ("welche Tags brauche ich nicht mehr?") direkt funktioniert.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type TagSummary } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { PageHeader } from "@/components/studio/PageHeader";
import { Button } from "@/components/ui";

const DEFAULT_COLORS = [
  "#94a3b8", // slate
  "#f97316", // orange
  "#ef4444", // red
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#a855f7", // purple
  "#ec4899", // pink
];

export default function TagsPage() {
  const t = useT();
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listTags();
      setTags(res.tags);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Tree-Sortierung: Root-Tags zuerst, jeweils gefolgt von ihren Kindern.
  // Wir gehen rekursiv ein-mal durch — mit n=100 ist O(n²) im Worst Case
  // noch lächerlich schnell.
  const sortedTree = useMemo(() => {
    const byParent = new Map<string | null, TagSummary[]>();
    for (const t of tags) {
      const key = t.parentId ?? null;
      const arr = byParent.get(key) ?? [];
      arr.push(t);
      byParent.set(key, arr);
    }
    const out: Array<{ tag: TagSummary; depth: number }> = [];
    function walk(parentId: string | null, depth: number) {
      const kids = (byParent.get(parentId) ?? []).slice().sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );
      for (const k of kids) {
        out.push({ tag: k, depth });
        walk(k.id, depth + 1);
      }
    }
    walk(null, 0);
    return out;
  }, [tags]);

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Studio", href: "/studio" },
          { label: t("studio.tagsTitle") },
        ]}
        title={t("studio.tagsTitle")}
        description={t("studio.tagsDescription")}
        actions={
          <Button onClick={() => setCreating(true)}>
            {t("studio.tagCreate")}
          </Button>
        }
      />

      <div className="px-6 sm:px-8 py-6 max-w-4xl space-y-4">
        {loading ? (
          <div className="text-ui text-ink-tertiary">{t("common.loading")}</div>
        ) : sortedTree.length === 0 && !creating ? (
          <div className="rounded-md border border-line-subtle bg-surface-raised p-8 text-center">
            <div className="text-ui text-ink-secondary mb-1">
              {t("studio.tagsEmpty")}
            </div>
            <div className="text-ui-sm text-ink-tertiary">
              {t("studio.tagsEmptyHint")}
            </div>
          </div>
        ) : (
          <ul className="rounded-md border border-line-subtle bg-surface-raised divide-y divide-line-subtle">
            {sortedTree.map(({ tag, depth }) => (
              <li key={tag.id}>
                {editingId === tag.id ? (
                  <EditTagRow
                    tag={tag}
                    tags={tags}
                    onSaved={async () => {
                      setEditingId(null);
                      await load();
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <TagRow
                    tag={tag}
                    depth={depth}
                    onEdit={() => setEditingId(tag.id)}
                    onDeleted={load}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {creating && (
          <CreateTagInline
            tags={tags}
            onCreated={async () => {
              setCreating(false);
              await load();
            }}
            onCancel={() => setCreating(false)}
          />
        )}
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
function TagRow({
  tag,
  depth,
  onEdit,
  onDeleted,
}: {
  tag: TagSummary;
  depth: number;
  onEdit: () => void;
  onDeleted: () => Promise<void> | void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!confirm(t("studio.tagConfirmDelete", { name: tag.name }))) return;
    setBusy(true);
    try {
      await api.deleteTag(tag.id);
      await onDeleted();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5"
      style={{ paddingLeft: `${16 + depth * 20}px` }}
    >
      <span
        className="block w-3 h-3 rounded-full flex-shrink-0"
        style={{ backgroundColor: tag.color }}
        aria-hidden
      />
      <span className="text-ui text-ink-primary flex-1 min-w-0 truncate">
        {tag.name}
      </span>
      <span className="text-ui-xs text-ink-tertiary tabular-nums flex-shrink-0">
        {tag.galleryCount} {t("studio.tagCountGalleries")} ·{" "}
        {tag.fileCount} {t("studio.tagCountFiles")}
      </span>
      <Button size="sm" variant="ghost" onClick={onEdit} disabled={busy}>
        {t("common.edit")}
      </Button>
      <Button size="sm" variant="danger" onClick={remove} disabled={busy}>
        {t("common.delete")}
      </Button>
    </div>
  );
}

// -----------------------------------------------------------------------------
function EditTagRow({
  tag,
  tags,
  onSaved,
  onCancel,
}: {
  tag: TagSummary;
  tags: TagSummary[];
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const [parentId, setParentId] = useState<string | null>(tag.parentId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parent-Dropdown: keine eigenen Nachfahren (würde Cycle erzeugen).
  const descendantIds = useMemo(() => {
    const set = new Set<string>();
    const queue = [tag.id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      set.add(cur);
      for (const x of tags) {
        if (x.parentId === cur) queue.push(x.id);
      }
    }
    return set;
  }, [tag.id, tags]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.updateTag(tag.id, { name, color, parentId });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-3 bg-surface-sunken space-y-2">
      <div className="grid grid-cols-[auto_1fr_auto] gap-2 items-center">
        <ColorPicker value={color} onChange={setColor} />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 px-2 rounded bg-surface-canvas border border-line-subtle text-ui text-ink-primary focus:border-accent focus:outline-none"
        />
        <select
          value={parentId ?? ""}
          onChange={(e) => setParentId(e.target.value || null)}
          className="h-8 px-2 rounded bg-surface-canvas border border-line-subtle text-ui-sm text-ink-primary"
        >
          <option value="">{t("studio.tagNoParent")}</option>
          {tags
            .filter((x) => !descendantIds.has(x.id))
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </select>
      </div>
      {error && <div className="text-ui-sm text-semantic-danger">{error}</div>}
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button
          size="sm"
          onClick={save}
          disabled={busy || !name.trim()}
        >
          {busy ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
function CreateTagInline({
  tags,
  onCreated,
  onCancel,
}: {
  tags: TagSummary[];
  onCreated: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLORS[0]);
  const [parentId, setParentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api.createTag({ name, color, parentId });
      await onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-line-strong bg-surface-raised p-4 space-y-2">
      <div className="grid grid-cols-[auto_1fr_auto] gap-2 items-center">
        <ColorPicker value={color} onChange={setColor} />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("studio.tagNamePlaceholder")}
          className="h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle text-ui text-ink-primary focus:border-accent focus:outline-none"
          autoFocus
        />
        <select
          value={parentId ?? ""}
          onChange={(e) => setParentId(e.target.value || null)}
          className="h-9 px-2 rounded bg-surface-sunken border border-line-subtle text-ui-sm text-ink-primary"
        >
          <option value="">{t("studio.tagNoParent")}</option>
          {tags.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </div>
      {error && <div className="text-ui-sm text-semantic-danger">{error}</div>}
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button
          size="sm"
          onClick={create}
          disabled={busy || !name.trim()}
        >
          {busy ? t("common.creating") : t("common.create")}
        </Button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1">
      {DEFAULT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={c}
          className={`w-5 h-5 rounded-full border-2 transition-all duration-motion ${
            value.toLowerCase() === c.toLowerCase()
              ? "border-ink-primary scale-110"
              : "border-transparent hover:scale-110"
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}
