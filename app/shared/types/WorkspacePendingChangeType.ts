/** What a commit would do to a record. A record that was renamed or moved is `changed`, not a deletion and an addition. */
export type WorkspacePendingChangeType = "added" | "changed" | "deleted"
