import { useState } from "react";
import { useWorkflow } from "../contexts/WorkflowContext";
import { toast } from "sonner";
import {
  X,
  RefreshCw,
  Plus,
  ChevronDown,
  LayoutGrid,
  Search,
} from "lucide-react";
import { Button } from "./atoms/Button";
import { Spinner } from "./atoms/Spinner";
import { Input } from "./atoms/Input";
import { EmptyState } from "./molecules/EmptyState";
import { apiweave } from "../utils/apiweaveClient";
import { useScopeContext } from "../hooks/useScopeContext";

type BackgroundColor = string;

interface LocalProject {
  collectionId: string;
  projectId?: string;
  name: string;
  description?: string;
  color?: BackgroundColor;
}

export function WorkflowSettingsPanel() {
  const {
    workflowId,
    collections,
    isLoadingCollections,
    refreshCollectionsAndWorkflows,
    currentCollection,
    setCurrentCollectionId,
  } = useWorkflow();
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const { workspaceId } = useScopeContext();
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const normalizedQuery = searchTerm.trim().toLowerCase();
  const matchesSearch = (value: string): boolean =>
    !normalizedQuery || value.toLowerCase().includes(normalizedQuery);

  const collectionsSectionMatch = matchesSearch(
    "projects project assignment add remove",
  );
  const collectionAssignmentItemMatch = matchesSearch(
    "add to project remove from project workflow project assignment",
  );
  const showCollectionsSection =
    collectionsSectionMatch || collectionAssignmentItemMatch;
  const showCollectionsItem =
    collectionsSectionMatch || collectionAssignmentItemMatch;
  const hasSearchMatches = showCollectionsSection;

  const handleAssignToProject = async (projectId: string): Promise<void> => {
    if (!workflowId) {
      toast.error("Workflow ID not found");
      return;
    }
    if (!workspaceId) {
      toast.error("Workspace scope is not ready");
      return;
    }

    const selectedProject = collections.find(
      (project) => (project.projectId ?? project.collectionId) === projectId,
    );
    if (!selectedProject) {
      toast.error("Project not found");
      return;
    }

    setAssignmentLoading(true);
    try {
      await apiweave.projects.addWorkflow(workspaceId, projectId, workflowId);
      setCurrentCollectionId(selectedProject.collectionId);
      toast.success(`Workflow added to "${selectedProject.name}"`);
      refreshCollectionsAndWorkflows?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Failed to add workflow to project: ${message}`);
    } finally {
      setAssignmentLoading(false);
    }
  };

  const handleRemoveFromProject = async (): Promise<void> => {
    if (!workflowId || !currentCollection) {
      toast.error("No project assignment to remove");
      return;
    }
    if (!workspaceId) {
      toast.error("Workspace scope is not ready");
      return;
    }

    setAssignmentLoading(true);
    try {
      await apiweave.projects.removeWorkflow(
        workspaceId,
        currentCollection.collectionId,
        workflowId,
      );
      setCurrentCollectionId(null);
      toast.success(`Workflow removed from "${currentCollection.name}"`);
      refreshCollectionsAndWorkflows?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Failed to remove workflow from project: ${message}`);
    } finally {
      setAssignmentLoading(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-surface-raised dark:bg-surface-dark-raised border-t border-border dark:border-border-dark">
      <div className="p-3 space-y-4 overflow-y-auto overflow-x-hidden flex-1 min-w-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted dark:text-text-muted-dark pointer-events-none" />
          <Input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search settings"
            className="pl-8 py-1.5 text-xs"
            aria-label="Search settings"
          />
        </div>

        {showCollectionsSection && (
          <div className="space-y-2">
            <div className="text-sm font-semibold text-text-primary dark:text-text-primary-dark flex items-center gap-2 min-w-0">
              <LayoutGrid className="w-4 h-4 flex-shrink-0 text-[var(--aw-primary)] dark:text-[var(--aw-primary-light)]" />
              <span className="min-w-0 truncate">Projects</span>
            </div>
            {showCollectionsItem && (
              <div className="relative min-w-0">
                {isLoadingCollections ? (
                  <div className="flex items-center justify-center py-3 px-4 bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded">
                    <Spinner size="sm" />
                    <span className="ml-2 text-sm text-text-secondary dark:text-text-secondary-dark">
                      Loading projects…
                    </span>
                  </div>
                ) : currentCollection ? (
                  <div className="flex items-center justify-between px-4 py-3 text-sm bg-[var(--aw-primary)]/5 dark:bg-[var(--aw-primary)]/10 border border-[var(--aw-primary)]/20 dark:border-[var(--aw-primary)]/30 rounded min-w-0 gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {(currentCollection as unknown as LocalProject).color && (
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0 border border-[var(--aw-primary)]/30 dark:border-[var(--aw-primary)]/50"
                          style={{
                            backgroundColor: (
                              currentCollection as unknown as LocalProject
                            ).color,
                          }}
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-[var(--aw-primary)] dark:text-[var(--aw-primary-light)] truncate">
                          {(currentCollection as unknown as LocalProject).name}
                        </div>
                        {(currentCollection as unknown as LocalProject)
                          .description && (
                          <div className="text-xs text-text-secondary dark:text-text-secondary-dark truncate">
                            {
                              (currentCollection as unknown as LocalProject)
                                .description
                            }
                          </div>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      intent="error"
                      size="xs"
                      onClick={handleRemoveFromProject}
                      disabled={assignmentLoading}
                      icon={
                        assignmentLoading ? (
                          <RefreshCw className="w-3 h-3 animate-spin motion-reduce:animate-none" />
                        ) : (
                          <X className="w-3 h-3" />
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ) : collections && collections.length > 0 ? (
                  <div className="relative min-w-0">
                    <Button
                      variant="outline"
                      size="sm"
                      fullWidth
                      onClick={() =>
                        setShowProjectDropdown(!showProjectDropdown)
                      }
                      disabled={assignmentLoading}
                      className="justify-between"
                      icon={<Plus className="w-4 h-4" />}
                    >
                      <span className="min-w-0 truncate">Add to Project</span>
                      <ChevronDown
                        className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 motion-reduce:transition-none ${
                          showProjectDropdown ? "rotate-180" : ""
                        }`}
                      />
                    </Button>

                    {showProjectDropdown && (
                      <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-surface-raised dark:bg-surface-dark-raised border border-border dark:border-border-dark rounded max-h-60 overflow-y-auto overflow-x-hidden">
                        <div className="py-1">
                          {collections.map((collection) => {
                            const c = collection as unknown as LocalProject;
                            const cId = c.projectId ?? c.collectionId;
                            return (
                              <button
                                type="button"
                                key={cId}
                                onClick={() => {
                                  void handleAssignToProject(cId);
                                  setShowProjectDropdown(false);
                                }}
                                disabled={assignmentLoading}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-surface dark:hover:bg-surface-dark transition-colors motion-reduce:transition-none disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
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
                                  <RefreshCw className="w-4 h-4 animate-spin motion-reduce:animate-none text-[var(--aw-primary)] dark:text-[var(--aw-primary-light)] flex-shrink-0" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <EmptyState
                    title="No projects available"
                    description="Create a project to organize workflows"
                    className="py-4 border border-dashed border-border dark:border-border-dark rounded"
                  />
                )}

                {showProjectDropdown && (
                  <button
                    type="button"
                    aria-label="Close project dropdown"
                    className="fixed inset-0 z-40 cursor-default"
                    onClick={() => setShowProjectDropdown(false)}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {!hasSearchMatches && (
          <EmptyState
            title="No matching settings"
            description="Try a different search term"
            className="py-4 border border-dashed border-border dark:border-border-dark rounded"
          />
        )}
      </div>
    </div>
  );
}

export default WorkflowSettingsPanel;
