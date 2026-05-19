"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.login(email, password);
      router.push("/studio");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Login failed. Please try again."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-slate-50">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-5 bg-white border border-slate-200 rounded-lg p-8 shadow-sm"
      >
        <header className="space-y-1">
          <div className="text-xs font-medium text-brand-accent uppercase tracking-wider">
            Lumio
          </div>
          <h1 className="text-2xl font-semibold">Studio Login</h1>
        </header>

        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium">
            E-Mail
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent focus:border-transparent"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">
            Passwort
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent focus:border-transparent"
          />
        </div>

        {error && (
          <div
            role="alert"
            className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full bg-slate-900 text-white text-sm font-medium rounded-md py-2.5 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {pending ? "Anmelden…" : "Anmelden"}
        </button>

        <p className="text-xs text-slate-500 text-center pt-2">
          Konto angelegt via CLI:{" "}
          <code className="bg-slate-100 px-1 py-0.5 rounded">
            npm run create-admin
          </code>
        </p>
      </form>
    </main>
  );
}
