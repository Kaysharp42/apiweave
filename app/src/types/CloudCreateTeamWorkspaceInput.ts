export interface CloudCreateTeamWorkspaceInput {
  readonly name: string;
  readonly slug: string;
  readonly description?: string | null;
  readonly teamId?: string;
  readonly newTeamName?: string;
}
