import { RefreshCw } from "lucide-react";
import { Button } from "../atoms/Button";
import { Tooltip } from "../atoms/Tooltip";
import type { CanvasToolbarRefreshButtonProps } from "../../types";

/** Refresh the selected environment's imported OpenAPI document. */
export function CanvasToolbarRefreshButton({
  onRefreshSwagger,
  isSwaggerRefreshing,
  showLabel,
}: CanvasToolbarRefreshButtonProps) {
  return (
    <Tooltip
      content={
        isSwaggerRefreshing
          ? "Refreshing from OpenAPI spec"
          : "Refresh from OpenAPI spec"
      }
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefreshSwagger}
        disabled={!onRefreshSwagger || isSwaggerRefreshing}
        className="h-8 shrink-0 whitespace-nowrap"
        icon={
          <RefreshCw
            className={`w-4 h-4 shrink-0 ${isSwaggerRefreshing ? "animate-spin motion-reduce:animate-none" : ""}`}
          />
        }
        aria-label="Refresh from OpenAPI spec"
      >
        {showLabel && (
          <span>
            {isSwaggerRefreshing
              ? "Refreshing from OpenAPI spec"
              : "Refresh from OpenAPI spec"}
          </span>
        )}
      </Button>
    </Tooltip>
  );
}
