export interface EnvironmentListItem {
  id: string;
  environmentId: string;
  name: string;
  description?: string;
  swaggerDocUrl?: string;
  variables: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
  secrets?: Record<string, string>;
}
