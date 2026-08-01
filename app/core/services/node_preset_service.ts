import type { JsonValue } from "@shared/types/JsonValue"
import type { NodePreset } from "@shared/types/NodePreset"
import { nodePresetConfigSchemaFor } from "@shared/zod-schemas/NodePresetSchema"
import type { NodePresetCreate, NodePresetRepository, NodePresetUpdate } from "../repositories"
import { canonicalizeNodeConfig } from "../repositories/helpers"
import type { PermissionProvider } from "../auth/PermissionProvider"
import { NotFoundError, ValidationError } from "../ipc/errors"
import { RESOURCE_NODE_PRESETS } from "../auth/permissions"
import { authorizeWorkspace } from "./authorize"
import type { ScopeResolver } from "./scope_resolver"

/**
 * Workspace-scoped node-preset library (FEATURE-IDEAS §6.2) — the persisted,
 * named counterpart to the sessionStorage canvas clipboard.
 *
 * Takes no `SyncProvider`, unlike every sibling service: a preset has no
 * `RecordKind` in the sync contract (`apiweave-proto` knows only workspace /
 * project / workflow / environment), so there is nothing to record. Injecting
 * one would be an unused dependency that reads as "syncs, silently broken"
 * rather than "local-only, by decision" — see the plan's Sync note for 6.2.
 */
export class NodePresetService {
  constructor(
    private readonly presets: NodePresetRepository,
    private readonly permissions: PermissionProvider,
    private readonly scopeResolver: ScopeResolver,
  ) {}

  async create(workspaceId: string, input: Omit<NodePresetCreate, "workspaceId">): Promise<NodePreset> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "create", RESOURCE_NODE_PRESETS)
    const config = this.canonicalConfig(input.nodeType, input.config ?? {})
    return this.presets.create({ ...input, workspaceId, config })
  }

  async list(workspaceId: string): Promise<{ items: readonly NodePreset[]; total: number }> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_NODE_PRESETS)
    return this.presets.listByWorkspace(workspaceId)
  }

  async update(workspaceId: string, presetId: string, patch: NodePresetUpdate): Promise<NodePreset> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_NODE_PRESETS)
    const existing = this.mustGet(workspaceId, presetId)
    // The config must be legal for the node type it will have AFTER the patch,
    // so a nodeType-only patch can't strand an incompatible config on the row.
    const nextNodeType = patch.nodeType ?? existing.nodeType
    const effectivePatch: NodePresetUpdate =
      patch.nodeType !== undefined || patch.config !== undefined
        ? { ...patch, config: this.canonicalConfig(nextNodeType, patch.config ?? existing.config) }
        : patch
    const updated = this.presets.update(presetId, effectivePatch)
    if (updated === undefined) throw new NotFoundError(`node preset ${presetId} not found`)
    return updated
  }

  async delete(workspaceId: string, presetId: string): Promise<void> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "delete", RESOURCE_NODE_PRESETS)
    this.mustGet(workspaceId, presetId)
    this.presets.delete(presetId)
  }

  private mustGet(workspaceId: string, presetId: string): NodePreset {
    const preset = this.presets.getById(presetId)
    if (preset === undefined || preset.workspaceId !== workspaceId) {
      throw new NotFoundError(`node preset ${presetId} not found`)
    }
    return preset
  }

  /**
   * A preset only earns its keep if dropping it produces a node the strict
   * `WorkflowNodeSchema` accepts, so the config is reduced to the canonical
   * node shape and then validated against the same per-type node-data schema
   * the graph uses. Catching it here means a bad preset is rejected at save
   * time rather than poisoning every workflow it is later dragged into.
   *
   * The canonicalisation pass mirrors what `handlers/workflows.ts` does for
   * `nodes` on create/update: a config promoted from a canvas node can still
   * carry the legacy `headers`-as-multiline-string form, which is legal input
   * but not a legal stored shape.
   */
  private canonicalConfig(
    nodeType: NodePreset["nodeType"],
    config: Record<string, JsonValue>,
  ): Record<string, JsonValue> {
    const canonicalNode = canonicalizeNodeConfig({ type: nodeType, config }) as {
      config?: Record<string, JsonValue>
    }
    const canonical = canonicalNode.config ?? config
    const parsed = nodePresetConfigSchemaFor(nodeType).safeParse(canonical)
    if (!parsed.success) {
      throw new ValidationError(`preset config is not a valid ${nodeType} config`, parsed.error.issues)
    }
    return canonical
  }
}
