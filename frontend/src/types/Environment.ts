import type { Variable } from './Variable';

export interface Environment {
  id: string;
  environmentId: string;
  name: string;
  description?: string;
  variables: Variable[];
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
  isActive?: boolean;
  secrets?: Record<string, string>;
}
