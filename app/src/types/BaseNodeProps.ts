import type { ReactNode, Dispatch, SetStateAction } from "react";
import type { NodeStatus } from "./NodeStatus";
import type { NodeHandleConfig } from "./NodeHandleConfig";
import type { NodePresetNodeType } from "./NodePresetNodeType";
import type { NodeRunLine } from "./NodeRunLine";
import type { NodeMetric } from "./NodeMetric";
import type { NodeProgress } from "./NodeProgress";

export interface BaseNodeProps {
  children?:
    | ReactNode
    | (({
        isExpanded,
        setIsExpanded,
      }: {
        isExpanded: boolean;
        setIsExpanded: Dispatch<SetStateAction<boolean>>;
      }) => ReactNode);
  title?: string;
  icon?: ReactNode;
  status?: NodeStatus;
  selected?: boolean;
  handleLeft?: NodeHandleConfig | false;
  handleRight?: NodeHandleConfig | false;
  extraHandles?: ReactNode;
  nodeId?: string;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  showMenu?: boolean;
  /**
   * Set by node components whose config can be saved to the workspace preset
   * library; omitted by `start`/`end`, which have no config. Presence alone
   * drives the "Save as preset" action-menu item — the canvas re-reads the real
   * type and config from the graph when the action fires.
   */
  presetNodeType?: NodePresetNodeType;
  /**
   * The node type's hue, as a token reference — `"var(--aw-method-post)"`.
   * Tints the icon tile at 12% and colours the icon at full strength. Hues come
   * from the existing method and status tokens; the node layer introduces none.
   */
  tileHue?: string;
  /**
   * Short identity chip in the header — the HTTP method, the delay duration,
   * the branch count. Rendered in mono at 11px.
   */
  typeChip?: ReactNode;
  /**
   * Identity at a glance while the node is at rest: `POST` +
   * `api.shop.dev/auth/login`, `2 assertions`, `waits 1.5s`. Replaced by the run
   * strip once the node has run.
   */
  restLine?: NodeRunLine;
  /** Current operation, shown while the node is running. */
  activityLine?: NodeRunLine;
  /** What happened, shown once the node has finished. */
  resultSummary?: NodeRunLine;
  /** Fixed-shape metrics row. Cells with a null value render an em dash. */
  metrics?: NodeMetric[];
  /** Progress rail state. Rendered only while running. */
  progress?: NodeProgress;
  className?: string;
  /**
   * @deprecated Superseded by `typeChip`. Still rendered in the chip slot as a
   * fallback so the node types can migrate one at a time; removed once the last
   * caller is gone.
   */
  titleExtra?: ReactNode;
}
