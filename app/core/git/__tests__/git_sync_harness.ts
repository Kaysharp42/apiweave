import path from "node:path"
import { afterEach, vi } from "vitest"
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus"
import { initDatabase, type InitializedDatabase } from "../../db"
import {
  CollectionRepository,
  EnvironmentRepository,
  WorkflowRepository,
  WorkspaceGitRepository,
  WorkspaceRepository,
} from "../../repositories"
import { GitSyncService, type GitSyncGit, type GitSyncRepositories } from "../git_sync_service"
import type { GitService } from "../git_service"
import { anonymousService, makeSandbox, type GitSandbox } from "./git_test_utils"

export interface Harness {
  readonly db: InitializedDatabase
  readonly sandbox: GitSandbox
  readonly repositories: GitSyncRepositories
  readonly sync: GitSyncService
  readonly git: GitService
  readonly cloneRoot: string
  readonly workspaceId: string
  /** The workspace's clone. */
  readonly dir: string
}

const harnesses: Harness[] = []

afterEach(async () => {
  vi.useRealTimers()
  for (const harness of harnesses.splice(0)) {
    await harness.sync.dispose()
    harness.db.close()
  }
})

export interface HarnessOptions {
  /** Interpose on the git the service drives. */
  readonly wrap?: (git: GitService) => GitSyncGit
  /** A git whose configuration names no author, as on a machine where nobody ran `git config --global user.name`. */
  readonly anonymous?: boolean
  /** Told every status the service announces. */
  readonly onStatusChanged?: (status: WorkspaceGitStatus) => void
}

/** A database whose repositories report their writes to a sync service over real git in a temporary root. */
export function openHarness(options: HarnessOptions = {}): Harness {
  const sandbox = makeSandbox()
  const git = options.anonymous === true ? anonymousService(sandbox) : sandbox.service
  const db = initDatabase({ databasePath: ":memory:" })
  let sync: GitSyncService | undefined
  const note = (workspaceId: string): void => sync?.workspaceChanged(workspaceId)
  const repositories: GitSyncRepositories = {
    workspaces: new WorkspaceRepository(db.kvStore, note),
    collections: new CollectionRepository(db.kvStore, note),
    workflows: new WorkflowRepository(db.kvStore, (event) => sync?.workflowChanged(event)),
    environments: new EnvironmentRepository(db.kvStore, note),
    workspaceGit: new WorkspaceGitRepository(db.kvStore),
  }
  const workspaceId = repositories.workspaces.create({ name: "Acme QA", slug: "acme-qa" }).workspaceId
  const cloneRoot = path.join(sandbox.root, "clones")
  sync = new GitSyncService({ cloneRoot, git: options.wrap?.(git) ?? git, repositories, onStatusChanged: options.onStatusChanged })
  const harness = { db, sandbox, repositories, sync, git, cloneRoot, workspaceId, dir: path.join(cloneRoot, workspaceId) }
  harnesses.push(harness)
  return harness
}

/** The real git, call for call: a base for a test that replaces one method. */
export function passthrough(git: GitService): GitSyncGit {
  return {
    init: git.init.bind(git),
    clone: git.clone.bind(git),
    setIdentity: git.setIdentity.bind(git),
    add: git.add.bind(git),
    status: git.status.bind(git),
    commit: git.commit.bind(git),
    log: git.log.bind(git),
    fetch: git.fetch.bind(git),
    push: git.push.bind(git),
    remoteAdd: git.remoteAdd.bind(git),
    remoteSetUrl: git.remoteSetUrl.bind(git),
    remoteRemove: git.remoteRemove.bind(git),
    revParse: git.revParse.bind(git),
    mergeBase: git.mergeBase.bind(git),
    firstRemoteRef: git.firstRemoteRef.bind(git),
  }
}

export async function subjects(harness: Harness): Promise<string[]> {
  return (await harness.git.log(harness.dir)).map((entry) => entry.subject)
}
