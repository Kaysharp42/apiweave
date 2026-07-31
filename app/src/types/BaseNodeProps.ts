import type { ReactNode, Dispatch, SetStateAction } from "react";
import type { NodeStatus } from "./NodeStatus";
import type { NodeHandleConfig } from "./NodeHandleConfig";
import type { NodePresetNodeType } from "./NodePresetNodeType";

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
  headerBg?: string;
  headerTextClass?: string;
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
  statusBadgeText?: string;
  titleExtra?: ReactNode;
  className?: string;
}
