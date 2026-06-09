export interface EnvironmentFormData {
  name: string;
  description: string;
  swaggerDocUrl: string;
  variables: Record<string, string>;
}
