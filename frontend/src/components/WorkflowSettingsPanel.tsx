import { useState } from 'react';
import { useWorkflow } from '../contexts/WorkflowContext';
import API_BASE_URL from '../utils/api';
import { toast } from 'sonner';
import { ToggleLeft, Check, X, RefreshCw, Plus, Info, ChevronDown, LayoutGrid, Search } from 'lucide-react';
import { Button } from './atoms/Button';
import { Toggle } from './atoms/Toggle';
import { Spinner } from './atoms/Spinner';
import { Input } from './atoms/Input';
import { authenticatedFetch } from '../utils/authenticatedApi';

type BackgroundColor = string;

interface LocalCollection {
  collectionId: string;
  name: string;
  description?: string;
  color?: BackgroundColor;
}

export function WorkflowSettingsPanel() {
  const {
    settings,
    updateSettings,
    workflowId,
    collections,
    isLoadingCollections,
    refreshCollectionsAndWorkflows,
    currentCollection,
    setCurrentCollectionId,
  } = useWorkflow();
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [showCollectionDropdown, setShowCollectionDropdown] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const normalizedQuery = searchTerm.trim().toLowerCase();
  const matchesSearch = (value: string): boolean => !normalizedQuery || value.toLowerCase().includes(normalizedQuery);

  const executionSectionMatch = matchesSearch('execution settings continue on fail');
  const continueOnFailItemMatch = matchesSearch('continue on fail stops at first api failure continues even if api fails');
  const showExecutionSection = executionSectionMatch || continueOnFailItemMatch;
  const showExecutionItem = executionSectionMatch || continueOnFailItemMatch;

  const collectionsSectionMatch = matchesSearch('collections collection assignment add remove');
  const collectionAssignmentItemMatch = matchesSearch('add to collection remove from collection workflow collection assignment');
  const showCollectionsSection = collectionsSectionMatch || collectionAssignmentItemMatch;
  const showCollectionsItem = collectionsSectionMatch || collectionAssignmentItemMatch;

  const infoSectionMatch = matchesSearch('about continue on fail useful for testing error scenarios conditional workflows');
  const showInfoSection = infoSectionMatch;
  const hasSearchMatches = showExecutionSection || showCollectionsSection || showInfoSection;

  const handleContinueOnFailChange = (value: boolean): void => {
    updateSettings({
      continueOnFail: value,
    });
  };

  const handleAssignToCollection = async (collectionId: string): Promise<void> => {
    if (!workflowId) {
      toast.error('Workflow ID not found');
      return;
    }

    const selectedCollection = collections.find((c) => c.collectionId === collectionId);
    if (!selectedCollection) {
      toast.error('Collection not found');
      return;
    }

    setAssignmentLoading(true);
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/collections/${collectionId}/workflows/${workflowId}`,
        { method: 'POST' }
      );

      if (response.ok) {
        setCurrentCollectionId(selectedCollection.collectionId);
        toast.success(`Workflow added to "${selectedCollection.name}"`);

        if (refreshCollectionsAndWorkflows) {
          refreshCollectionsAndWorkflows();
        }
      } else {
        const errorData = await response.json() as { message?: string };
        toast.error(errorData.message ?? 'Failed to add workflow to collection');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to add workflow to collection: ${message}`);
    } finally {
      setAssignmentLoading(false);
    }
  };

  const handleRemoveFromCollection = async (): Promise<void> => {
    if (!workflowId || !currentCollection) {
      toast.error('No collection assignment to remove');
      return;
    }

    setAssignmentLoading(true);
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/collections/${currentCollection.collectionId}/workflows/${workflowId}`,
        { method: 'DELETE' }
      );

      if (response.ok) {
        setCurrentCollectionId(null);
        toast.success(`Workflow removed from "${currentCollection.name}"`);

        if (refreshCollectionsAndWorkflows) {
          refreshCollectionsAndWorkflows();
        }
      } else {
        const errorData = await response.json() as { message?: string };
        toast.error(errorData.message ?? 'Failed to remove workflow from collection');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to remove workflow from collection: ${message}`);
    } finally {
      setAssignmentLoading(false);
    }
  };

  return (
    <div className="w-full bg-surface dark:bg-surface-dark h-full flex flex-col border-t border-border dark:border-border-dark">
      <div className="p-3 space-y-4">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted dark:text-text-muted-dark" />
          <Input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search settings"
            className="pl-8 pr-2 py-1.5 text-xs"
            aria-label="Search settings"
          />
        </div>

        {/* Continue on Fail Option */}
        {showExecutionSection && (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-text-primary dark:text-text-primary-dark flex items-center gap-2">
            <ToggleLeft className="w-4 h-4 flex-shrink-0" />
            <span>Execution Settings</span>
          </div>

          {showExecutionItem && (
          <div className="p-3 bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <Toggle
                  label="Continue on Fail"
                  checked={settings.continueOnFail as boolean ?? false}
                  onChange={(e) => handleContinueOnFailChange(e.target.checked)}
                  size="sm"
                  variant="primary"
                />
                <p className="text-[10px] text-text-secondary dark:text-text-secondary-dark mt-1">
                  {settings.continueOnFail ? (
                    <span className="flex items-center gap-1">
                      <Check className="w-3 h-3 text-status-success dark:text-status-success-dark flex-shrink-0" />
                      Workflow continues even if an API fails
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <X className="w-3 h-3 text-status-error dark:text-status-error-dark flex-shrink-0" />
                      Workflow stops at the first API failure
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
          )}
        </div>
        )}

        {/* Collection Assignment Section */}
        {showCollectionsSection && (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-text-primary dark:text-text-primary-dark flex items-center gap-2">
            <LayoutGrid className="w-4 h-4 flex-shrink-0" />
            <span>Collections</span>
          </div>
          {showCollectionsItem && (
          <div className="relative">
            {isLoadingCollections ? (
              <div className="flex items-center justify-center py-3 px-4 bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded">
                <Spinner size="sm" />
                <span className="ml-2 text-sm text-text-secondary dark:text-text-secondary-dark">Loading collections…</span>
              </div>
            ) : currentCollection ? (
              <div className="flex items-center justify-between px-4 py-3 text-sm bg-primary/5 dark:bg-primary/10 border border-primary/20 dark:border-primary/30 rounded">
                <div className="flex items-center gap-3">
                  {(currentCollection as unknown as LocalCollection).color && (
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0 border border-primary/30 dark:border-primary/50"
                      style={{ backgroundColor: (currentCollection as unknown as LocalCollection).color }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-primary dark:text-primary-dark truncate">
                      {(currentCollection as unknown as LocalCollection).name}
                    </div>
                    {(currentCollection as unknown as LocalCollection).description && (
                      <div className="text-xs text-text-secondary dark:text-text-secondary-dark truncate">
                        {(currentCollection as unknown as LocalCollection).description}
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  intent="error"
                  size="xs"
                  onClick={handleRemoveFromCollection}
                  disabled={assignmentLoading}
                  icon={assignmentLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                >
                  Remove
                </Button>
              </div>
            ) : collections && collections.length > 0 ? (
              <div className="relative">
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth
                  onClick={() => setShowCollectionDropdown(!showCollectionDropdown)}
                  disabled={assignmentLoading}
                  className="justify-between"
                  icon={<Plus className="w-4 h-4" />}
                >
                  Add to Collection
                  <ChevronDown
                    className={`w-4 h-4 transition-transform duration-200 ${
                      showCollectionDropdown ? 'rotate-180' : ''
                    }`}
                  />
                </Button>

                {showCollectionDropdown && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-surface-raised dark:bg-surface-dark-raised border border-border dark:border-border-dark rounded-md shadow-lg max-h-60 overflow-y-auto">
                    <div className="py-1">
                      {collections.map((collection) => {
                        const c = collection as unknown as LocalCollection;
                        return (
                        <button
                          type="button"
                          key={c.collectionId}
                          onClick={() => {
                            handleAssignToCollection(c.collectionId);
                            setShowCollectionDropdown(false);
                          }}
                          disabled={assignmentLoading}
                          className="w-full px-4 py-2 text-left text-sm hover:bg-surface dark:hover:bg-surface-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3"
                        >
                          {c.color && (
                            <div
                              className="w-3 h-3 rounded-full flex-shrink-0 border border-border dark:border-border-dark"
                              style={{ backgroundColor: c.color }}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-text-primary dark:text-text-primary-dark truncate">
                              {c.name}
                            </div>
                            {c.description && (
                              <div className="text-xs text-text-secondary dark:text-text-secondary-dark truncate">
                                {c.description}
                              </div>
                            )}
                          </div>
                          {assignmentLoading && (
                            <RefreshCw className="w-4 h-4 animate-spin text-primary dark:text-primary-dark flex-shrink-0" />
                          )}
                        </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center py-3 px-4 bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded text-center">
                <div className="text-sm text-text-muted dark:text-text-muted-dark">
                  <Info className="w-4 h-4 mx-auto mb-1 opacity-60" />
                  No collections available
                </div>
              </div>
            )}

            {showCollectionDropdown && (
              <div
                role="button"
                tabIndex={0}
                aria-label="Close collection dropdown"
                className="fixed inset-0 z-40"
                onClick={() => setShowCollectionDropdown(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setShowCollectionDropdown(false);
                  }
                }}
              />
            )}
          </div>
          )}
        </div>
        )}

        {/* Info Section */}
        {showInfoSection && (
        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-[10px] text-blue-700 dark:text-blue-300 space-y-1">
          <p className="flex items-center gap-1">
            <Info className="w-3 h-3 flex-shrink-0" />
            <strong>About Continue on Fail:</strong>
          </p>
          <ul className="list-disc list-inside space-y-0.5 pl-1">
            <li>When <strong>disabled (default)</strong>: Stops workflow at first failed API call</li>
            <li>When <strong>enabled</strong>: Continues to next API even if current one fails</li>
            <li>Useful for testing error scenarios or conditional workflows</li>
          </ul>
        </div>
        )}

        {!hasSearchMatches && (
          <div className="text-center py-4 text-text-muted dark:text-text-muted-dark text-xs border border-dashed border-border dark:border-border-dark rounded">
            No matching settings
          </div>
        )}
      </div>
    </div>
  );
}

export default WorkflowSettingsPanel;
