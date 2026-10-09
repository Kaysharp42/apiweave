import type { ScopedEnvironment } from "./ScopedEnvironment";

export interface EnvironmentVariablesImportDialogProps {
  isOpen: boolean;
  environment: ScopedEnvironment;
  /** The form's current plain variables, which the import compares against. */
  variables: Record<string, string>;
  onClose: () => void;
  /** Called with the merged plain variables once any secrets are stored. */
  onImported: (variables: Record<string, string>) => void;
}
