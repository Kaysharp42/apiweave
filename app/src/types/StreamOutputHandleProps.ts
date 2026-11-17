export interface StreamOutputHandleProps {
  /** The stream phase this output fires after. */
  id: "ready" | "complete";
  label: string;
  /** Vertical offset from the node's middle, so the two sockets sit apart. */
  offsetY: number;
}
