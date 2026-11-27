import { Button } from "../../atoms/Button";
import { EmptyState } from "../../molecules/EmptyState";
import type { SidebarListEmptyStateProps } from "../../../types";

/**
 * A sidebar list with nothing to show: either the search filtered every row out,
 * or there is nothing yet, in which case it offers to create the first one.
 */
export function SidebarListEmptyState({
  icon: Icon,
  items,
  emptyDescription,
  createLabel,
  searchQuery,
  onCreate,
}: SidebarListEmptyStateProps) {
  return (
    <EmptyState
      icon={
        <Icon
          className="w-12 h-12 text-text-muted dark:text-text-muted-dark"
          strokeWidth={1.5}
        />
      }
      title={searchQuery ? `No matching ${items}` : `No ${items} yet`}
      description={
        searchQuery ? `No ${items} match "${searchQuery}"` : emptyDescription
      }
      action={
        !searchQuery && (
          <Button
            variant="primary"
            intent="default"
            size="sm"
            onClick={onCreate}
            icon={<Icon className="w-4 h-4" />}
          >
            {createLabel}
          </Button>
        )
      }
    />
  );
}
