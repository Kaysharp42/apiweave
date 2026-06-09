import type { EnvironmentFormData } from './EnvironmentFormData';
import type { EnvironmentListItem } from './EnvironmentListItem';

export interface EnvironmentManagerState {
  selectedEnv: EnvironmentListItem | null;
  isEditing: boolean;
  showSecretsPanel: boolean;
  deleteTarget: string | null;
  formData: EnvironmentFormData;
  newVarKey: string;
  newVarValue: string;
}
