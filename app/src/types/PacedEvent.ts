/** What the canvas is asked to show for one node. */
export interface PacedEvent {
  nodeId: string;
  status: string;
  result?: unknown;
}
