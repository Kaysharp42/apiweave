/** A panel's one line after an action: what went wrong (`error`), or something to know about what went right (`notice`). */
export interface PanelMessage {
  readonly tone: "error" | "notice";
  readonly text: string;
}
