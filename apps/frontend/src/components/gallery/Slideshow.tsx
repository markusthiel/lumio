"use client";

/**
 * Slideshow — Vollbild-Auto-Play für eine Galerie.
 *
 * Wird aus der GalleryView gestartet (Toolbar-Button). Beim Mount geht
 * das Element via Fullscreen-API auf Vollbild, beim Unmount oder Esc
 * verlässt es Fullscreen wieder. Während des Slideshows:
 *
 *   - Cross-Fade ~600ms zwischen Bildern via doppelter <img>-Layer
 *   - Konfigurierbares Intervall (3/5/8/12 Sekunden)
 *   - Play/Pause-Toggle
 *   - ←/→ manuelle Navigation, pausiert automatisch
 *   - Auto-Hide der Toolbar nach 3s Maus-Inaktivität
 *   - Keine Selection/Like/Color — bewusst ein reiner Schau-Modus
 *
 * Was wir NICHT machen: Ken-Burns. Sieht nett aus, aber implementieren
 * heißt CSS-Animationen pro Tile choreografieren, die mit motion=off
 * sauber zusammen funktionieren müssen, und produziert auf langen
 * Galerien hörbare Lüfter. Wer das will, kann später nachrüsten.
 *
 * Videos überspringen wir — Slideshow-Auto-Advance würde ein 3-min-Video
 * nach 5s wegblenden, was albern ist. Beim Trefffen auf Video-Files
 * springen wir einfach zum nächsten Bild.
 */
import { useEffect, useRef, useState } from "react";
import type { PublicFile } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface Props {
  files: PublicFile[];
  startIndex?: number;
  /** Übergangseffekt zwischen Bildern. Wenn nicht gesetzt: 'fade'. */
  transition?: "fade" | "slide" | "kenburns";
  /** Optionale Hintergrund-Musik-URL. Wenn gesetzt, wird sie beim
   *  Slideshow-Start (Auto-Play OK weil User-Geste vom Slideshow-Button)
   *  abgespielt, looped automatisch. Volume per UI-Slider justierbar. */
  audioUrl?: string | null;
  onClose: () => void;
}

const INTERVALS = [3, 5, 8, 12] as const;
type Interval = (typeof INTERVALS)[number];

const STORAGE_KEY_INTERVAL = "lumio_slideshow_interval";
const STORAGE_KEY_VOLUME = "lumio_slideshow_volume";

export function Slideshow({
  files,
  startIndex = 0,
  transition = "fade",
  audioUrl,
  onClose,
}: Props) {
  const t = useT();

  // Nur anzeigbare Files — Slideshow lässt Videos aus
  const playable = files.filter((f) => f.kind !== "video" && (f.webUrl || f.previewUrl));
  const [index, setIndex] = useState(() => {
    // Wenn das Start-File ein Video ist, mappen wir auf das nächste
    // anzeigbare File
    const startFile = files[startIndex];
    if (!startFile) return 0;
    const i = playable.findIndex((f) => f.id === startFile.id);
    return i >= 0 ? i : 0;
  });

  const [playing, setPlaying] = useState(true);
  const [interval, setInterval] = useState<Interval>(() => readStoredInterval());
  const [toolbarVisible, setToolbarVisible] = useState(true);

  // Audio-State. Volume wird in localStorage persistiert damit der
  // User nicht jedes Mal neu einstellen muss. Muted-State NICHT
  // persistiert — wer Musik will, will sie jedes Mal (auto-play in
  // der Slideshow ist legal weil der Slideshow-Start eine User-Geste
  // ist).
  const [volume, setVolume] = useState(() => readStoredVolume());
  const [muted, setMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Refs für Timer
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolbarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Fullscreen beim Mount betreten, beim Unmount verlassen.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // requestFullscreen kann gerejectet werden, wenn der Aufruf nicht
    // aus einem User-Gesture kommt. Da der Slideshow vom Button-Click
    // gestartet wird, sind wir in einem Gesture-Context, aber wir
    // catchen trotzdem.
    el.requestFullscreen?.().catch(() => {
      // Browser hat verweigert (z.B. iOS Safari) — Slideshow funktioniert
      // trotzdem, nur nicht im echten Fullscreen-Modus
    });

    // Esc verlässt Fullscreen automatisch; wir reagieren auf das Event
    // und schließen den Slideshow auch.
    function onFullscreenChange() {
      if (!document.fullscreenElement) {
        onClose();
      }
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    };
  }, [onClose]);

  // Auto-Advance
  useEffect(() => {
    if (!playing || playable.length <= 1) return;
    advanceTimer.current = setTimeout(() => {
      setIndex((i) => (i + 1) % playable.length);
    }, interval * 1000);
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, [playing, index, interval, playable.length]);

  // Vorausladen: die nächsten Bilder schon laden UND dekodieren, während
  // das aktuelle noch steht. Sonst startet der Browser den Load des neuen
  // Bildes erst im Moment des Übergangs — der Effekt fadet dann gegen ein
  // leeres Bild, das mitten im Fade aufpoppt ("Blitzen"). Mit warmem
  // Cache + Decode ist der Wechsel sofort und der Übergang sauber.
  useEffect(() => {
    if (playable.length <= 1) return;
    const AHEAD = 2;
    for (let k = 1; k <= AHEAD; k++) {
      const f = playable[(index + k) % playable.length];
      const src = f?.webUrl ?? f?.previewUrl ?? f?.thumbUrl;
      if (!src) continue;
      const img = new Image();
      img.decoding = "async";
      img.src = src;
      // decode() wärmt den Decode-Cache; Fehler (z.B. Abbruch) ignorieren.
      img.decode?.().catch(() => {});
    }
    // Bewusst kein Cleanup: laufende Loads dürfen den Cache füllen.
  }, [index, playable.length]);

  // Toolbar-Auto-Hide
  useEffect(() => {
    function showAndScheduleHide() {
      setToolbarVisible(true);
      if (toolbarTimer.current) clearTimeout(toolbarTimer.current);
      toolbarTimer.current = setTimeout(() => setToolbarVisible(false), 3000);
    }
    showAndScheduleHide();
    window.addEventListener("mousemove", showAndScheduleHide);
    window.addEventListener("touchstart", showAndScheduleHide);
    return () => {
      window.removeEventListener("mousemove", showAndScheduleHide);
      window.removeEventListener("touchstart", showAndScheduleHide);
      if (toolbarTimer.current) clearTimeout(toolbarTimer.current);
    };
  }, []);

  // Keyboard
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPlaying(false);
        setIndex((i) => (i - 1 + playable.length) % playable.length);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setPlaying(false);
        setIndex((i) => (i + 1) % playable.length);
      } else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, playable.length]);

  // Interval persistieren, damit der nächste Slideshow denselben Default hat
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY_INTERVAL, String(interval));
    } catch {
      /* private mode */
    }
  }, [interval]);

  // Volume persistieren
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY_VOLUME, String(volume));
    } catch {
      /* private mode */
    }
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume;
    }
  }, [volume, muted]);

  // Audio Play/Pause an Slideshow-Play/Pause koppeln. Wenn der User
  // die Slideshow pausiert, soll auch die Musik pausen. Beim Resume
  // wieder weiterspielen — Browser handhabt das nativ via .play().
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    if (playing) {
      // play() returnt ein Promise das rejecten kann (z.B. wenn der
      // Browser doch noch Autoplay blockiert). Wir catchen und tun
      // nichts — die Slideshow läuft trotzdem, nur eben still.
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [playing, audioUrl]);

  if (playable.length === 0) {
    return (
      <div
        ref={containerRef}
        className="fixed inset-0 z-50 bg-black flex items-center justify-center text-white/70"
      >
        <div className="text-center space-y-3">
          <p>{t("gallery.slideshowNoImages")}</p>
          <button
            onClick={onClose}
            className="text-ui-sm px-3 h-8 rounded border border-white/20 hover:bg-white/10 transition-colors duration-motion"
          >
            {t("gallery.close")}
          </button>
        </div>
      </div>
    );
  }

  const current = playable[index];
  const prev = playable[(index - 1 + playable.length) % playable.length];

  const cursor = toolbarVisible ? "cursor-default" : "cursor-none";

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 z-50 bg-black overflow-hidden ${cursor}`}
    >
      {/* Audio-Element: nur wenn audioUrl gesetzt. autoPlay startet
          beim Mount; das funktioniert weil der Slideshow-Start eine
          User-Geste war (Button-Klick). loop=true, preload=auto.
          Wir setzen den Volume per useEffect oben statt im JSX, damit
          die initialen Volume- und Mute-Werte greifen ohne dass das
          Audio-Element doppelt re-rendert. */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          autoPlay
          loop
          preload="auto"
          className="hidden"
          // playsinline für iOS Safari — sonst öffnet Audio den
          // nativen Player Vollbild
          playsInline
        />
      )}

      {/* Render-Layer pro Übergangs-Modus. Alle drei nutzen die gleiche
          prev/current-Layer-Strategie, aber die Layer-Komponente selbst
          unterscheidet sich. Wir geben den Layern explizite keys, damit
          React beim Index-Wechsel ein NEUES Element rendert (statt nur
          das src-Attribut zu ändern) — das ist für die CSS-Animation
          essentiell, weil sie sonst nicht "neu startet". */}
      <SlideImage
        key={`prev-${prev.id}`}
        file={prev}
        isCurrent={false}
        transition={transition}
      />
      <SlideImage
        key={`cur-${current.id}-${index}`}
        file={current}
        isCurrent
        transition={transition}
      />

      {/* Toolbar: top-bar, fade out nach 3s ohne Maus */}
      <div
        className={`absolute top-0 inset-x-0 z-10 transition-opacity duration-300 ${
          toolbarVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="bg-gradient-to-b from-black/70 to-transparent px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="h-9 px-3 rounded inline-flex items-center gap-1.5 text-white/80 hover:text-white hover:bg-white/10 transition-colors duration-motion"
          >
            <span className="text-base leading-none">✕</span>
            <span className="hidden sm:inline text-ui-sm">
              {t("gallery.slideshowClose")}
            </span>
          </button>
          <div className="text-ui-xs text-white/60 font-mono">
            {index + 1} / {playable.length}
          </div>
          <div className="flex items-center gap-1.5">
            {/* Interval-Picker */}
            <div className="flex items-center gap-0.5 bg-white/5 rounded p-0.5">
              {INTERVALS.map((sec) => (
                <button
                  key={sec}
                  onClick={() => setInterval(sec)}
                  className={`text-ui-xs font-mono h-7 w-9 rounded transition-colors duration-motion ${
                    interval === sec
                      ? "bg-white text-neutral-950"
                      : "text-white/70 hover:text-white hover:bg-white/10"
                  }`}
                  title={t("gallery.slideshowInterval", { sec })}
                >
                  {sec}s
                </button>
              ))}
            </div>

            {/* Volume-Control — nur wenn Audio gesetzt. Mute-Button +
                Slider. Volume bleibt zwischen Slideshows erhalten
                (localStorage), Mute nicht. */}
            {audioUrl && (
              <div className="flex items-center gap-1.5 bg-white/5 rounded px-1.5 h-9">
                <button
                  type="button"
                  onClick={() => setMuted((m) => !m)}
                  className="text-white/80 hover:text-white inline-flex items-center justify-center h-7 w-7"
                  aria-label={
                    muted ? t("gallery.slideshowUnmute") : t("gallery.slideshowMute")
                  }
                  title={
                    muted ? t("gallery.slideshowUnmute") : t("gallery.slideshowMute")
                  }
                >
                  {muted || volume === 0 ? <SpeakerMutedIcon /> : <SpeakerIcon />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setVolume(v);
                    if (v > 0) setMuted(false);
                  }}
                  className="w-20 accent-white"
                  aria-label={t("gallery.slideshowVolume")}
                />
              </div>
            )}

            <button
              onClick={() => setPlaying((p) => !p)}
              className="h-9 w-9 rounded inline-flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 transition-colors duration-motion"
              aria-label={
                playing ? t("gallery.slideshowPause") : t("gallery.slideshowPlay")
              }
              title={
                playing ? t("gallery.slideshowPause") : t("gallery.slideshowPlay")
              }
            >
              {playing ? (
                <PauseIcon />
              ) : (
                <PlayIcon />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Bottom-Hint: erscheint zusammen mit der Toolbar */}
      <div
        className={`absolute bottom-3 left-1/2 -translate-x-1/2 z-10 transition-opacity duration-300 ${
          toolbarVisible ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="px-3 py-1.5 bg-black/60 backdrop-blur-sm rounded-full text-ui-xs text-white/70 flex items-center gap-3">
          <span>
            <Kbd>Space</Kbd> {playing ? t("gallery.slideshowPause") : t("gallery.slideshowPlay")}
          </span>
          <span>
            <Kbd>←</Kbd>
            <Kbd>→</Kbd> {t("gallery.hintNavigate")}
          </span>
          <span>
            <Kbd>Esc</Kbd> {t("gallery.close")}
          </span>
        </div>
      </div>

      {/* Progress-Bar am unteren Rand — nur sichtbar wenn playing. Linearer
          Lauf von 0 → 100 % über `interval` Sekunden, dann Reset.
          Implementiert via CSS-Keyframe (in tailwind.config), neu gemountet
          per `key` damit der Reset bei jedem Slide passiert. Die transform-
          origin landet via Inline-Style, weil Keyframes selbst keine
          transform-origin setzen können. */}
      {playing && (
        <div
          key={`progress-${index}`}
          className="absolute bottom-0 left-0 h-0.5 bg-white/70 z-10"
          style={{
            animation: `lumio-slide-progress ${interval}s linear`,
            transformOrigin: "left",
            width: "100%",
          }}
        />
      )}
    </div>
  );
}

function readStoredInterval(): Interval {
  try {
    const v = Number(window.localStorage.getItem(STORAGE_KEY_INTERVAL));
    if (INTERVALS.includes(v as Interval)) return v as Interval;
  } catch {
    /* SSR oder private mode */
  }
  return 5;
}

function readStoredVolume(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_VOLUME);
    if (raw !== null) {
      const v = Number(raw);
      if (!isNaN(v) && v >= 0 && v <= 1) return v;
    }
  } catch {
    /* SSR oder private mode */
  }
  return 0.7; // Default 70 % — laut genug damit der Customer was hört,
              // nicht so laut dass es bei Kopfhörern wehtut.
}

function SlideImage({
  file,
  isCurrent,
  transition,
}: {
  file: PublicFile;
  isCurrent: boolean;
  transition: "fade" | "slide" | "kenburns";
}) {
  // Wir bevorzugen webUrl (höhere Auflösung), fallen auf previewUrl
  const src = file.webUrl ?? file.previewUrl ?? file.thumbUrl;
  if (!src) return null;

  // Mode-spezifische Klassen.
  //
  // FADE: prev-Layer liegt full-opacity drunter, current-Layer fadet
  //   von 0 → 1 in 600ms. Beim nächsten Wechsel wird das aktuelle
  //   prev und ein neues current kommt. Identisch zum Pre-Sprint.
  //
  // SLIDE: current rutscht von translateX(100%) → 0 in 350ms ease-out,
  //   prev bleibt einfach stehen (overlap durch z-Index). Wir
  //   triggern die Animation via [animation:slide-in_350ms_...] auf
  //   dem current-Layer. Wichtig: prev darf KEINE Slide-Animation
  //   haben, sonst flackert es beim Mount.
  //
  // KENBURNS: prev bleibt stehen, current fadet ein UND animiert
  //   gleichzeitig einen langsamen Zoom + leichte Pan-Bewegung. Wir
  //   wechseln pro Bild zufällig zwischen vier Pan-Richtungen, damit
  //   es nicht immer gleich aussieht.
  let className: string;
  let style: React.CSSProperties = {};

  if (transition === "slide") {
    className = `absolute inset-0 w-full h-full object-contain`;
    if (isCurrent) {
      style.animation = "lumio-slide-in 350ms cubic-bezier(0.16,1,0.3,1) both";
    }
  } else if (transition === "kenburns") {
    // Pan-Richtung wird aus file.id gehasht, damit es konsistent ist
    // (sonst würde jeder Re-Render eine neue Richtung wählen). Wir
    // mappen auf vier Keyframe-Namen lumio-kenburns-0..3.
    const dir = file.id.charCodeAt(0) % 4;
    // Object-cover statt contain — Ken-Burns sieht nur gut aus wenn
    // das Bild den Container füllt und nicht innerhalb pant.
    className = `absolute inset-0 w-full h-full object-cover transition-opacity ease-out ${
      isCurrent ? "opacity-100 duration-[600ms]" : "opacity-0 duration-0"
    }`;
    if (isCurrent) {
      // 8s langsame Zoom-Pan-Bewegung. Auch wenn das Interval kürzer
      // ist, läuft die Animation einfach nicht ganz durch — das ist
      // ok, das nächste Bild übernimmt mit eigenem Start-Zoom.
      style.animation = `lumio-kenburns-${dir} 8s ease-out both`;
    }
  } else {
    // fade (default)
    className = `absolute inset-0 w-full h-full object-contain transition-opacity ease-out ${
      isCurrent
        ? "opacity-100 duration-[600ms]"
        : "opacity-0 duration-0"
    }`;
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt={file.filename}
      draggable={false}
      className={className}
      style={style}
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

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      <path d="M3.5 2.5v9l8-4.5-8-4.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      <rect x="3" y="2.5" width="3" height="9" />
      <rect x="8" y="2.5" width="3" height="9" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      <path d="M6 2.5L3 5H1v4h2l3 2.5v-9z" />
      <path
        d="M8.5 4.5a3 3 0 010 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SpeakerMutedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      <path d="M6 2.5L3 5H1v4h2l3 2.5v-9z" />
      <path
        d="M9 5l3 3M12 5l-3 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
