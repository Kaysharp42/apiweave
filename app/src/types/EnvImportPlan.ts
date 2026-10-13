/** The outcome of an environment variable import, before anything is written. */
export interface EnvImportPlan {
  /** The environment's plain variables after the import. Never holds a row imported as a secret. */
  variables: Record<string, string>;
  /** Values to seal into the environment's secret store. */
  secrets: { name: string; value: string }[];
  /** Plain variables dropped because the same key is now stored as a secret. */
  removedVariables: string[];
  /** Stored secrets to delete because the same key is now a plain variable. */
  removedSecrets: string[];
  /** Conflicting rows left as they were because the user chose to keep existing values. */
  kept: number;
}
