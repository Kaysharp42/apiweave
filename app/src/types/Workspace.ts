export interface Workspace {
  workspaceId: string;
  slug: string;
  name: string;
  description: string | null;
  isPersonal: boolean;
  origin: "local" | "cloud" | "team";
  syncMode: "none" | "push" | "bi-directional";
  createdAt: string;
  updatedAt: string;
}
