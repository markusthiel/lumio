"use client";

/**
 * Lumio Studio — Mein Konto
 *
 * Self-Service fuer den eingeloggten User:
 *  - Name aendern
 *  - E-Mail-Adresse aendern (mit Double-Opt-In via Mail)
 *  - Passwort aendern (mit Re-Auth via aktuellem Passwort)
 *  - Pending E-Mail-Wechsel sehen + zurueckziehen
 *
 * 2FA-Setup ist eine separate Seite (settings/security oder
 * ein eigener Sub-Bereich) — hier nur Status-Anzeige.
 *
 * Bei E-Mail-Wechsel: nach erfolgreichem POST zeigen wir einen
 * Hinweis "Schau in deinen Posteingang" und der User muss den
 * Confirm-Link aus der Mail anklicken um den Wechsel abzuschliessen.
 * Bis dahin bleibt die alte Adresse aktiv.
 *
 * Bei Passwort-Wechsel: andere Sessions werden beendet, die aktuelle
 * bleibt aktiv — UX-bedingt, sonst wuerde der User direkt rausfliegen.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { PageHeader } from "@/components/studio/PageHeader";
import { Button } from "@/components/ui";
import { DangerZone } from "@/components/studio/DangerZone";

interface AccountData {
  user: {
    id: string;
    email: string;
    name: string | null;
    role: "owner" | "admin" | "member";
    status: string;
    totpEnabled: boolean;
    createdAt: string;
    lastLoginAt: string | null;
  };
  pendingEmailChange: {
    newEmail: string | undefined;
    expiresAt: string;
  } | null;
  tenant: {
    id: string;
    name: string;
    displayName: string | null;
    status: string;
    selfDeletionScheduledFor: string | null;
  } | null;
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export default function AccountPage() {
  const router = useRouter();
  const [data, setData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.getAccount();
      setData(r as AccountData);
      setError(null);
    } catch (err) {
      if (err instanceof Error && err.message.includes("401")) {
        router.replace("/login");
        return;
      }
      setError(err instanceof Error ? err.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !data) {
    return (
      <div className="px-6 py-8 text-ui-sm text-ink-tertiary">
        {error ?? "Lädt…"}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Mein Konto"
        description="Deine persönlichen Zugangsdaten und Anzeige-Einstellungen."
      />
      <div className="px-6 sm:px-8 lg:px-12 py-6 max-w-3xl space-y-6">

      {error && (
        <div className="rounded-md border border-semantic-danger/30 bg-semantic-danger/8 px-4 py-3 text-ui-sm text-semantic-danger">
          {error}
        </div>
      )}

      {/* Profil-Karte: Identitaet + Rolle (read-only). */}
      <Section title="Profil">
        <Row label="Rolle">
          <span className="text-ui text-ink-primary">
            {ROLE_LABEL[data.user.role] ?? data.user.role}
          </span>
        </Row>
        <Row label="Mitglied seit">
          <span className="text-ui text-ink-primary">
            {new Date(data.user.createdAt).toLocaleDateString("de-DE", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </span>
        </Row>
        {data.user.lastLoginAt && (
          <Row label="Zuletzt eingeloggt">
            <span className="text-ui text-ink-primary">
              {new Date(data.user.lastLoginAt).toLocaleString("de-DE")}
            </span>
          </Row>
        )}
        <Row label="2-Faktor-Authentifizierung">
          <span
            className={
              data.user.totpEnabled
                ? "text-ui text-semantic-success"
                : "text-ui text-ink-tertiary"
            }
          >
            {data.user.totpEnabled
              ? "Aktiviert"
              : "Nicht aktiviert — empfohlen für besseren Schutz"}
          </span>
        </Row>
      </Section>

      <NameSection
        currentName={data.user.name}
        onSaved={(newName) =>
          setData((d) => (d ? { ...d, user: { ...d.user, name: newName } } : d))
        }
      />

      <EmailSection
        currentEmail={data.user.email}
        pendingChange={data.pendingEmailChange}
        onChanged={load}
      />

      <PasswordSection />

      {/* Tenant-Loeschung (Self-Service, DSGVO Art. 17). Nur fuer Owner
          sichtbar — die Komponente prueft die Rolle selbst. */}
      {data.tenant && (
        <DangerZone
          studioName={data.tenant.name}
          userRole={data.user.role}
        />
      )}
      </div>
    </>
  );
}

// -- Profil-Sektionen -----------------------------------------------------

function NameSection({
  currentName,
  onSaved,
}: {
  currentName: string | null;
  onSaved: (newName: string) => void;
}) {
  const [name, setName] = useState(currentName ?? "");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = name.trim() !== (currentName ?? "");

  async function save() {
    if (!name.trim()) return;
    setPending(true);
    setError(null);
    try {
      const r = await api.updateAccountName(name.trim());
      onSaved(r.user.name ?? "");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setPending(false);
    }
  }

  return (
    <Section title="Anzeigename">
      <Row label="Name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className={inputCls}
        />
      </Row>
      {error && (
        <div className="text-ui-sm text-semantic-danger">{error}</div>
      )}
      <div className="flex justify-end gap-2 pt-1">
        {saved && (
          <span className="text-ui-sm text-semantic-success self-center">
            ✓ Gespeichert
          </span>
        )}
        <Button
          variant="primary"
          size="sm"
          onClick={save}
          disabled={pending || !changed || !name.trim()}
        >
          {pending ? "Speichert…" : "Speichern"}
        </Button>
      </div>
    </Section>
  );
}

function EmailSection({
  currentEmail,
  pendingChange,
  onChanged,
}: {
  currentEmail: string;
  pendingChange: AccountData["pendingEmailChange"];
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const r = await api.requestAccountEmailChange({
        currentPassword: password,
        newEmail: newEmail.trim().toLowerCase(),
      });
      setSubmitted(r.newEmail);
      setNewEmail("");
      setPassword("");
      setOpen(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setPending(false);
    }
  }

  async function cancel() {
    if (!confirm("Ausstehenden E-Mail-Wechsel zurückziehen?")) return;
    try {
      await api.cancelAccountEmailChange();
      setSubmitted(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    }
  }

  return (
    <Section title="E-Mail-Adresse">
      <Row label="Aktuell">
        <span className="text-ui text-ink-primary font-mono">
          {currentEmail}
        </span>
      </Row>

      {pendingChange && pendingChange.newEmail && (
        <div className="rounded-md border border-semantic-warning/30 bg-semantic-warning/8 px-4 py-3 text-ui-sm space-y-2">
          <div>
            <span className="text-ink-primary font-medium">
              Wechsel ausstehend:
            </span>{" "}
            <span className="font-mono text-ink-primary">
              {pendingChange.newEmail}
            </span>
          </div>
          <div className="text-ui-xs text-ink-tertiary">
            Eine Bestätigungsmail wurde an die neue Adresse geschickt. Klick
            den Link in der Mail, um den Wechsel abzuschließen. Gültig bis{" "}
            {new Date(pendingChange.expiresAt).toLocaleString("de-DE")}.
          </div>
          <div>
            <button
              type="button"
              onClick={cancel}
              className="text-ui-xs text-semantic-danger hover:underline"
            >
              Wechsel zurückziehen
            </button>
          </div>
        </div>
      )}

      {submitted && !pendingChange && (
        <div className="rounded-md border border-semantic-success/30 bg-semantic-success/8 px-4 py-3 text-ui-sm text-ink-primary">
          Eine Bestätigungsmail wurde an{" "}
          <span className="font-mono">{submitted}</span> geschickt. Klick den
          Link in der Mail, um den Wechsel abzuschließen.
        </div>
      )}

      {!open && !pendingChange && (
        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            E-Mail-Adresse ändern
          </Button>
        </div>
      )}

      {open && (
        <div className="space-y-3 pt-2">
          <Row label="Neue E-Mail-Adresse">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className={inputCls}
              autoComplete="off"
            />
          </Row>
          <Row label="Aktuelles Passwort">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
              autoComplete="current-password"
            />
          </Row>
          <p className="text-ui-xs text-ink-tertiary leading-relaxed">
            Aus Sicherheitsgründen brauchen wir dein aktuelles Passwort. Wir
            schicken einen Bestätigungslink an die neue Adresse — erst danach
            ist der Wechsel aktiv.
          </p>
          {error && (
            <div className="text-ui-sm text-semantic-danger">{error}</div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setError(null);
                setNewEmail("");
                setPassword("");
              }}
              disabled={pending}
            >
              Abbrechen
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={submit}
              disabled={pending || !newEmail.trim() || !password}
            >
              {pending ? "Wird angefordert…" : "Wechsel anfordern"}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

function PasswordSection() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setError(null);
    if (next.length < 12) {
      setError("Neues Passwort muss mindestens 12 Zeichen lang sein.");
      return;
    }
    if (next !== confirm) {
      setError("Die beiden Passwörter stimmen nicht überein.");
      return;
    }
    setPending(true);
    try {
      await api.changeAccountPassword({
        currentPassword: current,
        newPassword: next,
      });
      setDone(true);
      setOpen(false);
      setCurrent("");
      setNext("");
      setConfirm("");
      setTimeout(() => setDone(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler");
    } finally {
      setPending(false);
    }
  }

  return (
    <Section title="Passwort">
      {!open && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-ui-sm text-ink-tertiary">
            {done
              ? "Passwort geändert. Andere aktive Sitzungen wurden beendet."
              : "Empfehlung: mindestens 12 Zeichen, kein Wiedergebrauch von anderen Accounts."}
          </p>
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            Passwort ändern
          </Button>
        </div>
      )}

      {open && (
        <div className="space-y-3">
          <Row label="Aktuelles Passwort">
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={inputCls}
              autoComplete="current-password"
            />
          </Row>
          <Row label="Neues Passwort">
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={inputCls}
              autoComplete="new-password"
              minLength={12}
            />
          </Row>
          <Row label="Neues Passwort bestätigen">
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputCls}
              autoComplete="new-password"
            />
          </Row>
          <p className="text-ui-xs text-ink-tertiary leading-relaxed">
            Andere aktive Sitzungen werden beim Wechsel beendet. Diese hier
            bleibt aktiv.
          </p>
          {error && (
            <div className="text-ui-sm text-semantic-danger">{error}</div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setError(null);
                setCurrent("");
                setNext("");
                setConfirm("");
              }}
              disabled={pending}
            >
              Abbrechen
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={submit}
              disabled={pending || !current || !next || !confirm}
            >
              {pending ? "Wird gesetzt…" : "Passwort ändern"}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

// -- Layout-Helpers ------------------------------------------------------

const inputCls =
  "w-full h-9 px-2.5 rounded bg-surface-sunken border border-line-subtle hover:border-line-strong focus:border-accent text-ui text-ink-primary focus:outline-none transition-colors duration-motion disabled:opacity-50";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-line-subtle bg-surface-raised p-5 space-y-3">
      <h2 className="text-ui font-medium text-ink-primary">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-1 sm:gap-3 items-start sm:items-center">
      <label className="text-ui-sm text-ink-secondary">{label}</label>
      <div>{children}</div>
    </div>
  );
}
