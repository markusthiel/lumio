# Frontend-Performance-Benchmark

Reproduzierbarer Messlauf für die Ladeperformance einer Galerie-Seite.
Damit lassen sich die in Blog/Marketing genannten Zahlen nachvollziehen.

## Setup

```bash
npm i playwright
npx playwright install chromium
```

## Ausführen

```bash
node frontend-perf.mjs "https://deine-galerie.example/g/..." --runs 5
```

Mehrere URLs hintereinander vergleichen:

```bash
node frontend-perf.mjs "<url-a>" "<url-b>" --runs 5
```

## Profil

Gemessen unter einem mobilen Profil, damit die Zahlen einem realistischen
Endgerät nahekommen (nicht einer ungedrosselten Rechenzentrums-Leitung):

- Gerät: Pixel 5 (Playwright-Device-Profil)
- Netzwerk: Lighthouse-„Slow 4G" — 1,6 Mbit/s Download, 0,675 Mbit/s Upload, 150 ms RTT
- CPU: 4× verlangsamt (emuliert ein Mittelklasse-Smartphone)
- Jeweils mehrere kalte Läufe, ausgewertet wird der Median

## Erfasste Metriken

- **FCP** — First Contentful Paint
- **LCP** — Largest Contentful Paint (Web Vital, gut ≤ 2,5 s)
- **CLS** — Cumulative Layout Shift (Web Vital, gut ≤ 0,1)
- **TBT** — Total Blocking Time (Labor-Proxy für Interaktivität)
- **reqs** — Zahl der Netzwerk-Requests in der Erstansicht
- **loadedImgs** — tatsächlich geladene Bilder in der Erstansicht

## Wichtige Hinweise zur Interpretation

- Absolute Zahlen sind **standortabhängig**: Die Basis-Latenz zum jeweiligen
  Server/CDN unterscheidet sich je nach Messort. Belastbar ist der
  **relative** Vergleich zweier Seiten unter identischen Bedingungen.
- **Bild-Bytes** werden bewusst nicht verglichen: Bei cross-origin
  ausgelieferten Bildern (S3/CDN ohne `Timing-Allow-Origin`) meldet die
  Resource-Timing-API `transferSize = 0`. Deshalb Fokus auf
  LCP/FCP/CLS/TBT und Request-Anzahl.
- Eine einzelne Galerie ist ein Stichprobenpunkt, kein vollständiges
  Benchmark. CDN-Cache-Zustände und Galerie-Größe beeinflussen das Ergebnis.
