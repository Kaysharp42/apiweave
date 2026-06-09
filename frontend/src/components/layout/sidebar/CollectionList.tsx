import { Layers } from 'lucide-react';
import { Button } from '../../atoms/Button';
import { EmptyState } from '../../molecules/EmptyState';
import { CollectionItem } from './CollectionItem';
import type { CollectionListProps } from '../../../types';

/**
 * Renders the collection list section of the sidebar.
 * Shows empty state or list of expandable collection items.
 */
export function CollectionList({
  collections,
  workflows,
  environments,
  selectedWorkflowId,
  searchQuery,
  expandedCollections,
  onToggleCollection,
  onWorkflowClick,
  onExportWorkflow,
  onDeleteWorkflow,
  onExportCollection,
  onDeleteCollection,
  onCreateCollection,
}: CollectionListProps) {
  if (collections.length === 0) {
    return (
      <EmptyState
        icon={<Layers className="w-12 h-12 text-text-muted dark:text-text-muted-dark" strokeWidth={1.5} />}
        title={searchQuery ? 'No matching collections' : 'No collections yet'}
        description={
          searchQuery
            ? `No collections match "${searchQuery}"`
            : 'Create collections to organize your workflows'
        }
        action={
          !searchQuery && (
            <Button variant="primary" intent="success" size="sm" onClick={onCreateCollection} icon={<Layers className="w-4 h-4" />}>
              Create Collection
            </Button>
          )
        }
      />
    );
  }

  return (
    <ul className="w-full list-none space-y-1 px-0.5">
      {collections.map((collection) => (
        <CollectionItem
          key={collection.collectionId}
          collection={collection}
          isExpanded={expandedCollections.has(collection.collectionId)}
          workflows={workflows}
          collections={collections}
          environments={environments}
          selectedWorkflowId={selectedWorkflowId}
          onToggle={onToggleCollection}
          onWorkflowClick={onWorkflowClick}
          onExportCollection={onExportCollection}
          onDeleteCollection={onDeleteCollection}
          onExportWorkflow={onExportWorkflow}
          onDeleteWorkflow={onDeleteWorkflow}
        />
      ))}
    </ul>
  );
}