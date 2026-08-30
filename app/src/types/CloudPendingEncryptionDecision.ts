/**
 * A local workspace held back from the cloud until someone decides whether it
 * should be end-to-end encrypted. Both answers are permanent.
 */
export interface CloudPendingEncryptionDecision {
  readonly workspaceId: string;
  readonly workspaceName: string;
}
