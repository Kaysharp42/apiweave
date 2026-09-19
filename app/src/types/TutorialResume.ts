/**
 * The lesson and step the reader left off at, for the resume card.
 *
 * `allComplete` distinguishes "you have finished the course, revisit a
 * favourite" from "keep going", and `started` distinguishes a lesson the
 * reader has actually opened from the first one the library would offer on a
 * fresh install.
 */
export interface TutorialResume {
  readonly lessonId: string;
  readonly title: string;
  readonly stepNumber: number;
  readonly stepCount: number;
  readonly allComplete: boolean;
  readonly started: boolean;
}
