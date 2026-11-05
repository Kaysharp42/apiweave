import type { FooterRunPhase } from "./FooterRunPhase";

/** The latest run of one workflow, as the footer can report it. */
export interface FooterRunState {
  readonly runId: string;
  readonly phase: FooterRunPhase;
  /** The run's wall-clock duration, once the finished record has been read. */
  readonly durationMs: number | null;
}
