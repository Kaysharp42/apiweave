/** Organization member with role information. */
export interface OrgMember {
  memberId: string;
  orgId: string;
  userId: string;
  role: OrgRole;
  createdAt: string;
  updatedAt: string;
}

/** Valid organization-level roles. */
export type OrgRole = 'owner' | 'member' | 'billing' | 'security';
