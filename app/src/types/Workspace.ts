export interface Workspace {
  workspaceId: string;
  slug: string;
  name: string;
  description: string | null;
  isPersonal: boolean;
  createdAt: string;
  updatedAt: string;
}
