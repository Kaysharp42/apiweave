export interface Workspace {
  workspaceId: string;
  slug: string;
  name: string;
  description: string | null;
  ownerType: "user";
  ownerUserId: string | null;
  isPersonal: boolean;
  createdAt: string;
  updatedAt: string;
}
