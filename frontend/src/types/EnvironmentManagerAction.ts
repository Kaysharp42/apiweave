import type { EnvironmentFormData } from './EnvironmentFormData';
import type { EnvironmentListItem } from './EnvironmentListItem';

export type EnvironmentManagerAction =
  | { type: 'select'; env: EnvironmentListItem | null }
  | { type: 'start-create' }
  | { type: 'start-edit'; env: EnvironmentListItem }
  | { type: 'set-form'; formData: EnvironmentFormData }
  | { type: 'patch-form'; patch: Partial<EnvironmentFormData> }
  | { type: 'set-new-var-key'; value: string }
  | { type: 'set-new-var-value'; value: string }
  | { type: 'open-secrets' }
  | { type: 'close-secrets' }
  | { type: 'set-delete-target'; value: string | null }
  | { type: 'reset-editor' };
