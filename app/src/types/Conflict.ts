import type { ConflictListItem } from "./ConflictListItem";
import type { ConflictPayload } from "./ConflictPayload";

export interface Conflict extends ConflictListItem {
  readonly local_payload: ConflictPayload;
  readonly cloud_payload: ConflictPayload;
}
