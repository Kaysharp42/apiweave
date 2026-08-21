import { describe, expect, it, vi } from "vitest"
import { holdNotificationsUntilCommit, sendOrHoldNotification } from "../transactionNotifications"

// The scope key is any object identity — the repositories pass their KVStore.
function scopeKey(): object {
  return {}
}

describe("transactionNotifications", () => {
  it("sends immediately when no transaction is open", () => {
    const store = scopeKey()
    const send = vi.fn()

    sendOrHoldNotification(store, send)

    expect(send).toHaveBeenCalledOnce()
  })

  it("holds until the outermost scope commits, not the innermost", () => {
    const store = scopeKey()
    const send = vi.fn()

    holdNotificationsUntilCommit(store, () => {
      holdNotificationsUntilCommit(store, () => {
        sendOrHoldNotification(store, send)
      })
      // The inner scope is a savepoint; only the outer commit is real.
      expect(send).not.toHaveBeenCalled()
    })

    expect(send).toHaveBeenCalledOnce()
  })

  it("discards notifications when the scope holding them rolls back", () => {
    const store = scopeKey()
    const send = vi.fn()

    expect(() =>
      holdNotificationsUntilCommit(store, () => {
        sendOrHoldNotification(store, send)
        throw new Error("rolled back")
      }),
    ).toThrow("rolled back")

    expect(send).not.toHaveBeenCalled()
  })

  it("discards a rolled-back nested scope's notifications when the outer scope commits", () => {
    const store = scopeKey()
    const fromRolledBack = vi.fn()
    const fromCommitted = vi.fn()

    holdNotificationsUntilCommit(store, () => {
      // A savepoint that rolled back: the outer caller swallows the error and
      // goes on to commit, but the writes this frame announced are gone.
      try {
        holdNotificationsUntilCommit(store, () => {
          sendOrHoldNotification(store, fromRolledBack)
          throw new Error("savepoint rolled back")
        })
      } catch {
        // Deliberately swallowed, as `ProjectExportService` does per bundle item.
      }
      sendOrHoldNotification(store, fromCommitted)
    })

    expect(fromRolledBack).not.toHaveBeenCalled()
    expect(fromCommitted).toHaveBeenCalledOnce()
  })

  it("keeps a notification queued before a nested rollback", () => {
    const store = scopeKey()
    const beforeInner = vi.fn()
    const insideInner = vi.fn()

    holdNotificationsUntilCommit(store, () => {
      sendOrHoldNotification(store, beforeInner)
      try {
        holdNotificationsUntilCommit(store, () => {
          sendOrHoldNotification(store, insideInner)
          throw new Error("savepoint rolled back")
        })
      } catch {
        // Swallowed by the outer caller.
      }
    })

    // Truncation must stop at the failing frame's entry mark: what the outer
    // frame queued first was committed and must still be delivered.
    expect(beforeInner).toHaveBeenCalledOnce()
    expect(insideInner).not.toHaveBeenCalled()
  })

  it("does not let one throwing observer starve the queue behind it", () => {
    const store = scopeKey()
    const throwing = vi.fn(() => {
      throw new Error("webContents destroyed")
    })
    const after = vi.fn()

    holdNotificationsUntilCommit(store, () => {
      sendOrHoldNotification(store, throwing)
      sendOrHoldNotification(store, after)
    })

    expect(throwing).toHaveBeenCalledOnce()
    expect(after).toHaveBeenCalledOnce()
  })

  it("does not turn a committed transaction into a failure when an observer throws", () => {
    const store = scopeKey()

    expect(() =>
      holdNotificationsUntilCommit(store, () => {
        sendOrHoldNotification(store, () => {
          throw new Error("webContents destroyed")
        })
        return "committed"
      }),
    ).not.toThrow()
  })

  it("returns the scope's value and starts each scope clean", () => {
    const store = scopeKey()
    const first = vi.fn()
    const second = vi.fn()

    expect(holdNotificationsUntilCommit(store, () => {
      sendOrHoldNotification(store, first)
      return 42
    })).toBe(42)
    expect(first).toHaveBeenCalledOnce()

    // A second, unrelated scope over the same store must not replay the first.
    holdNotificationsUntilCommit(store, () => {
      sendOrHoldNotification(store, second)
    })
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
  })
})
