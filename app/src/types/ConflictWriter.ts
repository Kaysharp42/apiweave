/**
 * Cloud-side writer attribution for a conflict (who wrote the cloud copy),
 * resolved server-side. Fields may be empty when attribution is unknown
 * (legacy snapshot, deleted user, or a pull-created conflict). `null` on a
 * conflict means no attribution at all.
 */
export interface ConflictWriter {
  readonly userId: string;
  readonly deviceId: string;
  readonly name: string;
  readonly deviceLabel: string;
}
