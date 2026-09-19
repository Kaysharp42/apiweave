import type { ReactNode } from "react";

/** A titled group inside the lesson reader (Outcome, Steps, Example, …). */
export interface TutorialSectionProps {
  readonly title: string;
  readonly children: ReactNode;
}
