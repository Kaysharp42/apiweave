import { describe, expect, it, vi } from "vitest"
import type { GitSyncGit } from "../git_sync_service"
import { GitStatusFactsCache, watchingWrites, type GitStatusFacts, type GitStatusFactsRead } from "../git_status_facts"

function facts(ahead: number): GitStatusFacts {
  return { divergence: { ahead, behind: 0 }, lastCommit: null }
}

/** A read that answers `ahead` when it is let go, and says how often it ran. */
function heldRead(ahead: number, cacheable = true) {
  let release: () => void = () => undefined
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const compute = vi.fn(async (): Promise<GitStatusFactsRead> => {
    await released
    return { facts: facts(ahead), cacheable }
  })
  return { compute, release }
}

const read = (ahead: number, cacheable = true) => vi.fn(async (): Promise<GitStatusFactsRead> => ({ facts: facts(ahead), cacheable }))

describe("GitStatusFactsCache", () => {
  it("answers a key from its last read until something writes", async () => {
    const cache = new GitStatusFactsCache()
    const first = read(1)
    await cache.read("a", first)
    const second = read(2)

    expect(await cache.read("a", second)).toEqual(facts(1))
    expect(second).not.toHaveBeenCalled()

    await cache.write(async () => undefined)
    expect(await cache.read("a", second)).toEqual(facts(2))
  })

  it("keeps each key apart, and a write anywhere makes every key stale", async () => {
    const cache = new GitStatusFactsCache()
    await cache.read("a", read(1))
    await cache.read("b", read(2))
    expect(await cache.read("b", read(9))).toEqual(facts(2))

    await cache.write(async () => undefined)

    expect(await cache.read("a", read(3))).toEqual(facts(3))
    expect(await cache.read("b", read(4))).toEqual(facts(4))
  })

  it("does not keep a read git failed", async () => {
    const cache = new GitStatusFactsCache()
    expect(await cache.read("a", read(0, false))).toEqual(facts(0))
    expect(await cache.read("a", read(1))).toEqual(facts(1))
  })

  it("neither serves nor keeps facts while a write runs", async () => {
    const cache = new GitStatusFactsCache()
    await cache.read("a", read(1))
    let finish: () => void = () => undefined
    const writing = cache.write(() => new Promise<void>((resolve) => (finish = resolve)))

    expect(await cache.read("a", read(2))).toEqual(facts(2))
    expect(await cache.read("a", read(3))).toEqual(facts(3))

    finish()
    await writing
    expect(await cache.read("a", read(4))).toEqual(facts(4))
  })

  it("does not keep a read that a write started during", async () => {
    const cache = new GitStatusFactsCache()
    const slow = heldRead(1)
    const reading = cache.read("a", slow.compute)
    await cache.write(async () => undefined)
    slow.release()

    // The read is answered as git gave it, but it may predate the write, so it is not kept.
    expect(await reading).toEqual(facts(1))
    expect(await cache.read("a", read(2))).toEqual(facts(2))
  })

  it("ends the write's hold even when the write fails", async () => {
    const cache = new GitStatusFactsCache()
    await expect(cache.write(async () => Promise.reject(new Error("refused")))).rejects.toThrow("refused")

    await cache.read("a", read(1))
    expect(await cache.read("a", read(2))).toEqual(facts(1))
  })
})

describe("watchingWrites", () => {
  /** A git whose every method resolves, recording its name. */
  function fakeGit(calls: string[]): GitSyncGit {
    return new Proxy({} as GitSyncGit, {
      get: (_target, name) => async () => {
        calls.push(String(name))
        return undefined
      },
    })
  }

  it("lets a read leave the facts, and makes a write invalidate them", async () => {
    const calls: string[] = []
    const cache = new GitStatusFactsCache()
    const git = watchingWrites(fakeGit(calls), cache)
    await cache.read("a", read(1))

    await git.log("/clone")
    await git.revParse("/clone", "HEAD")
    expect(await cache.read("a", read(2))).toEqual(facts(1))

    await git.fetch("/clone", "origin")
    expect(await cache.read("a", read(3))).toEqual(facts(3))
    expect(calls).toEqual(["log", "revParse", "fetch"])
  })
})
