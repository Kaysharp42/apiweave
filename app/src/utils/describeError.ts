/**
 * The message to show a user for a rejected promise.
 *
 * IPC rejections arrive as `Error` with main's message already written for a
 * reader ("stop the session before removing it"), so the message is the whole
 * answer and wrapping it in a house string would bury it. Anything that is not
 * an `Error` is stringified rather than replaced with a generic apology: an
 * unexpected shape is a bug, and hiding it makes the bug report useless.
 */
export function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
