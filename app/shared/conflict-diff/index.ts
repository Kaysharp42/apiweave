export {
  canonicalizeSyncPayload,
  normalizeConflictKind,
  IDENTITY_PLACEHOLDER,
  type ConflictRecordKind,
} from "./canonicalize"
export type { CanonicalConflictPayload } from "../types/CanonicalConflictPayload"
export { computeConflictDiff, humanizePath } from "./diff"
export type { ConflictDiffEntry, ConflictDiffKind } from "../types/ConflictDiffEntry"