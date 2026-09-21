import type { TutorialLesson } from "./TutorialLesson";

/**
 * The follow-along companion's props. It reads the practised lesson, its step
 * and the navigation callbacks; it owns no persistence itself.
 */
export interface TutorialCompanionProps {
  readonly lesson: TutorialLesson;
  /** Zero-based index of the active step within `lesson.steps`. */
  readonly stepIndex: number;
  readonly isCollapsed: boolean;
  /** Compact layouts expand instructions over the content area. */
  readonly isExpandedOverContent: boolean;
  readonly isLessonComplete: boolean;
  /** Workspace path the "Return to workspace" action navigates to. */
  readonly returnPath: string;
  /** Resolved in-app path for the lesson's destination, if it has one. */
  readonly destinationHref?: string;
  readonly onCollapse: () => void;
  readonly onExpand: () => void;
  readonly onClose: () => void;
  readonly onPreviousStep: () => void;
  readonly onNextStep: () => void;
  /** Navigate to the full lesson article for this exercise. */
  readonly onOpenLesson: () => void;
  /** Mark the practised lesson complete from the final step. */
  readonly onMarkComplete: () => void;
  /** Advance to the next lesson after completion. */
  readonly onNextLesson: () => void;
  /** Return to the workspace, leaving practice intact. */
  readonly onReturnToWorkspace: () => void;
}
