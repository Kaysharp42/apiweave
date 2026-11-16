/**
 * Where the app's one browser recording is in its life. A re-pick or a
 * re-record replays the steps before its step first (`replaying`); a re-pick
 * then waits for the user to click an element (`picking`).
 */
export type RecordingPhase = "idle" | "starting" | "replaying" | "picking" | "recording" | "stopping";
