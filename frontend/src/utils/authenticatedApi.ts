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

export interface AuthenticatedRequestInit extends RequestInit {
  /** Override the method explicitly (defaults to "GET"). */
  method?: string;
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
    throw new Error(`API error ${response.status}: ${text}`);
  }
  return response.json() as Promise<T>;
}
