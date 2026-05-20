"use client";

/**
 * Globale Studio-Suche.
 *
 * Modale Such-Palette mit Live-Ergebnissen über Galerien, Files,
 * Brandings und Templates. Aufruf:
 *   - Klick auf den Sidebar-Suchen-Button
 *   - Tastatur-Shortcut Cmd/Ctrl + K
 *
 * Bedienung:
 *   - Tippen: 250ms debounced API-Call, ab 2 Zeichen
 *   - ↑/↓: Treffer durchsteppen (kategorienübergreifend)
 *   - Enter: ausgewähltes Item öffnen
 *   - Esc: Schließen
 *   - Klick außerhalb: Schließen
 *
 * Implementierung als eigenes Modal statt Sidebar-Dropdown, weil die
 * Sidebar zu schmal (~220px) für lesbare Treffer mit Galerie-Kontext
 * ist. Eine Command-Palette ist auch dem Pattern treuer, das Studios
 * von VS Code/Linear/etc. gewohnt sind.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { api, type SearchResults } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface Props {
  open: boolean;
  onClose: () => void;
}

// Ein flacher Treffer-Typ, damit ↑/↓-Navigation über alle Kategorien
// hinweg über einen einzigen Array iterieren kann. Wir bauen diesen
// vom kategorisierten API-Result ab.
type FlatHit =
  | { kind: "gallery"; id: string; href: string; primary: string; secondary: string }
  | { kind: "file"; id: string; href: string; primary: string; secondary: string }
  | { kind: "branding"; id: string; href: string; primary: string; secondary: string }
  | { kind: "template"; id: string; href: string; primary: string; secondary: string };

export function GlobalSearchModal({ open, onClose }: Props) {
  const t = useT();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  // Input-Ref für Auto-Focus beim Öffnen + Esc-Cleanup
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce-Token: bei jedem Keystroke wird der vorherige Timer
  // abgebrochen. Saubereres Pattern als useDebounce-Hook, weil wir den
  // pending-Effect-Cleanup direkt erkennen können.
  useEffect(() => {
    if (!open) {
      // Beim Schließen den Such-State zurücksetzen, damit das nächste
      // Öffnen wieder mit leerem Feld startet. Sonst sieht der User
      // veraltete Treffer.
      setQuery("");
      setResults(null);
      setActiveIdx(0);
      return;
    }
    // Beim Öffnen Input fokussieren
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.searchGlobal(query.trim(), 5);
        if (!cancelled) {
          setResults(res);
          setActiveIdx(0);
        }
      } catch {
        if (!cancelled) setResults(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  // Flache Trefferliste für Tastatur-Navigation
  const flatHits = useMemo<FlatHit[]>(() => {
    if (!results) return [];
    const out: FlatHit[] = [];
    for (const g of results.galleries) {
      out.push({
        kind: "gallery",
        id: g.id,
        href: `/studio/${g.id}`,
        primary: g.title,
        secondary: `${g.slug} · ${g.status}`,
      });
    }
    for (const f of results.files) {
      out.push({
        kind: "file",
        id: f.id,
        href: `/studio/${f.galleryId}`,
        primary: f.filename,
        secondary: f.galleryTitle,
      });
    }
    for (const b of results.brandings) {
      out.push({
        kind: "branding",
        id: b.id,
        href: `/studio/brandings`,
        primary: b.name,
        secondary: t("studio.searchKindBranding"),
      });
    }
    for (const tpl of results.templates) {
      out.push({
        kind: "template",
        id: tpl.id,
        href: `/studio/templates`,
        primary: tpl.name,
        secondary: t("studio.searchKindTemplate"),
      });
    }
    return out;
  }, [results, t]);

  const handleOpen = useCallback(
    (hit: FlatHit) => {
      router.push(hit.href);
      onClose();
    },
    [router, onClose]
  );

  // Tastatur-Handler
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(flatHits.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hit = flatHits[activeIdx];
      if (hit) handleOpen(hit);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-20 pb-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-md border border-line-strong bg-surface-raised shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line-subtle px-4 py-3">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder={t("studio.searchPlaceholder")}
            className="w-full bg-transparent border-0 outline-none text-ui-md text-ink-primary placeholder:text-ink-tertiary"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-2">
          {query.trim().length < 2 ? (
            <div className="px-4 py-3 text-ui-sm text-ink-tertiary">
              {t("studio.searchHint")}
            </div>
          ) : loading && !results ? (
            <div className="px-4 py-3 text-ui-sm text-ink-tertiary">
              {t("common.loading")}
            </div>
          ) : flatHits.length === 0 ? (
            <div className="px-4 py-3 text-ui-sm text-ink-tertiary">
              {t("studio.searchEmpty")}
            </div>
          ) : (
            <SearchHitList
              results={results!}
              flatHits={flatHits}
              activeIdx={activeIdx}
              onHover={setActiveIdx}
              onOpen={handleOpen}
            />
          )}
        </div>

        <div className="border-t border-line-subtle px-4 py-2 text-ui-xs text-ink-tertiary flex items-center justify-between">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> {t("studio.searchHintNavigate")} ·{" "}
            <Kbd>Enter</Kbd> {t("studio.searchHintOpen")} ·{" "}
            <Kbd>Esc</Kbd> {t("studio.searchHintClose")}
          </span>
          {results?.truncated && (
            <span>{t("studio.searchTruncated")}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
function SearchHitList({
  results,
  flatHits,
  activeIdx,
  onHover,
  onOpen,
}: {
  results: SearchResults;
  flatHits: FlatHit[];
  activeIdx: number;
  onHover: (idx: number) => void;
  onOpen: (hit: FlatHit) => void;
}) {
  const t = useT();

  // Wir rendern die Kategorien sequenziell und tracken parallel die Indices
  // in flatHits, damit ↑↓-Navigation korrekt scrollt
  let runningIdx = 0;
  const sections: Array<{ label: string; from: number; count: number }> = [];
  if (results.galleries.length > 0) {
    sections.push({
      label: t("studio.searchKindGalleries"),
      from: runningIdx,
      count: results.galleries.length,
    });
    runningIdx += results.galleries.length;
  }
  if (results.files.length > 0) {
    sections.push({
      label: t("studio.searchKindFiles"),
      from: runningIdx,
      count: results.files.length,
    });
    runningIdx += results.files.length;
  }
  if (results.brandings.length > 0) {
    sections.push({
      label: t("studio.searchKindBrandings"),
      from: runningIdx,
      count: results.brandings.length,
    });
    runningIdx += results.brandings.length;
  }
  if (results.templates.length > 0) {
    sections.push({
      label: t("studio.searchKindTemplates"),
      from: runningIdx,
      count: results.templates.length,
    });
    runningIdx += results.templates.length;
  }

  return (
    <>
      {sections.map((sec) => (
        <div key={sec.label} className="mb-1 last:mb-0">
          <div className="px-4 py-1.5 text-ui-xs uppercase tracking-[0.12em] text-ink-tertiary">
            {sec.label}
          </div>
          <ul>
            {flatHits
              .slice(sec.from, sec.from + sec.count)
              .map((h, i) => {
                const absIdx = sec.from + i;
                const active = absIdx === activeIdx;
                return (
                  <li key={`${h.kind}:${h.id}`}>
                    <button
                      onMouseMove={() => onHover(absIdx)}
                      onClick={() => onOpen(h)}
                      className={`w-full text-left px-4 py-2 flex items-center gap-3 transition-colors duration-motion ${
                        active
                          ? "bg-accent/10 text-ink-primary"
                          : "text-ink-secondary hover:bg-surface-sunken"
                      }`}
                    >
                      <KindIcon kind={h.kind} />
                      <div className="min-w-0 flex-1">
                        <div className="text-ui truncate">{h.primary}</div>
                        <div className="text-ui-xs text-ink-tertiary truncate">
                          {h.secondary}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </>
  );
}

function KindIcon({ kind }: { kind: FlatHit["kind"] }) {
  // Kleine monochrome Inline-SVGs — wir nutzen kein Icon-Set, damit das
  // Bundle nicht für eine Suchpalette wachsen muss.
  const cls = "w-4 h-4 flex-shrink-0 text-ink-tertiary";
  if (kind === "gallery") {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="1.5" />
        <path d="M21 16 L15 10 L3 21" />
      </svg>
    );
  }
  if (kind === "file") {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M14 3 H6 a2 2 0 0 0 -2 2 v14 a2 2 0 0 0 2 2 h12 a2 2 0 0 0 2 -2 V9 z" />
        <path d="M14 3 v6 h6" />
      </svg>
    );
  }
  if (kind === "branding") {
    return (
      <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3 v18 M3 12 h18" />
      </svg>
    );
  }
  // template
  return (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="6" rx="1" />
      <rect x="3" y="13" width="8" height="8" rx="1" />
      <rect x="14" y="13" width="7" height="8" rx="1" />
    </svg>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block px-1 py-0.5 text-[10px] font-mono bg-surface-sunken border border-line-subtle rounded-xs text-ink-secondary">
      {children}
    </kbd>
  );
}
