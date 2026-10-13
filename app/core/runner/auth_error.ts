/**
 * A request's auth could not be applied (a missing secret, a bad key, a token
 * endpoint that refused). Every message starts with the scheme's name and
 * names secrets, hosts and statuses, never a value: the scheduler passes such
 * messages through to run history verbatim (see `safeErrorClass`).
 */
export class AuthError extends Error {
  public override readonly name: string = "AuthError"
}
