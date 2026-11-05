/** Refresh the selected environment's imported OpenAPI document. */
export interface CanvasToolbarRefreshButtonProps {
  readonly onRefreshSwagger?: (() => void) | undefined;
  readonly isSwaggerRefreshing: boolean;
  readonly showLabel: boolean;
}
