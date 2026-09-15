"use client";

/**
 * Lumio Studio — Bulk-Import des Print-Katalogs
 *
 * Drei Schritte in einer Page (kein State-Verlust zwischen ihnen):
 *   1. upload  — Template runterladen, Provider waehlen, Datei waehlen
 *   2. preview — Dry-Run-Report ansehen (was WUERDE passieren)
 *   3. done    — Commit-Report (was IST passiert)
 *
 * Preview und Commit rufen denselben Service auf dem Server auf
 * (analyzeImport mit dryRun: true/false) — was hier als Vorschau
 * angezeigt wird, ist exakt das was beim Import geschrieben wird.
 *
 * Kaputte Zeilen (fehlende Breite/Hoehe, unbekannte Kategorie, ...)
 * stoppen den Import nicht — sie werden einzeln uebersprungen und im
 * Report aufgelistet. Kein Zeilen-Editor in v1: Datei korrigieren und
 * neu hochladen.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { PrintImportProduct, PrintImportReport, PrintImportRowStatus } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button, Select } from "@/components/ui";
import { useErrorText } from "@/lib/error-i18n";
import { useCatalogText } from "@/lib/catalog-i18n";

type ProviderMine = Awaited<ReturnType<typeof api.listTenantPrintProviders>>["providers"][number];
type Step = "upload" | "preview" | "done";

export default function PrintImportPage() {
  const errText = useErrorText();
  const t = useT();
  const ct = useCatalogText();
  const [step, setStep] = useState<Step>("upload");
  const [providers, setProviders] = useState<ProviderMine[] | null>(null);
  const [providerKey, setProviderKey] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [products, setProducts] = useState<PrintImportProduct[] | null>(null);
  const [report, setReport] = useState<PrintImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await api.listTenantPrintProviders();
        setProviders(r.providers);
        const enabled = r.providers.filter((p) => p.enabled);
        if (enabled.length > 0) setProviderKey(enabled[0].providerKey);
      } catch (err) {
        setError(errText(err, t("common.error")));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setFileName(file.name);
      let parsed: unknown;
      try {
        const text = await file.text();
        parsed = JSON.parse(text);
      } catch {
        setError(t("printImport.invalidJson"));
        return;
      }
      const productsInFile = (parsed as { products?: unknown })?.products;
      if (!Array.isArray(productsInFile)) {
        setError(t("printImport.invalidJson"));
        return;
      }
      setBusy(true);
      try {
        const { report: r } = await api.previewPrintImport({
          providerKey,
          products: productsInFile as PrintImportProduct[],
        });
        setProducts(productsInFile as PrintImportProduct[]);
        setReport(r);
        setStep("preview");
      } catch (err) {
        setError(errText(err, t("common.error")));
      } finally {
        setBusy(false);
      }
    },
    [providerKey, errText, t]
  );

  async function commit() {
    if (!products) return;
    setBusy(true);
    setError(null);
    try {
      const { report: r } = await api.commitPrintImport({ providerKey, products });
      setReport(r);
      setStep("done");
    } catch (err) {
      setError(errText(err, t("common.error")));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep("upload");
    setProducts(null);
    setReport(null);
    setFileName(null);
    setError(null);
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold">{t("printImport.title")}</h2>
        <p className="text-sm text-ink-tertiary mt-1">{t("printImport.intro")}</p>
      </div>

      {error && (
        <div className="rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-3 py-2 text-sm text-semantic-danger">
          {error}
        </div>
      )}

      {step === "upload" && (
        <div className="space-y-4 rounded-md border border-line-subtle bg-surface-raised p-4">
          <div>
            <a
              href={api.printImportTemplateUrl()}
              className="inline-flex items-center px-3 py-1.5 text-sm rounded border border-line-subtle hover:bg-surface-sunken"
            >
              {t("printImport.downloadTemplate")}
            </a>
          </div>

          {providers && providers.filter((p) => p.enabled).length === 0 ? (
            <div className="rounded-md border border-semantic-warning/30 bg-semantic-warning/8 px-3 py-2 text-sm text-semantic-warning">
              {t("printAdmin.noProvider")}{" "}
              <Link href="/studio/print-shop/providers" className="underline font-medium">
                {t("printAdmin.toProviders")}
              </Link>
            </div>
          ) : (
            <>
              <label className="block max-w-xs">
                <span className="block text-xs text-ink-tertiary mb-1">
                  {t("printImport.providerLabel")}
                </span>
                <Select value={providerKey} onChange={(e) => setProviderKey(e.target.value)}>
                  {providers
                    ?.filter((p) => p.enabled)
                    .map((p) => (
                      <option key={p.providerKey} value={p.providerKey}>
                        {ct("Provider", p.providerKey, "Label", p.providerLabel)}
                      </option>
                    ))}
                </Select>
              </label>

              <label className="block">
                <span className="block text-xs text-ink-tertiary mb-1">
                  {t("printImport.chooseFile")}
                </span>
                <input
                  type="file"
                  accept="application/json"
                  disabled={busy || !providerKey}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                  }}
                  className="block text-sm"
                />
                {fileName && (
                  <span className="block text-xs text-ink-tertiary mt-1">{fileName}</span>
                )}
              </label>

              {busy && <p className="text-sm text-ink-tertiary">{t("printImport.analyzing")}</p>}
            </>
          )}
        </div>
      )}

      {step === "preview" && report && (
        <div className="space-y-4">
          <ImportSummary report={report} />
          <ImportProductList report={report} />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={reset} disabled={busy}>
              {t("printImport.chooseAnotherFile")}
            </Button>
            <Button onClick={commit} disabled={busy}>
              {busy ? t("printImport.importing") : t("printImport.confirmImport")}
            </Button>
          </div>
        </div>
      )}

      {step === "done" && report && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold">{t("printImport.doneTitle")}</h3>
          <ImportSummary report={report} />
          <div className="flex gap-2">
            <Link
              href="/studio/print-shop/products"
              className="inline-flex items-center px-3 py-2 text-sm rounded bg-accent text-white"
            >
              {t("printImport.backToProducts")}
            </Link>
            <Button variant="secondary" onClick={reset}>
              {t("printImport.chooseAnotherFile")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ImportSummary({ report }: { report: PrintImportReport }) {
  const t = useT();
  const s = report.summary;
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
      <SummaryStat label={t("printImport.summaryProducts")} value={s.totalProducts} />
      <SummaryStat label={t("printImport.summaryVariants")} value={s.totalVariants} />
      <SummaryStat
        label={t("printImport.summaryCreatedUpdated")}
        value={`${s.productsCreated + s.variantsCreated} / ${s.productsUpdated + s.variantsUpdated}`}
      />
      <SummaryStat
        label={t("printImport.summarySkippedWarnings")}
        value={`${s.productsSkipped + s.variantsSkipped} / ${s.warnings}`}
        warn={s.productsSkipped + s.variantsSkipped > 0}
      />
    </dl>
  );
}

function SummaryStat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string | number;
  warn?: boolean;
}) {
  return (
    <div className="rounded-md border border-line-subtle bg-surface-raised px-3 py-2">
      <dt className="text-xs text-ink-tertiary">{label}</dt>
      <dd
        className={`text-lg font-semibold tabular-nums ${warn ? "text-semantic-warning" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

function ImportProductList({ report }: { report: PrintImportReport }) {
  const t = useT();
  if (report.products.length === 0) {
    return <p className="text-sm text-ink-tertiary">{t("printImport.noRows")}</p>;
  }
  return (
    <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
      {report.products.map((p) => (
        <li
          key={p.rowIndex}
          className="rounded-md border border-line-subtle bg-surface-raised p-3"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{p.name || `#${p.rowIndex + 1}`}</span>
            <RowStatusBadge status={p.status} />
          </div>
          <RowMessages errors={p.errors} warnings={p.warnings} />
          {p.variants.length > 0 && (
            <ul className="mt-2 pl-3 border-l border-line-subtle space-y-1">
              {p.variants.map((v) => (
                <li key={v.rowIndex} className="text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-ink-secondary">{v.name || `#${v.rowIndex + 1}`}</span>
                    <RowStatusBadge status={v.status} />
                  </div>
                  <RowMessages errors={v.errors} warnings={v.warnings} />
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function RowMessages({ errors, warnings }: { errors: string[]; warnings: string[] }) {
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <div className="mt-0.5 space-y-0.5">
      {errors.map((e, i) => (
        <div key={`e${i}`} className="text-xs text-semantic-danger">
          {e}
        </div>
      ))}
      {warnings.map((w, i) => (
        <div key={`w${i}`} className="text-xs text-semantic-warning">
          {w}
        </div>
      ))}
    </div>
  );
}

function RowStatusBadge({ status }: { status: PrintImportRowStatus }) {
  const t = useT();
  const map: Record<PrintImportRowStatus, { label: string; classes: string }> = {
    created: {
      label: t("printImport.rowStatusCreated"),
      classes: "bg-semantic-success/15 text-semantic-success",
    },
    updated: {
      label: t("printImport.rowStatusUpdated"),
      classes: "bg-accent/15 text-accent",
    },
    would_create: {
      label: t("printImport.rowStatusWouldCreate"),
      classes: "bg-semantic-success/15 text-semantic-success",
    },
    would_update: {
      label: t("printImport.rowStatusWouldUpdate"),
      classes: "bg-accent/15 text-accent",
    },
    skipped_error: {
      label: t("printImport.rowStatusSkippedError"),
      classes: "bg-semantic-danger/15 text-semantic-danger",
    },
  };
  const e = map[status];
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${e.classes}`}>{e.label}</span>
  );
}
