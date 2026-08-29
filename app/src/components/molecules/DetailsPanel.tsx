import type { ReactNode } from "react";
import { Card } from "./Card";

interface DetailsPanelProps {
  readonly title: string;
  /** Whether the details card has an item to show at all. */
  readonly hasItem: boolean;
  /** What the panel shows when nothing is selected — an `EmptyState`. */
  readonly empty: ReactNode;
  readonly children: ReactNode;
}

/**
 * The right-hand sidebar of the workspace settings pages: the selected row's
 * details card, or the empty-state prompt when nothing is selected.
 */
export function DetailsPanel({ title, hasItem, empty, children }: DetailsPanelProps) {
  if (!hasItem) return <div className="space-y-4">{empty}</div>;
  return (
    <div className="space-y-4">
      <Card title={title}>
        <div className="space-y-3">{children}</div>
      </Card>
    </div>
  );
}
