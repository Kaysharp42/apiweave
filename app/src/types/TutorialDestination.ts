import type { TutorialDestinationPath } from "./TutorialDestinationPath";

/** A labelled link from a lesson to the surface it describes. */
export interface TutorialDestination {
  readonly label: string;
  readonly path: TutorialDestinationPath;
}
