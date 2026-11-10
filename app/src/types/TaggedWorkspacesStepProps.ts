import type { GitAccountRef } from "@shared/types/GitAccountRef";
import type { TaggedWorkspacesFeed } from "./TaggedWorkspacesFeed";

export interface TaggedWorkspacesStepProps {
  readonly account: GitAccountRef;
  readonly feed: TaggedWorkspacesFeed;
}
