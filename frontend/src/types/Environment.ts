import type { Variable } from './Variable';

export interface Environment {
  id: string;
  name: string;
  description?: string;
  variables: Variable[];
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
}
