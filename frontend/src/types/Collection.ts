export interface Collection {
  id: string;
  collectionId: string;
  name: string;
  description?: string;
  workflowIds: string[];
  createdAt: string;
  updatedAt: string;
  environmentId?: string;
}
