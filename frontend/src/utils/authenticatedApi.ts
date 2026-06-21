import type { AuthenticatedRequestInit } from "../types";
/**
 * authenticatedApi — thin fetch wrapper for APIWeave auth-aware API calls.
 *
 * Responsibilities:
 * - Always sends `credentials: "include"` so the HttpOnly session cookie is
 *   forwarded on every request.
 * - Attaches a CSRF token header (`X-CSRF-Token`) on state-changing methods
 *   (POST, PUT, PATCH, DELETE).  The token is read from the `csrftoken` cookie
 *   that the backend sets on login (readable by JS — not HttpOnly).
 * - Never adds an `Authorization` header with an admin key; authentication is
 *   entirely cookie-based.
 */

/** HTTP methods that mutate server state and therefore require a CSRF token. */
const CSRF_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Read a cookie value by name from `document.cookie`.
 * Returns `null` when running in a non-browser environment or when the cookie
 * is absent.
 */
export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=")[1] ?? "") : null;
}

/**
 * Fetch wrapper that injects session credentials and CSRF headers.
 *
 * @param url     - Absolute or relative URL to fetch.
 * @param options - Standard `RequestInit` options (method, body, headers, …).
 * @returns       The raw `Response` object — callers decide how to parse it.
 */
export async function authenticatedFetch(
  url: string,
  options: AuthenticatedRequestInit = {},
): Promise<Response> {
  const method = (options.method ?? "GET").toUpperCase();

  const headers = new Headers(options.headers);

  // Attach CSRF token for state-changing requests
  if (CSRF_METHODS.has(method)) {
    const csrfToken = readCookie("csrftoken");
    if (csrfToken) {
      headers.set("X-CSRF-Token", csrfToken);
    }
  }

  // Ensure we never accidentally send an admin key
  headers.delete("Authorization");

  return fetch(url, {
    ...options,
    method,
    headers,
    credentials: "include",
  });
}

/**
 * Convenience wrapper that parses the JSON body and throws on non-2xx status.
 */
export async function authenticatedJson<T = unknown>(
  url: string,
  options: AuthenticatedRequestInit = {},
): Promise<T> {
  const response = await authenticatedFetch(url, options);
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    let message = text || response.statusText;
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed.detail === "string") {
        message = parsed.detail;
      } else if (Array.isArray(parsed.detail) && parsed.detail.length > 0) {
        const first = parsed.detail[0];
        if (first?.msg) {
          const loc = Array.isArray(first.loc) ? first.loc.join(".") : "";
          message = loc ? `${loc}: ${first.msg}` : first.msg;
        }
      } else if (typeof parsed.message === "string") {
        message = parsed.message;
      }
    } catch {}
    throw new Error(`API error ${response.status}: ${message}`);
  }
  return response.json() as Promise<T>;
}

export async function copyInviteLink(inviteUrl: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(inviteUrl);
    return true;
  } catch {
    return false;
  }
}
