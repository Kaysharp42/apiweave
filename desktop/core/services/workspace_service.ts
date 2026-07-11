import type { Workspace } from "../../../shared/types/Workspace"
import type { WorkspaceRepository, WorkspaceUpdate } from "../repositories"
import type { SyncProvider } from "../sync/SyncProvider"
import { NotFoundError } from "../ipc/errors"
import type { ScopeResolver } from "./scope_resolver"

/** Input for creating a workspace. `slug` is derived from `name` when omitted. */
export interface WorkspaceCreateInput {
  readonly name: string
  readonly slug?: string
  readonly description?: string | null
  readonly isPersonal?: boolean
}

/**
 * Workspace management. Ported from Python `workspace_service` with the
 * multi-tenant membership graph collapsed to the single local owner: the owner
 * sees every workspace that exists, so there is no per-resource permission gate
 * (workspace is not one of the surviving permission Resources). Existence-hiding
 * is preserved through `scopeResolver` on the by-id operations.
 */
export class WorkspaceService {
  constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly syncProvider: SyncProvider,
    private readonly scopeResolver: ScopeResolver,
  ) {}

  async list(): Promise<readonly Workspace[]> {
    return this.workspaces.listAll()
  }

  async create(input: WorkspaceCreateInput): Promise<Workspace> {
    // Idempotent personal workspace: the local owner has exactly one. A first-run
    // race (or any second `create({isPersonal: true})`) must not spawn a dupe —
    // the redirect keys off `slug === "personal"` and a second slug (`personal-2`)
    // isn't routable. better-sqlite3 is sync, so this guard is race-free.
    const wantPersonal = input.isPersonal ?? true
    if (wantPersonal) {
      const existing = this.workspaces.listAll().find((ws) => ws.isPersonal)
      if (existing !== undefined) return existing
    }

    const created = this.workspaces.create({
      name: input.name,
      slug: this.uniqueSlug(input.slug ?? input.name),
      description: input.description ?? null,
      isPersonal: wantPersonal,
    })
    await this.syncProvider.push()
    return created
  }

  async get(workspaceId: string): Promise<Workspace> {
    await this.mustResolve(workspaceId)
    // Resolver only confirms existence; re-read for the full aggregate.
    return this.workspaces.getById(workspaceId) as Workspace
  }

  async update(workspaceId: string, patch: WorkspaceUpdate): Promise<Workspace> {
    await this.mustResolve(workspaceId)
    const next: WorkspaceUpdate = patch.slug ? { ...patch, slug: this.uniqueSlug(patch.slug, workspaceId) } : patch
    const updated = this.workspaces.update(workspaceId, next)
    if (updated === undefined) throw new NotFoundError(`workspace ${workspaceId} not found`)
    await this.syncProvider.push()
    return updated
  }

  async delete(workspaceId: string): Promise<void> {
    await this.mustResolve(workspaceId)
    this.workspaces.delete(workspaceId)
    await this.syncProvider.push()
  }

  private async mustResolve(workspaceId: string): Promise<void> {
    const resolution = await this.scopeResolver.resolve({ scopeType: "workspace", scopeId: workspaceId })
    if (!resolution.ok) throw new NotFoundError(`workspace ${workspaceId} not found`)
  }

  /** Derive a URL-safe slug and disambiguate against existing workspaces. */
  private uniqueSlug(source: string, selfId?: string): string {
    const base =
      source
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "workspace"
    let candidate = base
    let suffix = 2
    while (true) {
      const clash = this.workspaces.getBySlug(candidate)
      if (clash === undefined || clash.workspaceId === selfId) return candidate
      candidate = `${base}-${suffix}`
      suffix += 1
    }
  }
}
