export interface EnvironmentFormData {
  name: string;
  description: string;
  swaggerDocUrl: string;
  baseEnvironmentId: string | null;
  variables: Record<string, string>;
  allowedWorkspaceIds?: string[];
}
