import { Card } from "../molecules/Card";
import { DetailField } from "../molecules/DetailField";
import { formatTimestamp } from "../../utils/formatTimestamp";
import type { Secret } from "../../types";

interface SecretDetailsCardProps {
  readonly secret: Secret;
  /** Display name of the workspace whose scope holds the secret. */
  readonly workspaceName: string;
}

/**
 * The selected secret's metadata card. There are no values here — a secret
 * cannot be read back, only renamed, copied or moved.
 */
export function SecretDetailsCard({ secret, workspaceName }: SecretDetailsCardProps) {
  return (
    <Card title={secret.name}>
      <div className="space-y-3">
        <DetailField label="Workspace">{workspaceName}</DetailField>
        <DetailField label="Key name" mono>
          {secret.name}
        </DetailField>
        <DetailField label="Scope">
          <span className="capitalize">{secret.scopeType}</span>
        </DetailField>
        <DetailField label="Status">Set · encrypted and write-only</DetailField>
        <DetailField label="Created">
          {formatTimestamp(secret.createdAt)}
        </DetailField>
        <DetailField label="Updated">
          {formatTimestamp(secret.updatedAt)}
        </DetailField>
        <DetailField label="Key ID" mono breakAll>
          {secret.keyId}
        </DetailField>
      </div>
    </Card>
  );
}
