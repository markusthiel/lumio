#!/usr/bin/env node
/**
 * frontend-perf.mjs — reproduzierbarer Frontend-Performance-Messlauf für
 * Galerie-URLs (oder beliebige Seiten). Misst FCP, LCP, CLS, TBT, die Zahl
 * der Netzwerk-Requests und der geladenen Bilder — unter einem mobilen
 * Profil mit 4G-Drosselung, damit die Zahlen einem realistischen Endgerät
 * nahekommen statt einer ungedrosselten Rechenzentrums-Leitung.
 *
 * Drosselung = Lighthouse-"Slow 4G"-Profil:
 *   - 1,6 Mbit/s Download, 0,675 Mbit/s Upload, 150 ms RTT
 *   - CPU 4x verlangsamt (emuliert ein Mittelklasse-Smartphone)
 *
 * Wichtige Hinweise zur Interpretation:
 *   - Gemessen wird vom Standort des ausführenden Rechners. Die Basis-Latenz
 *     zu den jeweiligen Servern/CDNs unterscheidet sich — absolute Zahlen
 *     sind standortabhängig, der *relative* Vergleich zweier Seiten unter
 *     identischen Bedingungen ist die belastbare Aussage.
 *   - Bild-Bytes via Resource-Timing sind bei cross-origin (S3/CDN ohne
 *     Timing-Allow-Origin) nicht erfasst (transferSize = 0). Deshalb keine
 *     "MB total"-Vergleiche, sondern LCP/FCP/CLS/TBT/Request-Anzahl.
 *
 * Setup:
 *   npm i playwright && npx playwright install chromium
 * Nutzung:
 *   node frontend-perf.mjs <url> [<url2> ...] [--runs 5] [--settle 14000]
 */
import { chromium, devices } from "playwright";

const args = process.argv.slice(2);
const urls = args.filter((a) => !a.startsWith("--"));
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
};
const RUNS = opt("runs", 5);
const SETTLE_MS = opt("settle", 14000);

if (urls.length === 0) {
  console.error("Usage: node frontend-perf.mjs <url> [url2 ...] [--runs N] [--settle ms]");
  process.exit(1);
}

const device = devices["Pixel 5"];
// Lighthouse mobile "Slow 4G"
const NET = {
  offline: false,
  latency: 150,
  downloadThroughput: Math.round((1638.4 * 1024) / 8),
  uploadThroughput: Math.round((675 * 1024) / 8),
};
const CPU_RATE = 4;

async function measure(browser, url) {
  const ctx = await browser.newContext({ ...device });
  const page = await ctx.newPage();
  const client = await ctx.newCDPSession(page);
  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", NET);
  await client.send("Emulation.setCPUThrottlingRate", { rate: CPU_RATE });
  await page.addInitScript(() => {
    window.__cls = 0;
    window.__lcp = 0;
    window.__tbt = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((l) => {
      const es = l.getEntries();
      window.__lcp = es[es.length - 1].renderTime || es[es.length - 1].loadTime || window.__lcp;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.duration > 50) window.__tbt += e.duration - 50;
    }).observe({ type: "longtask", buffered: true });
  });
  await page.goto(url, { waitUntil: "load", timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
  const m = await page.evaluate(() => {
    const fcp = (performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint") || {}).startTime || 0;
    const imgs = [...document.querySelectorAll("img")];
    return {
      fcp: Math.round(fcp),
      lcp: Math.round(window.__lcp),
      cls: +window.__cls.toFixed(3),
      tbt: Math.round(window.__tbt),
      reqs: performance.getEntriesByType("resource").length,
      loadedImgs: imgs.filter((i) => i.naturalWidth > 0).length,
    };
  }).catch((e) => ({ error: String(e) }));
  await ctx.close();
  return m;
}

const median = (arr, k) => {
  const v = arr.map((r) => r[k]).filter((x) => typeof x === "number").sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
console.log(`Profil: Pixel 5, Slow-4G (1.6 Mbit/s, 150ms RTT), CPU ${CPU_RATE}x — ${RUNS} Läufe je URL\n`);
for (const url of urls) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await measure(browser, url));
  console.log("URL:", url);
  for (const r of runs) console.log("  ", JSON.stringify(r));
  console.log(
    "  MEDIAN",
    JSON.stringify({
      fcp: median(runs, "fcp"),
      lcp: median(runs, "lcp"),
      cls: median(runs, "cls"),
      tbt: median(runs, "tbt"),
      reqs: median(runs, "reqs"),
      loadedImgs: median(runs, "loadedImgs"),
    }),
    "\n"
  );
}
await browser.close();
