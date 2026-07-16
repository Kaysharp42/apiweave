import { RecordKind } from "@apiweave/proto/apiweave/v1/sync_service_pb"
import type { KVStore } from "../db"
import {
  CloudSyncRepository,
  CollectionRepository,
  EnvironmentRepository,
  WorkflowRepository,
  WorkspaceRepository,
  type CloudOutboxKind,
  type CloudWorkspaceBinding,
} from "../repositories"
import {
  recordCollectionUpsert,
  recordEnvironmentUpsert,
  recordWorkflowUpsert,
  recordWorkspaceUpsert,
} from "../sync/cloud-mutations"
import type { SyncMutation, SyncProvider } from "../sync/SyncProvider"

export interface CloudFirstSyncBindingInput {
  readonly workspaceId: string
  readonly cloudWorkspaceId: string
  readonly cloudWorkspaceName: string
  readonly teamId?: string
  readonly teamName?: string
  readonly syncMode: "push" | "bi-directional"
  readonly deviceId: string
}

export class CloudFirstSyncService {
  public constructor(private readonly store: KVStore) {}

  public bindAndSnapshot(input: CloudFirstSyncBindingInput): CloudWorkspaceBinding {
    return this.store.transaction((tx) => {
      const cloud = new CloudSyncRepository(tx)
      const existingLocal = cloud.getWorkspaceBinding(input.workspaceId)
      if (existingLocal !== undefined) {
        if (existingLocal.cloudWorkspaceId !== input.cloudWorkspaceId) {
          throw new Error("Local workspace is already bound to a different cloud workspace")
        }
        return existingLocal
      }
      if (cloud.getWorkspaceBindingByCloudId(input.cloudWorkspaceId) !== undefined) {
        throw new Error("Cloud workspace is already bound to a different local workspace")
      }

      const workspaceRepository = new WorkspaceRepository(tx)
      const workspace = workspaceRepository.getById(input.workspaceId)
      if (workspace === undefined || workspace.deletedAt !== null) {
        throw new Error("Local workspace does not exist")
      }
      const syncWorkspace = workspaceRepository.update(input.workspaceId, {
        origin: input.teamId === undefined ? "cloud" : "team",
        syncMode: input.syncMode,
      })
      if (syncWorkspace === undefined) {
        throw new Error("Local workspace could not be prepared for cloud sync")
      }

      cloud.resetCursor(input.cloudWorkspaceId)
      cloud.upsertWorkspaceBinding({
        workspaceId: input.workspaceId,
        cloudWorkspaceId: input.cloudWorkspaceId,
        cloudWorkspaceName: input.cloudWorkspaceName,
        teamId: input.teamId ?? null,
        teamName: input.teamName ?? null,
        syncMode: input.syncMode,
        deviceId: input.deviceId,
        initializationState: "pulling",
      })

      const recorder = new BaselineRecorder(cloud)
      recordWorkspaceUpsert(recorder, syncWorkspace)
      for (const environment of new EnvironmentRepository(tx).listByWorkspace(input.workspaceId).items) {
        recordEnvironmentUpsert(recorder, environment)
      }
      for (const collection of new CollectionRepository(tx).listByWorkspace(input.workspaceId).items) {
        recordCollectionUpsert(recorder, collection)
      }
      for (const workflow of new WorkflowRepository(tx).listByWorkspace(input.workspaceId, true).items) {
        recordWorkflowUpsert(recorder, workflow)
      }

      const binding = cloud.getWorkspaceBinding(input.workspaceId)
      if (binding === undefined) {
        throw new Error("Cloud workspace binding was not persisted")
      }
      return binding
    })
  }
}

class BaselineRecorder implements SyncProvider {
  public constructor(private readonly repository: CloudSyncRepository) {}

  public recordMutation(mutation: SyncMutation): void {
    this.repository.enqueueBaselineOutbox({
      workspace_id: mutation.workspaceId,
      kind: recordKindToOutboxKind(mutation.kind),
      record_id: mutation.recordId,
      expected_rev: 0,
      op: "upsert",
      payload: mutation.payload,
    })
  }

  public async pull(): Promise<void> {}

  public async push(): Promise<void> {}
}

function recordKindToOutboxKind(kind: RecordKind): CloudOutboxKind {
  switch (kind) {
    case RecordKind.WORKSPACE: return "workspace"
    case RecordKind.PROJECT: return "project"
    case RecordKind.WORKFLOW: return "workflow"
    case RecordKind.ENVIRONMENT: return "environment"
    default: throw new Error(`Unsupported baseline record kind: ${kind}`)
  }
}
