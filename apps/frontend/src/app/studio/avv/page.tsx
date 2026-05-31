"use client";

import { useEffect, useState } from "react";
import { api, type DpaStatus, type DpaCompany } from "@/lib/api";
import { PageHeader } from "@/components/studio/PageHeader";
import { useT } from "@/lib/i18n";

type FormState = {
  legalName: string;
  legalStreet: string;
  legalPostalCode: string;
  legalCity: string;
  legalCountry: string;
  vatId: string;
};

const EMPTY: FormState = {
  legalName: "",
  legalStreet: "",
  legalPostalCode: "",
  legalCity: "",
  legalCountry: "",
  vatId: "",
};

function toForm(c: DpaCompany): FormState {
  return {
    legalName: c.legalName ?? "",
    legalStreet: c.legalStreet ?? "",
    legalPostalCode: c.legalPostalCode ?? "",
    legalCity: c.legalCity ?? "",
    legalCountry: c.legalCountry ?? "",
    vatId: c.vatId ?? "",
  };
}

const inputCls =
  "w-full h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle hover:border-line-strong focus:border-accent text-ui text-ink-primary focus:outline-none transition-colors duration-motion disabled:opacity-50";
const labelCls = "block text-ui-sm text-ink-secondary mb-1";

export default function StudioAvvPage() {
  const t = useT();
  const [status, setStatus] = useState<DpaStatus | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const s = await api.getDpaStatus();
      setStatus(s);
      setForm(toForm(s.company));
    } catch {
      setError(t("avv.loadError"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveCompany() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await api.updateDpaCompany({
        legalName: form.legalName.trim() || null,
        legalStreet: form.legalStreet.trim() || null,
        legalPostalCode: form.legalPostalCode.trim() || null,
        legalCity: form.legalCity.trim() || null,
        legalCountry: form.legalCountry.trim() || null,
        vatId: form.vatId.trim() || null,
      });
      setStatus((prev) =>
        prev ? { ...prev, company: res.company, companyComplete: res.companyComplete } : prev
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError(t("avv.saveError"));
    } finally {
      setSaving(false);
    }
  }

  async function accept() {
    setAccepting(true);
    setError(null);
    try {
      const res = await api.acceptDpa();
      setStatus((prev) => (prev ? { ...prev, acceptance: res.acceptance, upToDate: true } : prev));
    } catch (e) {
      const code = (e as { code?: string })?.code;
      setError(
        code === "company_incomplete"
          ? t("avv.companyIncomplete")
          : t("avv.acceptError")
      );
    } finally {
      setAccepting(false);
    }
  }

  function openDocument() {
    window.open(api.dpaDocumentUrl(), "_blank", "noopener");
  }

  const complete = status?.companyComplete ?? false;
  const acceptance = status?.acceptance ?? null;
  const upToDate = status?.upToDate ?? false;

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: t("avv.breadcrumbStudio"), href: "/studio" }, { label: t("avv.breadcrumb") }]}
        title={t("avv.title")}
        description={t("avv.description")}
      />
      <div className="px-6 sm:px-8 lg:px-12 py-6 max-w-5xl space-y-5">

      <p className="text-ui-sm text-ink-secondary leading-relaxed">
        {t("avv.intro")}
      </p>

      {error && (
        <div className="text-ui-sm text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded-sm px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-ui-sm text-ink-secondary">{t("common.loading")}</div>
      ) : (
        <>
          {/* Status */}
          <section className="rounded-lg border border-line-subtle bg-surface-raised p-5">
            {acceptance && upToDate ? (
              <div className="flex items-start gap-2.5">
                <span className="shrink-0 w-2 h-2 rounded-full mt-1.5 bg-emerald-500" aria-hidden />
                <div className="text-ui-sm">
                  <div className="font-medium text-emerald-700">{t("avv.statusDoneTitle")}</div>
                  <div className="text-ink-secondary mt-0.5">
                    {t("avv.doneDetail", { date: new Date(acceptance.acceptedAt).toLocaleDateString("de-DE"), byName: acceptance.acceptedByName ? t("avv.byName", { name: acceptance.acceptedByName }) : "", version: acceptance.version })}
                  </div>
                </div>
              </div>
            ) : acceptance && !upToDate ? (
              <div className="flex items-start gap-2.5">
                <span className="shrink-0 w-2 h-2 rounded-full mt-1.5 bg-amber-500 animate-pulse" aria-hidden />
                <div className="text-ui-sm">
                  <div className="font-medium text-amber-700">{t("avv.statusNewVersionTitle")}</div>
                  <div className="text-ink-secondary mt-0.5">
                    {t("avv.newVersionDetail", { yourVersion: acceptance.version, currentVersion: status?.currentVersion ?? "" })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2.5">
                <span className="shrink-0 w-2 h-2 rounded-full mt-1.5 bg-amber-500" aria-hidden />
                <div className="text-ui-sm">
                  <div className="font-medium text-amber-700">{t("avv.statusNotDoneTitle")}</div>
                  <div className="text-ink-secondary mt-0.5">
                    {t("avv.statusNotDoneDetail")}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Stammdaten */}
          <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 space-y-3">
            <div>
              <h2 className="text-ui font-medium text-ink-primary">{t("avv.companyTitle")}</h2>
              <p className="text-ui-sm text-ink-secondary mt-0.5">
                {t("avv.companyDesc")}
              </p>
            </div>

            <div>
              <label className={labelCls}>{t("avv.labelName")}</label>
              <input
                className={inputCls}
                value={form.legalName}
                onChange={(e) => setForm({ ...form, legalName: e.target.value })}
                placeholder={t("avv.placeholderName")}
                disabled={saving}
              />
            </div>
            <div>
              <label className={labelCls}>{t("avv.labelStreet")}</label>
              <input
                className={inputCls}
                value={form.legalStreet}
                onChange={(e) => setForm({ ...form, legalStreet: e.target.value })}
                placeholder={t("avv.placeholderStreet")}
                disabled={saving}
              />
            </div>
            <div className="flex gap-3">
              <div className="w-32">
                <label className={labelCls}>{t("avv.labelPostal")}</label>
                <input
                  className={inputCls}
                  value={form.legalPostalCode}
                  onChange={(e) => setForm({ ...form, legalPostalCode: e.target.value })}
                  placeholder="12345"
                  disabled={saving}
                />
              </div>
              <div className="flex-1">
                <label className={labelCls}>{t("avv.labelCity")}</label>
                <input
                  className={inputCls}
                  value={form.legalCity}
                  onChange={(e) => setForm({ ...form, legalCity: e.target.value })}
                  placeholder={t("avv.placeholderCity")}
                  disabled={saving}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className={labelCls}>{t("avv.labelCountry")}</label>
                <input
                  className={inputCls}
                  value={form.legalCountry}
                  onChange={(e) => setForm({ ...form, legalCountry: e.target.value })}
                  placeholder={t("avv.placeholderCountry")}
                  disabled={saving}
                />
              </div>
              <div className="flex-1">
                <label className={labelCls}>{t("avv.labelVat")}</label>
                <input
                  className={inputCls}
                  value={form.vatId}
                  onChange={(e) => setForm({ ...form, vatId: e.target.value })}
                  placeholder="DE123456789"
                  disabled={saving}
                />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={saveCompany}
                disabled={saving}
                className="text-sm px-3 py-2 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? t("avv.saving") : t("avv.saveCompany")}
              </button>
              {saved && <span className="text-ui-sm text-emerald-600">{t("avv.savedMsg")}</span>}
            </div>
          </section>

          {/* Abschluss + Dokument */}
          <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 space-y-3">
            <h2 className="text-ui font-medium text-ink-primary">{t("avv.acceptTitle")}</h2>
            {!complete && (
              <p className="text-ui-sm text-amber-700">
                {t("avv.incompleteHint")}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={accept}
                disabled={!complete || accepting || (!!acceptance && upToDate)}
                className="text-sm px-3 py-2 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {accepting
                  ? t("avv.accepting")
                  : acceptance && upToDate
                    ? t("avv.alreadyDone")
                    : acceptance && !upToDate
                      ? t("avv.confirmNewVersion")
                      : t("avv.acceptNow")}
              </button>
              <button
                onClick={openDocument}
                className="text-sm px-3 py-2 rounded-md border border-line-subtle hover:bg-surface-sunken"
              >{t("avv.viewDocument")}</button>
            </div>
            <p className="text-ui-xs text-ink-secondary leading-relaxed">
              {t("avv.docNote")}
            </p>
          </section>
        </>
      )}
      </div>
    </>
  );
}
