/**
 * Write observers (the main→renderer `workflow-changed` broadcast) must hear
 * about a write only once it can no longer be taken back — but SQLite
 * transactions nest (`better-sqlite3` runs nested `transaction()` calls as
 * savepoints), and only the outermost commit is real. A notification sent from
 * inside a still-open transaction announces a write that a later statement can
 * still roll back: a failing bundle import would leave the renderer holding
 * snapshots for workflows that never existed.
 *
 * Nesting is tracked per store — the process is single-threaded and
 * transactions are synchronous, so scopes never overlap. Observers are held
 * until the outermost scope commits; on rollback they are discarded with it.
 *
 * Callers enqueue non-throwing closures: this module forwards them verbatim,
 * and one throwing observer must not starve the ones queued behind it.
 */
interface NotificationScope {
  depth: number
  pending: (() => void)[]
}

const scopes = new WeakMap<object, NotificationScope>()

/** Run a transaction on `store`, holding its observers' notifications until the outermost commit. */
export function holdNotificationsUntilCommit<T>(store: object, run: () => T): T {
  let scope = scopes.get(store)
  if (scope === undefined) {
    scope = { depth: 0, pending: [] }
    scopes.set(store, scope)
  }
  scope.depth += 1
  // A nested frame is a savepoint: only what IT queued rolls back with it, so
  // the discard has to be a truncation to this frame's entry mark rather than a
  // per-frame flag. Otherwise an inner frame that threw, whose error the outer
  // caller swallowed, would still flush its notifications on the outer commit.
  const mark = scope.pending.length
  try {
    return run()
  } catch (error) {
    scope.pending.length = mark
    throw error
  } finally {
    scope.depth -= 1
    if (scope.depth === 0) {
      scopes.delete(store)
      for (const send of scope.pending) {
        // The write is committed and cannot be taken back; one observer that
        // throws must not starve the queue behind it, and must not escape from
        // this `finally` and resurface as a failure of a successful commit.
        try {
          send()
        } catch {
          // Observers are documented as non-throwing. Nothing here can react.
        }
      }
    }
  }
}

/** Deliver a notification now, or — inside a transaction — after the outermost commit instead. */
export function sendOrHoldNotification(store: object, send: () => void): void {
  const scope = scopes.get(store)
  if (scope === undefined || scope.depth === 0) {
    send()
    return
  }
  scope.pending.push(send)
}
