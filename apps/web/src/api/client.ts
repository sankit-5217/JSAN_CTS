const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:3000/api/v1";

// The app JWT lives here whichever way the user signed in: SSO
// (SsoCallbackPage, after the API's OIDC callback) or dev-login (LoginPage,
// local/dev only). Every request reads it back from this one key.
const TOKEN_STORAGE_KEY = "opsdesk_token";
// Remembers *how* the session started, so sign-out also ends the IdP
// session for SSO users instead of leaving them silently signed in there.
const AUTH_METHOD_STORAGE_KEY = "opsdesk_auth_method";

export type AuthMethod = "sso" | "dev";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function storeToken(token: string, method: AuthMethod = "dev"): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
  localStorage.setItem(AUTH_METHOD_STORAGE_KEY, method);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(AUTH_METHOD_STORAGE_KEY);
}

/** Full-page navigation target that starts the API's OIDC login redirect. */
export const SSO_LOGIN_URL = `${API_BASE_URL}/auth/oidc/login`;

/** Clears the local session; SSO sessions also go through the IdP's logout. */
export function signOut(): void {
  const wasSso = localStorage.getItem(AUTH_METHOD_STORAGE_KEY) === "sso";
  clearStoredToken();
  window.location.assign(wasSso ? `${API_BASE_URL}/auth/oidc/logout` : "/login");
}

/**
 * A non-2xx response. `message` keeps the old "<METHOD> <path> failed: <status>"
 * prefix and appends the API's own explanation when it sent one (Nest's
 * `{ message }` body), so existing error banners get more useful for free;
 * `body` carries any structured detail (e.g. a 409's `blockers`).
 */
export class ApiError extends Error {
  constructor(
    prefix: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    const detail = (body as { message?: unknown } | null)?.message;
    const text = Array.isArray(detail)
      ? detail.join("; ")
      : typeof detail === "string"
        ? detail
        : "";
    super(text ? `${prefix} — ${text}` : prefix);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  // A FormData body must NOT get an explicit Content-Type — the browser
  // sets the multipart boundary itself when it builds the request; setting
  // it manually breaks the server's multipart parser.
  const isFormData = init?.body instanceof FormData;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(`${init?.method ?? "GET"} ${path} failed: ${res.status}`, res.status, body);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined });
}

export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

/** Field name must match `FileInterceptor("file")` server-side. */
export function apiUpload<T>(path: string, file: File): Promise<T> {
  const formData = new FormData();
  formData.append("file", file);
  return request<T>(path, { method: "POST", body: formData });
}

/**
 * Fetches a file endpoint (e.g. a CSV report) with the auth header attached
 * and saves it client-side — a plain `<a href>` can't carry the Bearer
 * token, so this does the fetch itself and triggers the save via a
 * throwaway object URL.
 */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const token = getStoredToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
