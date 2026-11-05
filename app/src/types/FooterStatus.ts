import type { FooterRunPhase } from "./FooterRunPhase";

/** What the status bar says about the active workflow tab's latest run. */
export interface FooterStatus {
  readonly phase: FooterRunPhase;
  readonly label: string;
}
