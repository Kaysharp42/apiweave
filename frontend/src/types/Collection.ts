export interface Collection {
  id: string;
  name: string;
  description?: string;
  workflowIds: string[];
  createdAt: string;
  updatedAt: string;
  environmentId?: string;
}
