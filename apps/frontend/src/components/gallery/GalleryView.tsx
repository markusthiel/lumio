"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ApiError,
  type PublicFile,
  type PublicGalleryMeta,
  type PublicSection,
  type MySelection,
  type Comment,
} from "@/lib/api";
import { VideoPlayer } from "./VideoPlayer";
import { ZipDownloadButton } from "./ZipDownloadButton";
import { Slideshow } from "./Slideshow";
import { GalleryHero } from "./GalleryHero";
import { ShareButton } from "./ShareButton";
import { usePickedFiles } from "./usePickedFiles";
import { useT } from "@/lib/i18n";
import { useReveal } from "@/lib/useReveal";
import {
  AnnotationOverlay,
  AnnotationToolbar,
  type AnnotationStroke,
  type AnnotationTool,
  type AnnotationColor,
  type AnnotationData,
} from "@/components/annotation/AnnotationOverlay";

interface Props {
  meta: PublicGalleryMeta;
  slug: string;
  files: PublicFile[];
  mySelections: Record<string, MySelection>;
  finalizedAt: string | null;
  canSelect: boolean;
  onSelectionChange: (fileId: string, sel: MySelection) => void;
  onFinalize: () => void | Promise<void>;
}

type FilterMode = "all" | "liked" | "red" | "yellow" | "green";

export function GalleryView({
  meta,
  slug,
  files,
  mySelections,
  finalizedAt,
  canSelect,
  onSelectionChange,
  onFinalize,
}: Props) {
  const t = useT();
  const [filter, setFilter] = useState<FilterMode>("all");
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [slideshowIdx, setSlideshowIdx] = useState<number | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  // Pick-Modus: Customer kann Bilder ad-hoc markieren und gezielt
  // herunterladen, unabhängig vom Like/Selection-System des
  // Collaboration-Modus. State lebt im localStorage, der Server kriegt
  // die IDs nur bei der ZIP-Anfrage. Funktioniert in allen Galerie-
  // Modes (auch presentation), solange downloads aktiviert sind.
  const [pickMode, setPickMode] = useState(false);
  const picks = usePickedFiles(slug);

  // Auswahl-Interaktion ist nur möglich, wenn (a) die Galerie überhaupt im
  // collaboration-Modus ist und (b) der Visitor einen Access-Token hat,
  // der canSelect erlaubt. Ohne (b) wäre jeder Like-Versuch eine 403-Falle
  // gewesen und der Kunde hätte sich gefragt, warum nach Reload alles weg
  // ist. Wir bündeln das als interactive-Boolean und blenden die Auswahl-UI
  // aus, wenn es nicht passt.
  const interactive = meta.mode === "collaboration" && canSelect;

  const filtered = useMemo(() => {
    if (filter === "all") return files;
    return files.filter((f) => {
      const sel = mySelections[f.id];
      if (!sel) return false;
      if (filter === "liked") return sel.liked;
      return sel.color === filter;
    });
  }, [files, mySelections, filter]);

  // Die Lightbox und der Click-Handler müssen die GLEICHE Reihenfolge
  // sehen wie das Galerie-Grid — sonst springt der "Weiter"-Pfeil zu
  // unerwarteten Bildern (vorher: filtered + Sections wurden angezeigt,
  // aber Lightbox kriegte die globale files-Liste).
  //
  // Drei Anzeige-Modi:
  //   - keine Sections, oder Filter aktiv → ein flaches Grid mit
  //     `filtered` in der globalen Sortier-Reihenfolge.
  //   - Sections + filter=all → Default-Bucket (sectionId=null) zuerst,
  //     dann pro Section in deren sortIndex-Reihenfolge.
  //
  // Wir spiegeln genau das hier, damit Lightbox und Grid synchron sind.
  const orderedFiles = useMemo(() => {
    const sectionsActive = meta.sections.length > 0 && filter === "all";
    if (!sectionsActive) return filtered;
    const out: PublicFile[] = [];
    // Default-Bucket: alle Files ohne sectionId, in ihrer globalen
    // Reihenfolge (filtered ist schon nach sortIndex aus dem Backend
    // sortiert).
    for (const f of filtered) {
      if (f.sectionId === null) out.push(f);
    }
    // Dann pro Section (in der Reihenfolge wie meta.sections):
    for (const section of meta.sections) {
      for (const f of filtered) {
        if (f.sectionId === section.id) out.push(f);
      }
    }
    return out;
  }, [filtered, meta.sections, filter]);

  const stats = useMemo(() => {
    const sels = Object.values(mySelections);
    return {
      total: files.length,
      liked: sels.filter((s) => s.liked).length,
      red: sels.filter((s) => s.color === "red").length,
      yellow: sels.filter((s) => s.color === "yellow").length,
      green: sels.filter((s) => s.color === "green").length,
    };
  }, [files, mySelections]);

  return (
    <>
      {/* Hero — kann personalisiert sein (Hero-Bild, Logo, Welcome-
          Markdown, Overlay-Farbe). Wenn keine Customization gesetzt
          ist, sieht's aus wie der bisherige minimale Hero. */}
      <GalleryHero meta={meta}>
        <div className="text-ui-xs opacity-50 mt-6 flex items-center gap-3 flex-wrap uppercase tracking-[0.12em]">
          <span>
            {stats.total} {t("gallery.files")}
          </span>
          {/* "Liked"-Counter — zeigt entweder nur den Stand oder, wenn der
              Photograph ein Auswahllimit gesetzt hat, "X von Y". Bei
              erreichtem Limit hebt sich das Element farblich ab, damit
              der Kunde sofort sieht: ich kann gerade nichts mehr dazu
              tun ohne erst was abzuwählen. */}
          {meta.mode === "collaboration" &&
            (stats.liked > 0 || meta.selectionLimit !== null) && (
              <>
                <span className="opacity-30">·</span>
                <span
                  className={
                    meta.selectionLimit !== null &&
                    stats.liked >= meta.selectionLimit
                      ? "text-brand-accent"
                      : ""
                  }
                >
                  {meta.selectionLimit !== null ? (
                    <>
                      {t("gallery.likedOutOf", {
                        liked: stats.liked,
                        limit: meta.selectionLimit,
                      })}
                    </>
                  ) : (
                    <>
                      {stats.liked} {t("gallery.liked")}
                    </>
                  )}
                </span>
              </>
            )}
          {finalizedAt && (
            <>
              <span className="opacity-30">·</span>
              <span className="text-semantic-success">
                {t("gallery.finalized")}
              </span>
            </>
          )}
          {/* Read-only-Hinweis: Galerie wäre eigentlich Collaboration-Mode,
              aber dieser Visitor hat keinen Access-Token mit Auswahl-Recht.
              Ohne diesen Hinweis würde der Kunde glauben, das UI sei kaputt:
              Klick aufs Herz, kurz Like-Icon, Reload, weg. */}
          {meta.mode === "collaboration" && !canSelect && (
            <>
              <span className="opacity-30">·</span>
              <span className="text-ink-tertiary normal-case tracking-normal">
                {t("gallery.viewOnlyHint")}
              </span>
            </>
          )}
        </div>
      </GalleryHero>

      {/* Sticky-Toolbar — verbleibt am oberen Rand beim Scrollen.
          Backdrop-blur sorgt für saubere Trennung über den Bildern.
          Background-Color und Border-Farbe kommen aus den --brand-*
          CSS-Variablen die GalleryShell setzt — bei hellem Branding
          wird der Streifen eine helle Eintönung statt einem grauen
          "0.45 Schwarz auf Weiß"-Streifen. */}
      <div
        className="sticky top-0 z-20 backdrop-blur-md"
        style={{
          backgroundColor: "var(--brand-toolbar-bg)",
          borderTop: "1px solid var(--brand-border)",
          borderBottom: "1px solid var(--brand-border)",
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-12 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-1.5 flex-wrap">
            {interactive && stats.total > 0 ? (
              <>
                <FilterChip
                  active={filter === "all"}
                  onClick={() => setFilter("all")}
                  label={t("gallery.filterAll", { count: stats.total })}
                />
                <FilterChip
                  active={filter === "liked"}
                  onClick={() => setFilter("liked")}
                  label={`★ ${stats.liked}`}
                />
                <FilterChip
                  active={filter === "green"}
                  onClick={() => setFilter("green")}
                  label={`${stats.green}`}
                  dot="bg-green-500"
                />
                <FilterChip
                  active={filter === "yellow"}
                  onClick={() => setFilter("yellow")}
                  label={`${stats.yellow}`}
                  dot="bg-yellow-500"
                />
                <FilterChip
                  active={filter === "red"}
                  onClick={() => setFilter("red")}
                  label={`${stats.red}`}
                  dot="bg-red-500"
                />
              </>
            ) : (
              <span className="text-ui-xs opacity-50 uppercase tracking-[0.12em] self-center">
                {meta.mode === "presentation"
                  ? t("gallery.modePresentation")
                  : ""}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {stats.total > 0 && (
              <button
                onClick={() => setSlideshowIdx(0)}
                className="text-ui-sm px-3 h-8 rounded inline-flex items-center gap-1.5 bg-brand-accent text-brand-accent-contrast font-medium hover:opacity-90 transition-opacity duration-motion"
                title={t("gallery.slideshowStartTitle")}
              >
                <PlayMiniIcon />
                <span>{t("gallery.slideshowStart")}</span>
              </button>
            )}
            {/* Pick-Modus-Toggle — nur sichtbar wenn Downloads aktiviert
                und es überhaupt Files gibt. Im pickMode zeigen Tiles
                Checkboxes; Klick aufs Tile = picken statt Lightbox. */}
            {meta.downloadEnabled && stats.total > 0 && (
              <button
                onClick={() => setPickMode((m) => !m)}
                style={{
                  borderColor: "var(--brand-border)",
                  color: "var(--brand-fg)",
                  backgroundColor: pickMode
                    ? "var(--brand-surface-hover)"
                    : "var(--brand-surface)",
                }}
                className="text-ui-sm px-3 h-8 rounded inline-flex items-center gap-1.5 border transition-colors duration-motion"
                title={t("gallery.pickModeHint")}
                aria-pressed={pickMode}
              >
                <svg
                  viewBox="0 0 16 16"
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="2" y="2" width="12" height="12" rx="2" />
                  {pickMode && <polyline points="4.5 8 7 10.5 11.5 5.5" />}
                </svg>
                <span>
                  {pickMode
                    ? t("gallery.pickModeExit")
                    : t("gallery.pickModeEnter")}
                </span>
                {picks.size > 0 && (
                  <span
                    style={{
                      backgroundColor: "rgb(var(--brand-accent))",
                      color: "rgb(var(--brand-accent-contrast))",
                    }}
                    className="ml-1 px-1.5 rounded-full text-[10px] font-medium font-mono"
                  >
                    {picks.size}
                  </span>
                )}
              </button>
            )}
            {interactive &&
              stats.liked > 0 &&
              !finalizedAt && (
                <button
                  onClick={async () => {
                    setFinalizing(true);
                    try {
                      await onFinalize();
                    } finally {
                      setFinalizing(false);
                    }
                  }}
                  disabled={finalizing}
                  className="text-ui-sm px-3 h-8 rounded inline-flex items-center bg-brand-accent text-brand-accent-contrast font-medium hover:opacity-90 disabled:opacity-50 transition-opacity duration-motion"
                >
                  {finalizing ? t("gallery.finalizing") : t("gallery.finalize")}
                </button>
              )}
            {meta.downloadEnabled && stats.total > 0 && (
              <>
                {meta.downloadOriginalsEnabled && (
                  <ZipDownloadButton
                    slug={slug}
                    kind="all"
                    variant="original"
                    emphasis="primary"
                  />
                )}
                <ZipDownloadButton
                  slug={slug}
                  kind="all"
                  variant="web"
                  emphasis={meta.downloadOriginalsEnabled ? "ghost" : "primary"}
                />
                {interactive && stats.liked > 0 && (
                  <>
                    {meta.downloadOriginalsEnabled && (
                      <ZipDownloadButton
                        slug={slug}
                        kind="selection"
                        variant="original"
                        count={stats.liked}
                        emphasis="primary"
                      />
                    )}
                    <ZipDownloadButton
                      slug={slug}
                      kind="selection"
                      variant="web"
                      count={stats.liked}
                      emphasis={
                        meta.downloadOriginalsEnabled ? "ghost" : "primary"
                      }
                    />
                  </>
                )}
              </>
            )}
            {/* Teilen-Button steht ganz rechts in der Toolbar — Kunden
                können die Galerie per Web-Share-API teilen (mobil
                meistens nativ, sonst Clipboard-Fallback). Die OG-Tags
                im Page-Layout sorgen für die schöne Vorschau im
                Empfänger-Client. */}
            <ShareButton title={meta.title} />
          </div>
        </div>
      </div>

      {/* Sticky Sections-Navi — nur wenn die Galerie Sections hat
          UND der User nicht gefiltert hat (Section-Anker mit aktivem
          Like/Color-Filter wäre verwirrend). Wir zählen die Sections
          mit Files; eine leere Section wird nicht in die Navi
          aufgenommen. Plus optional ein "Übersicht"-Anker für den
          Default-Bucket wenn der existiert. */}
      {meta.sections.length > 0 && filter === "all" && (
        <SectionsNav
          sections={meta.sections}
          files={filtered}
          hasDefaultBucket={filtered.some((f) => f.sectionId === null)}
        />
      )}

      {/* Grid — extra Bottom-Padding wenn die sticky Picked-Bar
          aktiv ist, sonst überdeckt sie die letzten Tiles. */}
      <section
        className={`px-4 sm:px-6 md:px-12 pt-6 max-w-7xl mx-auto ${
          picks.size > 0 ? "pb-32" : "pb-16"
        }`}
      >
        {filtered.length === 0 ? (
          <div className="text-center py-32 opacity-50 text-ui">
            {filter === "all"
              ? t("gallery.noFiles")
              : t("gallery.noFilesForFilter")}
          </div>
        ) : meta.sections.length === 0 || filter !== "all" ? (
          /* Klassisches Hauptraster: keine Sections angelegt ODER
             aktiver Filter (in dem Fall ignorieren wir Sections,
             damit der Filter sinnvoll bleibt). */
          <FilesGrid
            files={filtered}
            mode={meta.gridLayout}
            mySelections={mySelections}
            onOpen={(f) =>
              setLightboxIdx(orderedFiles.findIndex((ff) => ff.id === f.id))
            }
          pickMode={pickMode}
                        pickedIds={picks.picked}
                        onTogglePick={picks.toggle}
                      />
        ) : (
          /* Sections-Modus: Default-Bucket zuerst, dann pro Section
             ein Trennband mit Cover und Titel, dann die Section-Files.
             Files behalten ihre globale Reihenfolge innerhalb des
             Buckets. */
          <div className="space-y-12">
            {(() => {
              const defaultFiles = filtered.filter((f) => f.sectionId === null);
              const filesBySection = new Map<string, typeof filtered>();
              for (const f of filtered) {
                if (f.sectionId) {
                  const arr = filesBySection.get(f.sectionId) ?? [];
                  arr.push(f);
                  filesBySection.set(f.sectionId, arr);
                }
              }
              return (
                <>
                  {defaultFiles.length > 0 && (
                    <div id="section-default">
                      <FilesGrid
                        files={defaultFiles}
                        mode={meta.gridLayout}
                        mySelections={mySelections}
                        onOpen={(f) =>
                          setLightboxIdx(
                            orderedFiles.findIndex((ff) => ff.id === f.id)
                          )
                        }
                      pickMode={pickMode}
                        pickedIds={picks.picked}
                        onTogglePick={picks.toggle}
                      />
                    </div>
                  )}
                  {meta.sections.map((section) => {
                    const sectionFiles = filesBySection.get(section.id) ?? [];
                    if (sectionFiles.length === 0) return null;
                    return (
                      <div key={section.id} id={`section-${section.id}`}>
                        <SectionDivider section={section} />
                        <FilesGrid
                          files={sectionFiles}
                          mode={meta.gridLayout}
                          mySelections={mySelections}
                          onOpen={(f) =>
                            setLightboxIdx(
                              orderedFiles.findIndex((ff) => ff.id === f.id)
                            )
                          }
                        pickMode={pickMode}
                        pickedIds={picks.picked}
                        onTogglePick={picks.toggle}
                      />
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>
        )}
      </section>

      {/* Lightbox — bekommt die identisch sortierte Liste wie das
          Galerie-Grid, damit "Weiter"/"Zurück" der erwarteten
          Reihenfolge folgt (vorher: globale files-Liste, was bei
          Sections oder Filter zu Sprüngen führte). */}
      {lightboxIdx !== null && (
        <Lightbox
          files={orderedFiles}
          index={lightboxIdx}
          slug={slug}
          meta={meta}
          interactive={interactive}
          mySelections={mySelections}
          onClose={() => setLightboxIdx(null)}
          onNavigate={(i) => setLightboxIdx(i)}
          onSelectionChange={onSelectionChange}
        />
      )}

      {/* Slideshow — Fullscreen-Auto-Play. Bewusst NICHT an die Lightbox-
          Selektion gebunden — die Slideshow zeigt immer die volle Galerie
          in DOM-Reihenfolge, nicht den aktuellen Filter. Ein gefiltertes
          Slideshow-Behaviour wäre nett-to-have, würde aber den UX-Mental-
          Model unklarer machen ("warum sehe ich nur 3 Bilder?"). */}
      {slideshowIdx !== null && (
        <Slideshow
          files={files}
          startIndex={slideshowIdx}
          transition={meta.slideshowTransition}
          audioUrl={meta.slideshowAudioUrl}
          onClose={() => setSlideshowIdx(null)}
        />
      )}

      {/* Picked-Bottom-Bar — sticky am unteren Rand sobald >=1 Pick.
          Bietet Download als Original / Web + Auswahl-Leeren. Auch
          sichtbar ohne aktiven pickMode, damit der Customer seine
          aufgebaute Auswahl nicht verliert wenn er den pickMode
          ausgeschaltet hat ("ich hab 5 Bilder gepickt, will jetzt
          aber wieder browsen — die 5 sollen aber bleiben"). */}
      {picks.size > 0 && meta.downloadEnabled && (
        <div
          className="fixed bottom-0 left-0 right-0 z-30 backdrop-blur-md"
          style={{
            backgroundColor: "var(--brand-toolbar-bg)",
            borderTop: "1px solid var(--brand-border)",
          }}
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-12 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div
              className="text-ui-sm flex items-center gap-3"
              style={{ color: "var(--brand-fg)" }}
            >
              <span
                style={{
                  backgroundColor: "rgb(var(--brand-accent))",
                  color: "rgb(var(--brand-accent-contrast))",
                }}
                className="px-2 py-0.5 rounded-full font-medium font-mono text-ui-xs"
              >
                {picks.size}
              </span>
              <span>{t("gallery.pickedCount", { count: picks.size })}</span>
              <button
                onClick={() => picks.clear()}
                style={{ color: "var(--brand-fg-muted)" }}
                className="text-ui-xs underline opacity-80 hover:opacity-100"
              >
                {t("gallery.pickedClear")}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {meta.downloadOriginalsEnabled && (
                <ZipDownloadButton
                  slug={slug}
                  kind="picked"
                  variant="original"
                  count={picks.size}
                  fileIds={picks.asArray()}
                  emphasis="primary"
                />
              )}
              <ZipDownloadButton
                slug={slug}
                kind="picked"
                variant="web"
                count={picks.size}
                fileIds={picks.asArray()}
                emphasis={
                  meta.downloadOriginalsEnabled ? "ghost" : "primary"
                }
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PlayMiniIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden>
      <path d="M2.5 1.5v7l6-3.5-6-3.5z" />
    </svg>
  );
}

// -----------------------------------------------------------------------------
// Tile — IntersectionObserver für Reveal-Animation
// -----------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Sub-Komponenten: FilesGrid + SectionsNav + SectionDivider
// ---------------------------------------------------------------------------

/** Rendert eine Liste von Files im gewählten Grid-Layout. War früher
 *  inline in GalleryView; extrahiert weil Sections-Modus dieselbe
 *  Rendering-Logik mehrfach braucht (Default-Bucket + ein Aufruf pro
 *  Section).
 *
 *  Wichtig zur Lightbox-Navigation: der `onOpen`-Callback bekommt die
 *  File übergeben und der Caller mappt zurück auf den Index in der
 *  GLOBALEN files-Liste — so kann die Lightbox section-übergreifend
 *  navigieren ohne dass sie überhaupt von Sections wissen muss. */
function FilesGrid({
  files,
  mode,
  mySelections,
  onOpen,
  pickMode,
  pickedIds,
  onTogglePick,
}: {
  files: PublicFile[];
  mode: "justified" | "equal";
  mySelections: Record<string, MySelection>;
  onOpen: (f: PublicFile) => void;
  pickMode: boolean;
  pickedIds: Set<string>;
  onTogglePick: (fileId: string) => void;
}) {
  if (mode === "justified") {
    return (
      <div className="flex flex-wrap gap-2 sm:gap-3">
        {files.map((f, i) => (
          <GalleryTile
            key={f.id}
            file={f}
            index={i}
            sel={mySelections[f.id]}
            mode="justified"
            onOpen={() => onOpen(f)}
            pickMode={pickMode}
            isPicked={pickedIds.has(f.id)}
            onTogglePick={() => onTogglePick(f.id)}
          />
        ))}
        <i className="grow-[10] block" aria-hidden="true" />
      </div>
    );
  }
  // Default: equal — gleichgroße quadratische Tiles in zeilenweise
  // Anordnung. Das war historisch der "masonry"-Modus seit Commit
  // 0b61a86 und ist jetzt der Standard. Echtes CSS-Columns-Masonry
  // ist entfernt weil es die Lese-Reihenfolge gegen die Lightbox-
  // Navigation zerriss (Spalten oben→unten statt Reihen links→rechts).
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {files.map((f, i) => (
        <GalleryTile
          key={f.id}
          file={f}
          index={i}
          sel={mySelections[f.id]}
          mode="equal"
          onOpen={() => onOpen(f)}
          pickMode={pickMode}
          isPicked={pickedIds.has(f.id)}
          onTogglePick={() => onTogglePick(f.id)}
        />
      ))}
    </div>
  );
}

/** Sticky-Bar mit Section-Titeln als Anker-Links. Versteckt sich
 *  wenn nur eine Section + kein Default-Bucket existieren (Navi wäre
 *  redundant). */
function SectionsNav({
  sections,
  files,
  hasDefaultBucket,
}: {
  sections: PublicSection[];
  files: PublicFile[];
  hasDefaultBucket: boolean;
}) {
  const t = useT();
  // Nur Sections mit mindestens einem File im aktuellen filtered-Set
  // anzeigen — leere Sections in der Navi sind verwirrend.
  const usedSectionIds = new Set(
    files.map((f) => f.sectionId).filter((id): id is string => !!id)
  );
  const visible = sections.filter((s) => usedSectionIds.has(s.id));

  // Wenn nichts zu zeigen ist (alles im Default-Bucket oder gar
  // nichts), Navi unterdrücken.
  if (visible.length === 0) return null;

  // Smooth-Scroll-Handler. Statt nativer Anker-Sprünge nutzen wir
  // scrollIntoView mit smooth-Behavior und einem kleinen Offset für
  // den Sticky-Header.
  const onJump = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const target = document.getElementById(id);
    if (!target) return;
    const offset = 80; // ungefähr der Platz für den Sticky-Header
    const top = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <nav className="sticky top-0 z-20 backdrop-blur bg-[color:rgb(0_0_0/0.15)] border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-12 py-2 flex items-center gap-1 overflow-x-auto">
        {hasDefaultBucket && (
          <a
            href="#section-default"
            onClick={onJump("section-default")}
            className="text-ui-sm px-2.5 h-8 rounded inline-flex items-center hover:bg-white/10 whitespace-nowrap transition-colors duration-motion"
          >
            {t("gallery.sectionDefault")}
          </a>
        )}
        {visible.map((section) => (
          <a
            key={section.id}
            href={`#section-${section.id}`}
            onClick={onJump(`section-${section.id}`)}
            className="text-ui-sm px-2.5 h-8 rounded inline-flex items-center hover:bg-white/10 whitespace-nowrap transition-colors duration-motion"
          >
            {section.title}
          </a>
        ))}
      </div>
    </nav>
  );
}

/** Trennband im Grid: optional Cover-Bild als Banner, dann Titel und
 *  Description. */
function SectionDivider({ section }: { section: PublicSection }) {
  return (
    <div className="pt-4">
      {section.coverThumbUrl ? (
        /* Mit Cover: 25vh hoher Banner, Titel im unteren Drittel mit
           Gradient für Lesbarkeit. */
        <div className="relative h-[25vh] min-h-[160px] sm:min-h-[200px] rounded-lg overflow-hidden mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={section.coverThumbUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6 text-white">
            <h2 className="text-display-md sm:text-display-lg font-medium tracking-tight">
              {section.title}
            </h2>
            {section.description && (
              <p className="text-ui-md opacity-90 mt-1 max-w-2xl">
                {section.description}
              </p>
            )}
          </div>
        </div>
      ) : (
        /* Ohne Cover: dezenter Texttrenner. */
        <div className="border-t border-white/10 pt-6 mb-6">
          <h2 className="text-display-md font-medium tracking-tight">
            {section.title}
          </h2>
          {section.description && (
            <p className="text-ui-md opacity-70 mt-1 max-w-2xl">
              {section.description}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function GalleryTile({
  file,
  index,
  sel,
  mode,
  onOpen,
  pickMode,
  isPicked,
  onTogglePick,
}: {
  file: PublicFile;
  index: number;
  sel: MySelection | undefined;
  mode: "justified" | "equal";
  onOpen: () => void;
  /** Wenn true: Klick aufs Tile = toggle pick statt Lightbox. */
  pickMode: boolean;
  isPicked: boolean;
  onTogglePick: () => void;
}) {
  const { ref, revealed } = useReveal<HTMLDivElement>();
  // Aspect-Ratio aus den File-Dimensionen, mit sicherem Fallback.
  // Nur fürs justified-Layout relevant — masonry und equal sind
  // quadratisch und nutzen aspect-square.
  const aspectRatio =
    file.width && file.height ? file.width / file.height : 1;

  // Reveal-Distanz wird per CSS-Var gesteuert (motion-Setting),
  // hier nur das Delay je nach Index. Cap bei 24, sonst gefühlt zu lang.
  const delay = `${Math.min(index, 24) * 30}ms`;

  // Wrapper-Styling pro Mode.
  let wrapperClass: string;
  let wrapperStyle: React.CSSProperties = {
    opacity: revealed ? 1 : 0,
    transform: revealed
      ? "translateY(0)"
      : "translateY(var(--motion-reveal-y, 8px))",
    transition:
      "opacity var(--motion-reveal, 280ms) var(--motion-ease) " +
      delay +
      ", transform var(--motion-reveal, 280ms) var(--motion-ease) " +
      delay,
  };

  if (mode === "justified") {
    // Justified: feste Reihen-Höhe (ca. 200-260px je nach Viewport),
    // Breite proportional zum Aspect-Ratio, flex-grow erlaubt das
    // Aufpumpen pro Reihe.
    wrapperClass = "relative overflow-hidden rounded";
    wrapperStyle = {
      ...wrapperStyle,
      height: "240px",
      // flex-basis = height * aspect = die "natürliche" Breite
      // für diese Höhe. flex-grow lässt CSS die Bilder pro Reihe
      // aufstrecken bis die Reihe voll ist.
      flexBasis: `${240 * aspectRatio}px`,
      flexGrow: aspectRatio,
    };
  } else {
    // Equal: quadratisch, object-cover macht den Rest.
    wrapperClass = "relative overflow-hidden rounded aspect-square";
  }

  return (
    <div
      ref={ref}
      className={wrapperClass}
      style={{
        ...wrapperStyle,
        // content-visibility: auto erlaubt dem Browser, Layout/Paint
        // für offscreen-Tiles komplett zu überspringen — der DOM-Knoten
        // bleibt, aber Style+Paint+Hit-Test laufen nur wenn das Tile
        // im (erweiterten) Viewport ist. Bei einer Galerie mit 1000
        // Bildern reduziert das die Style-/Layout-Kosten dramatisch
        // — wir testen mit 500-2000 Tiles und kommen auf flüssiges
        // Scrolling auf Mid-Range-Mobiles.
        //
        // contain-intrinsic-size gibt dem Browser eine Größen-
        // Schätzung für nicht-gerenderte Tiles, damit Scrollbar und
        // anchor-Navigation funktionieren. Bei equal-Mode sind alle
        // Tiles quadratisch und ca. 240px breit; justified hat
        // variable Breiten, aber 240px Höhe ist hardgecoded oben.
        // Der Wert ist eine Schätzung — Browser cached die echte
        // Größe nach dem ersten Render und nutzt sie ab dann.
        contentVisibility: "auto",
        containIntrinsicSize:
          mode === "justified" ? "240px 240px" : "240px 240px",
      }}
    >
      <button
        onClick={() => (pickMode ? onTogglePick() : onOpen())}
        className={`block w-full h-full overflow-hidden rounded bg-white/5 relative group focus:outline-none ${
          pickMode && isPicked
            ? "ring-2 ring-offset-2 ring-offset-transparent"
            : ""
        }`}
        style={
          pickMode && isPicked
            ? { boxShadow: "0 0 0 3px var(--brand-accent, #f59e0b)" }
            : undefined
        }
        aria-pressed={pickMode ? isPicked : undefined}
      >
        {file.thumbUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={file.thumbUrl}
            alt={file.filename}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-motion ease-out group-hover:scale-[1.02]"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ui-xs opacity-40">
            {file.kind}
          </div>
        )}

        {/* Video-Indikator */}
        {file.kind === "video" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-12 h-12 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center text-white text-lg drop-shadow">
              ▶
            </div>
          </div>
        )}

        {/* Format-Indikator für RAW + HEIC. Beide kommen aus
            Pro/Smartphone-Workflows, in beiden Fällen rendert Lumio dem
            Kunden eine Web-Variante (WebP) — das Original wäre auf
            Windows ohne Codec eh schwierig. Das Badge ist Information,
            nicht Warnung. */}
        {(file.kind === "raw" || file.kind === "heic") && (
          <div className="absolute bottom-2 right-2 text-ui-xs font-mono uppercase bg-black/60 backdrop-blur-sm text-white px-1.5 py-0.5 rounded-xs">
            {file.kind === "raw" ? "RAW" : "HEIC"}
          </div>
        )}

        {/* Selection-Indikatoren */}
        {sel?.color && (
          <div className="absolute top-2 left-2">
            <span
              className={`block w-3 h-3 rounded-full ring-2 ring-white/60 ${
                sel.color === "red"
                  ? "bg-red-500"
                  : sel.color === "yellow"
                  ? "bg-yellow-500"
                  : "bg-green-500"
              }`}
            />
          </div>
        )}
        {sel?.liked && (
          <div className="absolute top-2 right-2 text-amber-300 text-lg drop-shadow-lg">
            ★
          </div>
        )}

        {/* Pick-Checkbox-Overlay — nur sichtbar im pickMode. Bei
            isPicked: voller Akzent-Kreis mit Häkchen. Sonst: weißer
            outlined Kreis, semi-transparent damit das Bild durch-
            scheint. Position oben-links überlappt mit color-Selektor
            (sel.color), aber sel.color nur in Collaboration und
            pickMode kann der User selber temporär aktivieren — in
            der Praxis kommt selten beides gleichzeitig vor. Wir
            verschieben den Pick-Checkbox bei vorhandenem sel.color
            ein bisschen. */}
        {pickMode && (
          <div
            className={`absolute ${sel?.color ? "top-2 left-9" : "top-2 left-2"}`}
            aria-hidden="true"
          >
            <span
              className="flex items-center justify-center w-6 h-6 rounded-full border-2 backdrop-blur-sm transition-colors duration-motion"
              style={
                isPicked
                  ? {
                      backgroundColor: "rgb(var(--brand-accent))",
                      borderColor: "rgb(var(--brand-accent))",
                      color: "rgb(var(--brand-accent-contrast))",
                    }
                  : {
                      backgroundColor: "rgba(0,0,0,0.4)",
                      borderColor: "rgba(255,255,255,0.7)",
                      color: "transparent",
                    }
              }
            >
              {isPicked && (
                <svg
                  viewBox="0 0 16 16"
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="3 8 7 12 13 4" />
                </svg>
              )}
            </span>
          </div>
        )}
      </button>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  dot?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        backgroundColor: active ? "var(--brand-fg)" : "transparent",
        color: active ? "var(--brand-bg, transparent)" : "var(--brand-fg)",
        borderColor: active ? "var(--brand-fg)" : "var(--brand-border)",
        opacity: active ? 1 : 0.7,
      }}
      className="text-ui-xs h-7 px-3 rounded-full border transition-colors duration-motion ease-out flex items-center gap-1.5 hover:opacity-100"
    >
      {dot && <span className={`w-2 h-2 rounded-full ${dot}`} />}
      {label}
    </button>
  );
}

// -----------------------------------------------------------------------------
// Lightbox
// -----------------------------------------------------------------------------
function Lightbox({
  files,
  index,
  slug,
  meta,
  interactive,
  mySelections,
  onClose,
  onNavigate,
  onSelectionChange,
}: {
  files: PublicFile[];
  index: number;
  slug: string;
  meta: PublicGalleryMeta;
  interactive: boolean;
  mySelections: Record<string, MySelection>;
  onClose: () => void;
  onNavigate: (idx: number) => void;
  onSelectionChange: (fileId: string, sel: MySelection) => void;
}) {
  const t = useT();
  // Defensiv: wenn `index` aus der Range fällt (z.B. weil der User die
  // Liste gefiltert hat und das letzte sichtbare Bild war weiter
  // hinten), schließen wir die Lightbox lautlos. Vor dem Fix war der
  // Crash 'cannot read properties of undefined (id)'.
  const file = files[index];
  useEffect(() => {
    if (!file) onClose();
  }, [file, onClose]);
  if (!file) return null;

  const sel = mySelections[file.id] ?? {
    color: null,
    rating: null,
    liked: false,
  };
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [showHints, setShowHints] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [commentPending, setCommentPending] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);

  // Annotation-Editor — eigene Strokes pro Bild im State. Wird beim
  // Bild-Wechsel gespült (siehe useEffect unten) und vorher als
  // Comment persistiert wenn was gemalt wurde.
  //
  // Default-Tool ist 'freehand', sobald der User die Lightbox öffnet —
  // sonst hat er die Toolbar im Blick aber wundert sich warum Klicks
  // aufs Bild nichts tun. Er kann jederzeit zu Pfeil wechseln oder
  // das Tool wieder ausschalten durch nochmaligen Klick auf das aktive.
  const [annotationTool, setAnnotationTool] =
    useState<AnnotationTool | null>("freehand");

  // Zwei Bedienmodi am unteren Rand: 'pick' = Farb-Tags + Auswahl-Stern,
  // 'mark' = Annotation-Werkzeuge (Stift/Pfeil + 3 Farben). Default
  // 'pick' weil das der häufigere Workflow ist (Kunde wählt Bilder),
  // 'mark' ist für detailliertes Feedback.
  const [bottomMode, setBottomMode] = useState<"pick" | "mark">("pick");
  const [annotationColor, setAnnotationColor] =
    useState<AnnotationColor>("red");
  const [myStrokes, setMyStrokes] = useState<AnnotationStroke[]>([]);
  // Ref-Mirror für Cleanup-Effect (state ist beim Cleanup-Run schon stale)
  const myStrokesRef = useRef<AnnotationStroke[]>([]);
  useEffect(() => {
    myStrokesRef.current = myStrokes;
  }, [myStrokes]);

  // Tastatur-Navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && index > 0) onNavigate(index - 1);
      else if (e.key === "ArrowRight" && index < files.length - 1)
        onNavigate(index + 1);
      else if (e.key === " " && interactive) {
        e.preventDefault();
        void toggleLike();
      } else if (
        ["1", "2", "3"].includes(e.key) &&
        interactive
      ) {
        const color =
          e.key === "1" ? "red" : e.key === "2" ? "yellow" : "green";
        void setColor(color as "red" | "yellow" | "green");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, files, onClose, onNavigate, sel.liked, sel.color, interactive]);

  // Keyboard-Hints nach 5s ausblenden, damit sie nicht stören
  useEffect(() => {
    const id = setTimeout(() => setShowHints(false), 5000);
    return () => clearTimeout(id);
  }, []);

  // Kommentare lazy laden — UND immer für die Annotation-Extraktion.
  // Wir laden einmal pro Bild, egal ob die Sidebar offen ist, damit
  // gespeicherte Annotationen anderer auf dem Bild sichtbar werden.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listComments(slug, file.id);
        if (!cancelled) setComments(res.comments);
      } catch {
        if (!cancelled) setComments([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, file.id]);

  // Annotationen aus den geladenen Comments extrahieren. Wir flachen
  // alle strokes aus jedem Comment in eine einzige Liste. Wenn ein
  // Comment ein authorIsStudio=true hat, taggen wir die strokes mit
  // author='studio' damit der Renderer gestrichelt zeichnet; sonst
  // 'customer'. Eigene noch nicht-persistierte strokes (myStrokes)
  // Annotationen aus den geladenen Comments extrahieren. Wir flachen
  // alle strokes aus jedem Comment in eine einzige Liste. Wenn ein
  // Comment ein authorIsStudio=true hat, taggen wir die strokes mit
  // author='studio' damit der Renderer gestrichelt zeichnet; sonst
  // 'customer'. Eigene noch nicht-persistierte strokes (myStrokes)
  // werden separat behandelt und gerendert.
  const existingAnnotations: AnnotationStroke[] = useMemo(() => {
    if (!comments) return [];
    const out: AnnotationStroke[] = [];
    for (const c of comments) {
      const data = c.annotation as AnnotationData | null | undefined;
      if (!data || data.version !== 1 || !Array.isArray(data.strokes)) continue;
      const tag: "customer" | "studio" = c.authorIsStudio
        ? "studio"
        : "customer";
      for (const s of data.strokes) {
        out.push({ ...s, author: tag });
      }
    }
    return out;
  }, [comments]);

  // Annotation-Auto-Save beim Bild-Wechsel ODER beim Schließen der
  // Lightbox. Wir merken uns die fileId per ref, damit der Cleanup
  // weiß zu welchem File die Strokes gehörten — beim nächsten Render
  // ist `file.id` schon das NEUE Bild. Ein Comment wird nur erzeugt
  // wenn tatsächlich Strokes gezeichnet wurden; leeres Annotation-
  // Array würden wir nicht persistieren wollen.
  const savedFileIdRef = useRef<string>(file.id);
  useEffect(() => {
    const previousFileId = savedFileIdRef.current;
    if (previousFileId !== file.id) {
      // Wir wechseln gerade vom previous-File. Strokes für das alte
      // committen falls vorhanden.
      const strokes = myStrokesRef.current;
      if (strokes.length > 0 && interactive && meta.commentsEnabled) {
        const annotation: AnnotationData = { version: 1, strokes };
        void api
          .postComment(slug, previousFileId, { body: "", annotation })
          .catch(() => {
            /* Annotation-Save-Fehler still — der User hat das Bild eh
             * schon verlassen, ein Toast hier wäre verwirrend. */
          });
      }
      // State für das neue File resetten
      setMyStrokes([]);
      savedFileIdRef.current = file.id;
    }
    return () => {
      // Unmount: ebenfalls letzte Strokes committen
      const strokes = myStrokesRef.current;
      if (
        strokes.length > 0 &&
        interactive &&
        meta.commentsEnabled &&
        savedFileIdRef.current === file.id
      ) {
        const annotation: AnnotationData = { version: 1, strokes };
        void api
          .postComment(slug, file.id, { body: "", annotation })
          .catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  const updateSelection = useCallback(
    async (patch: Partial<MySelection>) => {
      // Wir merken uns den vorherigen Stand, damit wir bei Server-Fehler
      // sauber zurückrollen können. Optimistic-Update bleibt, sonst fühlt
      // sich der Like-Klick zäh an — aber bei selection_limit_reached
      // setzen wir den UI-State zurück und zeigen einen kurzen Hinweis.
      const previous: MySelection = { ...sel };
      const next: MySelection = { ...sel, ...patch };
      onSelectionChange(file.id, next);
      try {
        await api.setSelection(slug, file.id, next);
      } catch (err) {
        // Rollback
        onSelectionChange(file.id, previous);
        if (err instanceof ApiError && err.code === "selection_limit_reached") {
          // Limit ist in meta.selectionLimit bekannt — der Server schickt's
          // im Body auch nochmal, aber wir nehmen die UI-Wahrheit.
          setLimitMessage(
            t("gallery.selectionLimitReached", {
              limit: meta.selectionLimit ?? 0,
            })
          );
        } else {
          console.error(err);
        }
      }
    },
    [sel, file.id, slug, onSelectionChange, meta.selectionLimit, t]
  );

  // Limit-Hinweis nach 3s ausblenden
  useEffect(() => {
    if (!limitMessage) return;
    const id = setTimeout(() => setLimitMessage(null), 3000);
    return () => clearTimeout(id);
  }, [limitMessage]);

  async function toggleLike() {
    await updateSelection({ liked: !sel.liked });
  }
  async function setColor(c: "red" | "yellow" | "green") {
    await updateSelection({ color: sel.color === c ? null : c });
  }

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim()) return;
    setCommentPending(true);
    try {
      const res = await api.postComment(slug, file.id, { body: newComment });
      setComments((prev) => [...(prev ?? []), res.comment]);
      setNewComment("");
    } catch (err) {
      console.error(err);
    } finally {
      setCommentPending(false);
    }
  }

  // Zwei mögliche Download-Varianten: Original (volle Auflösung) und Web
  // (2560px webp). Wenn der Studio "downloadOriginalsEnabled=false" gesetzt
  // hat, wird Original ausgegraut/weggelassen und nur Web steht zur Wahl.
  const originalDownloadUrl =
    meta.downloadEnabled && meta.downloadOriginalsEnabled
      ? api.publicDownloadUrl(slug, file.id, "original")
      : null;
  const webDownloadUrl = meta.downloadEnabled
    ? api.publicDownloadUrl(slug, file.id, "web")
    : null;

  return (
    <div className="fixed inset-0 bg-black text-white z-50 flex flex-col animate-fade-in">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-3 sm:px-5 py-2.5 border-b border-white/5 text-ui-sm">
        <button
          onClick={onClose}
          className="h-8 px-2 rounded inline-flex items-center gap-1.5 text-white/80 hover:text-white hover:bg-white/10 transition-colors duration-motion"
          aria-label={t("gallery.close")}
        >
          <span className="text-base leading-none">✕</span>
          <span className="hidden sm:inline">{t("gallery.close")}</span>
        </button>
        <div className="text-ui-xs text-white/50 font-mono">
          {index + 1} / {files.length}
        </div>
        <div className="flex items-center gap-1">
          {meta.commentsEnabled && (
            <button
              onClick={() => setShowComments((s) => !s)}
              className={`h-8 px-3 rounded text-ui-xs transition-colors duration-motion ${
                showComments
                  ? "bg-white/15 text-white"
                  : "text-white/70 hover:text-white hover:bg-white/10"
              }`}
            >
              {t("gallery.comments")}
            </button>
          )}
          {originalDownloadUrl && (
            <a
              href={originalDownloadUrl}
              className="h-8 px-3 rounded text-ui-xs inline-flex items-center text-white/70 hover:text-white hover:bg-white/10 transition-colors duration-motion"
              title={
                file.kind === "heic"
                  ? t("gallery.downloadHeicHint")
                  : t("gallery.downloadOriginalHint")
              }
            >
              ↓ {t("gallery.downloadOriginal")}
              {file.kind === "heic" && (
                <span className="ml-1.5 font-mono text-[10px] opacity-70">
                  HEIC
                </span>
              )}
            </a>
          )}
          {webDownloadUrl && (
            <a
              href={webDownloadUrl}
              className="h-8 px-3 rounded text-ui-xs inline-flex items-center text-white/70 hover:text-white hover:bg-white/10 transition-colors duration-motion"
              title={
                file.kind === "video"
                  ? t("gallery.downloadWebVideoHint")
                  : t("gallery.downloadWebHint")
              }
            >
              ↓ {t("gallery.downloadWeb")}
              {file.kind === "video" && (
                <span className="ml-1.5 font-mono text-[10px] opacity-70">
                  MP4
                </span>
              )}
            </a>
          )}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex items-center justify-center relative">
          <button
            disabled={index === 0}
            onClick={() => onNavigate(index - 1)}
            className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 disabled:opacity-20 disabled:cursor-not-allowed text-2xl text-white/90 flex items-center justify-center transition-colors duration-motion z-20 backdrop-blur-sm"
            aria-label={t("gallery.previous")}
          >
            ‹
          </button>
          <button
            disabled={index === files.length - 1}
            onClick={() => onNavigate(index + 1)}
            className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 disabled:opacity-20 disabled:cursor-not-allowed text-2xl text-white/90 flex items-center justify-center transition-colors duration-motion z-20 backdrop-blur-sm"
            aria-label={t("gallery.next")}
          >
            ›
          </button>

          {file.kind === "video" && file.hlsUrl ? (
            <VideoPlayer
              src={file.hlsUrl}
              poster={file.previewUrl ?? file.thumbUrl}
              sprite={file.sprite}
              className="max-h-full max-w-full"
            />
          ) : file.previewUrl || file.webUrl ? (
            /* Bild + Annotation-Overlay übereinander. Wir nutzen ein
               inline-block-Wrapper mit position:relative. Das `<img>`
               bestimmt die Größe des Wrappers (object-contain mit
               max-h/max-w begrenzt sie), das SVG-Overlay liegt mit
               position:absolute + inset:0 exakt drüber. inline-block
               wichtig: ein normales block-Element würde 100 % Breite
               des Parent-Flex-Containers nehmen, und das SVG würde
               über schwarzen Bereich rechts/links des Bildes liegen —
               Klicks dort würden im SVG landen statt vermisst zu
               werden. */
            <div
              className="relative inline-block max-h-[calc(100vh-160px)]"
              style={{ lineHeight: 0 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={file.webUrl ?? file.previewUrl ?? ""}
                alt={file.filename}
                className="max-h-[calc(100vh-160px)] max-w-full object-contain animate-fade-in block"
                draggable={false}
                key={file.id}
              />
              {/* Annotation-Overlay deckt das Bild exakt ab (gleiche
                  width/height über inset-0). Editor-Modus aktiv nur
                  wenn der User unten 'Markieren' gewählt hat — sonst
                  bleibt der Cursor normal und Klicks aufs Bild tun
                  nichts. */}
              {meta.commentsEnabled && (
                <AnnotationOverlay
                  existing={existingAnnotations}
                  value={myStrokes}
                  onChange={
                    interactive && bottomMode === "mark"
                      ? setMyStrokes
                      : undefined
                  }
                  author={
                    interactive && bottomMode === "mark" ? "customer" : null
                  }
                  tool={
                    interactive && bottomMode === "mark"
                      ? annotationTool
                      : null
                  }
                  color={annotationColor}
                />
              )}
            </div>
          ) : (
            <div className="opacity-50 text-ui">
              {t("gallery.previewMissing")}
            </div>
          )}

          {/* Schwebende Werkzeug-Toolbar — Position oben am unteren
              Bildrand, je nach Mode entweder Annotation-Pill oder
              Selection-Pill (Farben + Auswahl-Stern). Nur sichtbar
              wenn der Visitor Auswahl-Rechte hat. */}
          {interactive && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10">
              {bottomMode === "mark" && meta.commentsEnabled ? (
                <AnnotationToolbar
                  tool={annotationTool}
                  setTool={setAnnotationTool}
                  color={annotationColor}
                  setColor={setAnnotationColor}
                  hasMine={myStrokes.length > 0}
                  onUndo={() =>
                    setMyStrokes((arr) => arr.slice(0, -1))
                  }
                  onClear={() => setMyStrokes([])}
                />
              ) : (
                <SelectionPill
                  selColor={sel.color}
                  liked={sel.liked}
                  onSetColor={setColor}
                  onToggleLike={toggleLike}
                  t={t}
                />
              )}
            </div>
          )}

          {/* Keyboard-Hint-Overlay — verschwindet nach 5s. Sitzt
              höher weil die schwebende Werkzeug-Toolbar immer da
              ist (Selection ODER Markieren). */}
          {showHints && interactive && (
            <div
              className="absolute bottom-16 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-black/60 backdrop-blur-sm rounded-full text-ui-xs text-white/70 flex items-center gap-3 pointer-events-none animate-fade-in z-10"
              style={{ transition: "opacity 600ms ease-out" }}
            >
              <span><Kbd>←</Kbd> <Kbd>→</Kbd> {t("gallery.hintNavigate")}</span>
              <span><Kbd>Space</Kbd> ★</span>
              <span><Kbd>1</Kbd><Kbd>2</Kbd><Kbd>3</Kbd> ●</span>
              <span><Kbd>Esc</Kbd> ✕</span>
            </div>
          )}

          {/* Limit-Reached-Toast: erscheint wenn der Server einen Like
              wegen erreichtem Auswahllimit ablehnt. Sitzt höher als der
              Hint, damit beide bei Bedarf gleichzeitig lesbar bleiben. */}
          {limitMessage && (
            <div
              className="absolute bottom-16 left-1/2 -translate-x-1/2 px-4 py-2 bg-semantic-warning/95 text-surface-canvas rounded text-ui-sm font-medium pointer-events-none animate-fade-in shadow-lg"
              role="status"
            >
              {limitMessage}
            </div>
          )}
        </div>

        {/* Sidebar (Kommentare) */}
        {showComments && meta.commentsEnabled && (
          <aside className="w-80 border-l border-white/5 flex flex-col bg-black/50 backdrop-blur-sm text-white">
            <div className="px-4 py-3 border-b border-white/5 text-ui-sm font-medium text-white/90">
              {t("gallery.comments")}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {comments === null ? (
                <div className="text-ui-xs opacity-50">{t("gallery.commentsLoading")}</div>
              ) : comments.length === 0 ? (
                <div className="text-ui-xs opacity-50">{t("gallery.commentsEmpty")}</div>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="text-ui text-white">
                    <div className="text-ui-xs text-white/60 mb-0.5">
                      {c.authorLabel}
                      {c.authorIsStudio && (
                        <span className="ml-1.5 text-[10px] bg-brand-accent/30 text-brand-accent px-1.5 py-0.5 rounded-xs">
                          {t("gallery.commentStudioBadge")}
                        </span>
                      )}
                    </div>
                    <div className="whitespace-pre-wrap leading-relaxed">{c.body}</div>
                  </div>
                ))
              )}
            </div>
            <form
              onSubmit={postComment}
              className="border-t border-white/5 p-3 space-y-2"
            >
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder={t("gallery.commentPlaceholder")}
                rows={2}
                className="w-full bg-white/5 border border-white/15 rounded p-2 text-ui text-white placeholder:text-white/40 focus:outline-none focus:border-brand-accent transition-colors duration-motion"
              />
              <button
                type="submit"
                disabled={commentPending || !newComment.trim()}
                className="w-full text-ui-xs h-8 rounded bg-brand-accent text-brand-accent-contrast font-medium disabled:opacity-50 transition-opacity duration-motion"
              >
                {commentPending ? t("gallery.commentSending") : t("gallery.commentSend")}
              </button>
            </form>
          </aside>
        )}
      </div>

      {/* Bottom-Bar — Mode-Umschalter zwischen Auswahl (Farb-Tags +
          Stern) und Markieren (Annotation-Werkzeuge). Die jeweilige
          Werkzeug-Leiste erscheint dann auf dem Bild oben drauf
          (siehe SelectionPill / AnnotationToolbar weiter oben).
          Markieren-Tab nur sichtbar wenn die Galerie Kommentare/
          Annotationen erlaubt — sonst ergibt das Werkzeug keinen
          Sinn weil's nicht persistieren könnte. */}
      {interactive && (
        <div className="border-t border-white/5 px-3 py-2 flex items-center justify-center gap-2">
          <ModeTab
            active={bottomMode === "pick"}
            onClick={() => setBottomMode("pick")}
            label={t("gallery.modePick")}
            icon={<StarIcon filled={sel.liked} />}
          />
          {meta.commentsEnabled && (
            <ModeTab
              active={bottomMode === "mark"}
              onClick={() => setBottomMode("mark")}
              label={t("gallery.modeMark")}
              icon={<PencilIcon />}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Kleiner Helfer für die Color-Pills. Bewusst klein gehalten — sonst stehlen
    sie den Bildern die Aufmerksamkeit. */
function ColorPill({
  color,
  active,
  onClick,
  label,
  title,
}: {
  color: "red" | "yellow" | "green";
  active: boolean;
  onClick: () => void;
  label: string;
  title: string;
}) {
  const bg = {
    red: active ? "bg-red-500" : "bg-red-500/30 hover:bg-red-500/55",
    yellow: active ? "bg-yellow-500" : "bg-yellow-500/30 hover:bg-yellow-500/55",
    green: active ? "bg-green-500" : "bg-green-500/30 hover:bg-green-500/55",
  }[color];
  return (
    <button
      onClick={onClick}
      className={`w-9 h-9 rounded-full transition-all duration-motion ease-out ${bg} ${
        active ? "ring-2 ring-white/70" : ""
      }`}
      aria-label={label}
      title={title}
    />
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="font-mono px-1 py-0.5 mx-px text-[10px] rounded border border-white/20 bg-white/5">
      {children}
    </kbd>
  );
}

/** Schwebende Werkzeug-Pille für den Auswahl-Modus: drei Farb-Tags +
 *  Auswahl-Stern. Sitzt über dem Bild und ersetzt die alte fest-am-
 *  Boden-Bar — der Boden ist jetzt für die Mode-Tabs reserviert. */
function SelectionPill({
  selColor,
  liked,
  onSetColor,
  onToggleLike,
  t,
}: {
  selColor: string | null;
  liked: boolean;
  onSetColor: (c: "red" | "yellow" | "green") => void;
  onToggleLike: () => void;
  t: ReturnType<typeof useT>;
}) {
  return (
    <div className="inline-flex items-center gap-2 bg-black/60 backdrop-blur rounded-full px-2 py-1.5">
      <ColorPill
        color="red"
        active={selColor === "red"}
        onClick={() => onSetColor("red")}
        label={t("gallery.markRed")}
        title={t("gallery.markRedTitle")}
      />
      <ColorPill
        color="yellow"
        active={selColor === "yellow"}
        onClick={() => onSetColor("yellow")}
        label={t("gallery.markYellow")}
        title={t("gallery.markYellowTitle")}
      />
      <ColorPill
        color="green"
        active={selColor === "green"}
        onClick={() => onSetColor("green")}
        label={t("gallery.markGreen")}
        title={t("gallery.markGreenTitle")}
      />
      <span className="w-px h-6 bg-white/15 mx-1" aria-hidden />
      <button
        onClick={onToggleLike}
        className={`h-9 px-4 rounded-full border transition-all duration-motion ease-out flex items-center gap-2 ${
          liked
            ? "bg-amber-400 border-amber-300 text-neutral-950"
            : "border-white/20 text-white/80 hover:text-white hover:border-white/50"
        }`}
        aria-label={t("gallery.like")}
        title={t("gallery.likeTitle")}
      >
        <StarIcon filled={liked} />
        <span className="text-ui-xs font-medium">{t("gallery.like")}</span>
      </button>
    </div>
  );
}

/** Tab-Button für die Mode-Umschaltung am unteren Rand. Bewusst groß
 *  und mit Label+Icon — das ist die zentrale Bedien-Entscheidung des
 *  Kunden, soll nicht versteckt sein. */
function ModeTab({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-10 px-5 rounded-full inline-flex items-center gap-2 text-ui-sm font-medium transition-colors duration-motion ${
        active
          ? "bg-white text-neutral-950"
          : "text-white/70 hover:text-white hover:bg-white/10"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/** Stern-Icon — gefüllt wenn der Visitor das Bild in seine Auswahl
 *  aufgenommen hat, hohl sonst. Stern statt Herz weil "Herz" emotional
 *  ist, "Stern" eindeutiger ein Auswahl-Marker. */
function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    >
      <path d="M8 1.5l1.93 3.91 4.32.63-3.13 3.05.74 4.3L8 11.36l-3.86 2.03.74-4.3L1.75 6.04l4.32-.63L8 1.5z" />
    </svg>
  );
}

/** Stift-Icon für den Markieren-Mode-Tab. */
function PencilIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11.5 2 L14 4.5 L5 13.5 L1.5 14.5 L2.5 11 Z" />
    </svg>
  );
}
