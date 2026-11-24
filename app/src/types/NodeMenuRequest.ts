/** A node asking the canvas to open its action menu at a screen point. */
export interface NodeMenuRequest {
  readonly nodeId: string;
  /** Viewport coordinates (clientX/clientY) for the menu's top-left. */
  readonly x: number;
  readonly y: number;
  /** Whether the node can expand/collapse, so the menu knows to offer the toggle. */
  readonly collapsible: boolean;
}
