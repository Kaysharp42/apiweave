/** Team within an organization. */
export interface Team {
  teamId: string;
  orgId: string;
  slug: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}
