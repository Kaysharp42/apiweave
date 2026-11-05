import type { RunTerminalStatus } from "@shared/types/RunProgressEvent";

/** A run on the canvas: still playing back, or finished with one terminal outcome. */
export type FooterRunPhase = "running" | RunTerminalStatus;
