import type { TutorialExampleLanguage } from "./TutorialExampleLanguage";

/** A worked example shown in a lesson, rendered in a copyable code block. */
export interface TutorialExample {
  readonly caption: string;
  readonly language: TutorialExampleLanguage;
  readonly code: string;
}
