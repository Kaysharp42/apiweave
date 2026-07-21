/**
 * Apply cloud changes to local repositories.
 *
 * This module intentionally stays thin: all SQLite access lives in
 * CloudSyncRepository under app/core/repositories.
 */

import { CloudSyncRepository, type CloudApplyResult, type CloudChangeEnvelope } from "../../core/repositories"
import {
  ChangeOp,
  RecordKind,
} from "@apiweave/proto/apiweave/v1/sync_service_pb"

export { ChangeOp, RecordKind }
export type ChangeEnvelope = CloudChangeEnvelope

export function applyToRepositories(repository: CloudSyncRepository, change: ChangeEnvelope): CloudApplyResult {
  return repository.applyChange(change)
}
