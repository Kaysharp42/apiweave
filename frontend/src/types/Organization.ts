/** Organization returned by the backend API. */
export interface Organization {
  orgId: string;
  slug: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}
