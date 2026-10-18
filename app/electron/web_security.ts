import type { Session } from "electron"

/**
 * Whether `url` is the renderer's own `app://local` document. Compared by
 * protocol and host, not by `URL.origin`: Node serialises the origin of every
 * non-special scheme — `app:`, `file:`, `data:`, `javascript:` — as "null", so
 * an origin comparison says yes to all of them.
 */
export function isAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "app:" && parsed.host === "local"
  } catch {
    return false
  }
}

/**
 * The renderer document's policy, sent with index.html by the app:// handler.
 *
 * - Scripts and workers are same-origin only. Monaco is bundled and its workers
 *   are served from app://local; `blob:` workers remain for the dev bundle.
 *   'wasm-unsafe-eval' lets libsodium's wasm build instantiate without
 *   granting eval.
 * - Styles need 'unsafe-inline': Monaco, xterm and the motion library inject
 *   <style> elements at runtime. The UI fonts come from Google Fonts.
 * - Images take data:/blob: for response and upload previews and https: for
 *   account avatars.
 * - connect-src has no remote hosts: the renderer makes no network requests
 *   of its own — HTTP runs and update checks all live in main,
 *   outside this policy.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self' app:",
  "script-src 'self' app: 'wasm-unsafe-eval'",
  "worker-src 'self' app: blob:",
  "style-src 'self' app: 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' app: data: https://fonts.gstatic.com",
  "img-src 'self' app: data: blob: https:",
  "connect-src 'self' app: data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ")

/**
 * The only web permissions the app uses: copy buttons write the clipboard, and
 * Monaco's context-menu Paste reads it. Only the app's own document gets them —
 * never the sandboxed HTML-response preview or anything else that might load.
 */
const GRANTED_PERMISSIONS: ReadonlySet<string> = new Set(["clipboard-read", "clipboard-sanitized-write"])

export function isPermissionGranted(permission: string, requestingUrl: string): boolean {
  return GRANTED_PERMISSIONS.has(permission) && isAppUrl(requestingUrl)
}

/** Denies every permission request and check except {@link GRANTED_PERMISSIONS}.
 * Without handlers Electron grants most permissions to any page by default. */
export function restrictPermissions(session: Session): void {
  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(isPermissionGranted(permission, details.requestingUrl))
  })
  session.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    isPermissionGranted(permission, requestingOrigin),
  )
}
