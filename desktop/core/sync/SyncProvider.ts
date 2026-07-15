import { ChangeOp, RecordKind } from "@apiweave/proto/apiweave/v1/sync_service_pb"

export interface SyncMutation {
  readonly workspaceId: string
  readonly kind: RecordKind
  readonly recordId: string
  readonly expectedRev: number
  readonly op: ChangeOp
  readonly payload: Uint8Array | null
}

export interface SyncProvider {
  recordMutation(mutation: SyncMutation): void
  pull(): Promise<void>
  push(): Promise<void>
}
