import type { ReactNode, Dispatch, SetStateAction } from "react";
import type { NodeStatus } from "./NodeStatus";
import type { NodeHandleConfig } from "./NodeHandleConfig";

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
  statusBadgeText?: string;
  titleExtra?: ReactNode;
  className?: string;
}
