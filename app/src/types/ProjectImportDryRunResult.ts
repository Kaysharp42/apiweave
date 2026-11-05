/** What validating an `.aweproject` bundle reports before anything is imported. */
export interface ProjectImportDryRunResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    schemaVersion: string;
    workflows: number;
    environments: number;
    secretReferences: number;
    missingSecrets: number;
  };
}
