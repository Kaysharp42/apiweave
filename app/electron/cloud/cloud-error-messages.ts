/**
 * Human-readable cloud-sync error messages.
 *
 * The sync transport talks to the cloud in protobuf enums (PushOutcome.Status,
 * RejectionReason) and raw transport errors. Those are useful in logs but
 * user-hostile in the UI — "status=3 rejectionReason=4" tells a user nothing.
 * This module is the single place that turns machine codes into sentences.
 * Raw codes stay in the logs; only these strings reach the UI.
 */

import { RejectionReason } from "@apiweave/proto/apiweave/v1/sync_service_pb"
import { ErrCloudOffline } from "./cloud-client"

const REJECTION_MESSAGES: Record<number, string> = {
  [RejectionReason.FORBIDDEN_PAYLOAD]:
    "This record contains data that can't be synced (secrets or run history stay on this device).",
  [RejectionReason.WORKSPACE_NOT_FOUND]:
    "This workspace no longer exists in the cloud. Reconnect to re-create it.",
  [RejectionReason.RECORD_NOT_FOUND]: "This record was already removed in the cloud.",
  [RejectionReason.UNAUTHORIZED]: "You don't have permission to sync changes to this workspace.",
  [RejectionReason.INVALID_KIND]: "This record type can't be synced by this app version.",
}

const INTERNAL_MESSAGE =
  "The cloud couldn't apply a change. It'll retry automatically; if it keeps failing, reconnect."

const OFFLINE_MESSAGE = "Can't reach the cloud right now. Sync will resume when you're back online."
const GENERIC_TRANSPORT_MESSAGE =
  "Something went wrong talking to the cloud. Sync will retry automatically."

/** Maps a rejected push outcome's rejection reason to a user-facing sentence. */
export function rejectionMessage(rejectionReason: number): string {
  return REJECTION_MESSAGES[rejectionReason] ?? INTERNAL_MESSAGE
}

/** Maps a thrown transport error to a user-facing sentence. */
export function transportErrorMessage(error: unknown): string {
  if (error instanceof ErrCloudOffline) {
    return OFFLINE_MESSAGE
  }
  return GENERIC_TRANSPORT_MESSAGE
}
