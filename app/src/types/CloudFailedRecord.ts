/**
 * One change that failed to sync, named for display. `recordName` is absent
 * when the record was deleted locally after the change was queued.
 */
export interface CloudFailedRecord {
  readonly outboxId: string;
  readonly kind: string;
  readonly recordId: string;
  readonly recordName?: string;
  readonly op: string;
  readonly failureReason?: string;
  readonly attempts: number;
  readonly queuedAt: string;
}
