/** One variable from an imported file, and whether the user is storing it as a secret. */
export interface EnvImportRow {
  key: string;
  value: string;
  asSecret: boolean;
}
