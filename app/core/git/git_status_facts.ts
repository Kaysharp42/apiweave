import type { WorkspaceGitCommit } from "@shared/types/WorkspaceGitCommit"
import type { GitSyncGit } from "./git_sync_service"
import type { GitAheadBehind } from "./git_types"

/** The part of a workspace's status that git answers: where HEAD stands against the remote branch, and its newest commit. */
export interface GitStatusFacts {
  readonly divergence: GitAheadBehind
  readonly lastCommit: WorkspaceGitCommit | null
}

/** What reading the facts gave, and whether they may be kept: a read git failed is reported as nothing, and asked again next time. */
export interface GitStatusFactsRead {
  readonly facts: GitStatusFacts
  readonly cacheable: boolean
}

/**
 * Each workspace's {@link GitStatusFacts} as last read, kept until the service
 * next runs anything that can move a ref or replace a clone. Reading them
 * costs three git processes, and most statuses — the first edit after a
 * commit, a cycle starting, the result a cycle returns after announcing it —
 * are asked while nothing in the clone has changed.
 *
 * One generation for the whole service: a write anywhere makes every entry
 * stale. Facts are served only while no write is running, and kept only when
 * none started or finished while they were being read, so a status is never
 * older than the last write that finished before it was asked.
 *
 * Only the service's own writes are seen: a command someone runs by hand in a
 * clone shows in the status after the service next writes.
 */
export class GitStatusFactsCache {
  private generation = 0
  private writing = 0
  private readonly entries = new Map<string, GitStatusFacts>()

  async read(key: string, compute: () => Promise<GitStatusFactsRead>): Promise<GitStatusFacts> {
    const cached = this.writing === 0 ? this.entries.get(key) : undefined
    if (cached !== undefined) return cached
    const generation = this.generation
    const { facts, cacheable } = await compute()
    if (cacheable && this.writing === 0 && generation === this.generation) this.entries.set(key, facts)
    return facts
  }

  /** Run `work`, which may move a ref or replace a clone: every entry is stale from its start to its end. */
  async write<T>(work: () => Promise<T>): Promise<T> {
    this.invalidate()
    this.writing += 1
    try {
      return await work()
    } finally {
      this.writing -= 1
      this.invalidate()
    }
  }

  private invalidate(): void {
    this.generation += 1
    this.entries.clear()
  }
}

/**
 * `git` with every command that may write run through {@link GitStatusFactsCache.write}.
 * Typed as the whole {@link GitSyncGit}, so a method added there does not
 * compile here until it is placed on one side or the other.
 */
export function watchingWrites(git: GitSyncGit, cache: GitStatusFactsCache): GitSyncGit {
  const write =
    <A extends unknown[], R>(method: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> =>
      cache.write(() => method(...args))
  return {
    // Reads: none of these moves a ref. `status` runs with GIT_OPTIONAL_LOCKS=0, so it does not even refresh the index.
    status: git.status.bind(git),
    log: git.log.bind(git),
    lsTree: git.lsTree.bind(git),
    readBlobs: git.readBlobs.bind(git),
    remoteUrls: git.remoteUrls.bind(git),
    resolvedUrl: git.resolvedUrl.bind(git),
    revParse: git.revParse.bind(git),
    mergeBase: git.mergeBase.bind(git),
    show: git.show.bind(git),
    readTreeFiles: git.readTreeFiles.bind(git),
    countAheadBehind: git.countAheadBehind.bind(git),
    countCommits: git.countCommits.bind(git),
    firstRemoteRef: git.firstRemoteRef.bind(git),
    listRemoteHeads: git.listRemoteHeads.bind(git),
    remoteBranches: git.remoteBranches.bind(git),
    // Writes.
    init: write(git.init.bind(git)),
    clone: write(git.clone.bind(git)),
    setIdentity: write(git.setIdentity.bind(git)),
    add: write(git.add.bind(git)),
    commit: write(git.commit.bind(git)),
    clean: write(git.clean.bind(git)),
    fetch: write(git.fetch.bind(git)),
    push: write(git.push.bind(git)),
    remoteAdd: write(git.remoteAdd.bind(git)),
    remoteSetUrl: write(git.remoteSetUrl.bind(git)),
    remoteRemove: write(git.remoteRemove.bind(git)),
    mergeFastForward: write(git.mergeFastForward.bind(git)),
    mergeNoCommit: write(git.mergeNoCommit.bind(git)),
    mergeAbort: write(git.mergeAbort.bind(git)),
    resetHard: write(git.resetHard.bind(git)),
    checkout: write(git.checkout.bind(git)),
  }
}
