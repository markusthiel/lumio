/**
 * Lumio Frontend — API Client (minimal)
 */

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type ApiUser = {
  id: string;
  email: string;
  name: string | null;
  role: "owner" | "admin" | "member";
  tenantId?: string;
  totpEnabled?: boolean;
};

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    ...init,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(
      data?.message ?? data?.error ?? `HTTP ${res.status}`
    ) as Error & { status: number; code?: string };
    err.status = res.status;
    err.code = data?.error;
    throw err;
  }
  return data as T;
}

export const api = {
  health: () => fetch(`${API_URL}/health`).then((r) => r.json()),

  login: (email: string, password: string) =>
    request<{ user: ApiUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),

  me: () => request<{ user: ApiUser }>("/auth/me"),
};

export { API_URL };
