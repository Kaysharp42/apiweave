export interface Workspace {
  workspaceId: string;
  slug: string;
  name: string;
  description: string | null;
  ownerType: "user" | "organization";
  ownerUserId: string | null;
  orgId: string | null;
  isPersonal: boolean;
  createdAt: string;
  updatedAt: string;
}
