"use client";

import { useEffect, useRef, useState } from "react";
import { api, type ApiUser } from "@/lib/api";
import { useT } from "@/lib/i18n";

type State =
  | { kind: "loading" }
  | { kind: "off" }
  | { kind: "on"; remaining: number }
  | { kind: "setup"; qrDataUrl: string; otpauthUri: string }
  | { kind: "backupCodes"; codes: string[] }
  | { kind: "disable" };

export function TwoFactorSection() {
  const t = useT();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshFromMe() {
    try {
      const me = await api.me();
      applyMe(me.user);
    } catch {
      setState({ kind: "off" });
    }
  }

  function applyMe(user: ApiUser) {
    if (user.totpEnabled) {
      setState({
        kind: "on",
        remaining: user.backupCodesRemaining ?? 0,
      });
    } else {
      setState({ kind: "off" });
    }
  }

  useEffect(() => {
    void refreshFromMe();
  }, []);

  async function beginSetup() {
    setError(null);
    setPending(true);
    try {
      const res = await api.setupTotp();
      setState({
        kind: "setup",
        qrDataUrl: res.qrDataUrl,
        otpauthUri: res.otpauthUri,
      });
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "error");
    } finally {
      setPending(false);
    }
  }

  async function confirmSetup() {
    setError(null);
    setPending(true);
    try {
      const res = await api.activateTotp(code.trim());
      setState({ kind: "backupCodes", codes: res.backupCodes });
      setCode("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      setError(
        msg.includes("invalid_token")
          ? t("login.error.invalidTotp")
          : msg
      );
    } finally {
      setPending(false);
    }
  }

  async function disable() {
    setError(null);
    setPending(true);
    try {
      await api.disableTotp(code.trim());
      setCode("");
      await refreshFromMe();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      setError(
        msg.includes("invalid_token")
          ? t("login.error.invalidTotp")
          : msg
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-lg border border-line-subtle bg-surface-raised p-5 space-y-3">
      <h2 className="text-sm font-medium">{t("settings.twoFactor")}</h2>

      {error && (
        <div className="text-sm text-semantic-danger bg-semantic-danger/10 border border-semantic-danger/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {state.kind === "loading" && (
        <div className="text-xs text-ink-tertiary">{t("common.loading")}</div>
      )}

      {state.kind === "off" && (
        <>
          <p className="text-xs text-ink-tertiary">
            {t("settings.twoFactorOff")}
          </p>
          <button
            onClick={beginSetup}
            disabled={pending}
            className="text-sm px-3 py-1.5 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
          >
            {t("settings.twoFactorEnable")}
          </button>
        </>
      )}

      {state.kind === "on" && (
        <>
          <p className="text-xs text-ink-tertiary">
            {t("settings.twoFactorOn", { count: state.remaining })}
          </p>
          <button
            onClick={() => {
              setState({ kind: "disable" });
              setCode("");
              setError(null);
            }}
            className="text-sm px-3 py-1.5 rounded-md border border-red-300 text-semantic-danger hover:bg-semantic-danger/10"
          >
            {t("settings.twoFactorDisable")}
          </button>
        </>
      )}

      {state.kind === "setup" && (
        <>
          <p className="text-xs text-ink-tertiary">{t("settings.twoFactorScan")}</p>
          <div className="flex justify-center py-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={state.qrDataUrl}
              alt="QR code"
              className="rounded border border-line-subtle"
              width={280}
              height={280}
            />
          </div>
          <details className="text-xs text-ink-tertiary">
            <summary className="cursor-pointer">
              Manuelle Einrichtung
            </summary>
            <code className="block mt-1 bg-surface-sunken p-2 rounded break-all">
              {state.otpauthUri}
            </code>
          </details>
          <CodeInput value={code} onChange={setCode} />
          <div className="flex gap-2">
            <button
              onClick={() => setState({ kind: "off" })}
              className="text-sm px-3 py-1.5 rounded-md border border-line-subtle hover:bg-surface-sunken"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={confirmSetup}
              disabled={pending || code.length < 6}
              className="text-sm px-3 py-1.5 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
            >
              {pending ? t("common.verifying") : t("common.verify")}
            </button>
          </div>
        </>
      )}

      {state.kind === "backupCodes" && (
        <BackupCodesPanel
          codes={state.codes}
          onDone={() => void refreshFromMe()}
        />
      )}

      {state.kind === "disable" && (
        <>
          <p className="text-xs text-ink-tertiary">
            {t("settings.twoFactorConfirmDisable")}
          </p>
          <CodeInput value={code} onChange={setCode} />
          <div className="flex gap-2">
            <button
              onClick={() => void refreshFromMe()}
              className="text-sm px-3 py-1.5 rounded-md border border-line-subtle hover:bg-surface-sunken"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={disable}
              disabled={pending || code.length < 6}
              className="text-sm px-3 py-1.5 rounded-md bg-semantic-danger text-accent-contrast hover:bg-semantic-danger/90 disabled:opacity-50"
            >
              {t("settings.twoFactorDisable")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function CodeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      autoFocus
      autoComplete="one-time-code"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="123456"
      className="w-full rounded-md border border-line-subtle px-3 py-2 text-sm font-mono tracking-widest text-center"
    />
  );
}

function BackupCodesPanel({
  codes,
  onDone,
}: {
  codes: string[];
  onDone: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback: select text
      if (wrap.current) {
        const range = document.createRange();
        range.selectNodeContents(wrap.current);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }

  return (
    <>
      <p className="text-xs text-ink-secondary bg-semantic-warning/10 border border-semantic-warning/30 rounded-md p-2">
        {t("settings.twoFactorBackup")}
      </p>
      <div
        ref={wrap}
        className="grid grid-cols-2 gap-2 text-sm font-mono bg-surface-sunken border border-line-subtle rounded p-3"
      >
        {codes.map((c) => (
          <div key={c} className="select-all">
            {c}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          onClick={copyAll}
          className="text-xs px-2 py-1 rounded border border-line-subtle hover:bg-surface-sunken"
        >
          {copied ? "✓ kopiert" : "Kopieren"}
        </button>
        <button
          onClick={onDone}
          className="ml-auto text-sm px-3 py-1.5 rounded-md bg-accent text-accent-contrast hover:bg-accent-hover"
        >
          {t("settings.twoFactorBackupSaved")}
        </button>
      </div>
    </>
  );
}
