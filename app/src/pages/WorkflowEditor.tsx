import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import WorkflowCanvas from "../components/WorkflowCanvas";
import { Spinner } from "../components/atoms/Spinner";
import type { WorkflowCanvasWorkflow } from "../types/WorkflowCanvasWorkflow";
import { authenticatedFetch } from "../utils/apiweaveClient";
import { useScopeContext } from "../hooks/useScopeContext";
import { workflowUrl } from "../utils/apiweaveClient";

interface Workflow extends WorkflowCanvasWorkflow {
  id: string;
  name?: string;
  description?: string;
  variables?: Record<string, unknown>[];
  createdAt?: string;
  updatedAt?: string;
  collectionId?: string;
  swaggerUrl?: string;
  swaggerLastRefreshed?: string;
  nodeTemplates?: unknown[];
}

const WorkflowEditor = () => {
  const { workflowId } = useParams<{ workflowId: string }>();
  const { workspaceId, isReady: isScopeReady } = useScopeContext();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const fetchWorkflow = async () => {
      if (!workflowId) {
        setErrorMessage("Workflow not found");
        setLoading(false);
        return;
      }

      if (!workspaceId) {
        setErrorMessage("Select a workspace before opening workflows.");
        toast.error("Select a workspace before opening workflows.");
        setLoading(false);
        return;
      }

      try {
        const response = await authenticatedFetch(
          workflowUrl(workspaceId, workflowId),
        );
        if (response.ok) {
          const data = (await response.json()) as Workflow;
          setWorkflow(data);
        } else {
          toast.error("Workflow not found");
          setErrorMessage("Workflow not found");
        }
      } catch {
        toast.error("Error loading workflow");
        setErrorMessage("Error loading workflow");
      } finally {
        setLoading(false);
      }
    };

    if (isScopeReady) {
      void fetchWorkflow();
    }
  }, [isScopeReady, workflowId, workspaceId]);

  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center h-screen gap-3 bg-surface dark:bg-surface-dark"
        aria-label="Loading workflow"
      >
        <Spinner size="lg" />
        <span className="text-sm text-text-secondary dark:text-text-secondary-dark">
          Loading workflow&hellip;
        </span>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div
        className="flex flex-col items-center justify-center h-screen gap-3 bg-surface dark:bg-surface-dark"
        role="alert"
      >
        <h1 className="text-lg font-semibold text-text-primary dark:text-text-primary-dark">
          Unable to load workflow
        </h1>
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
          {errorMessage}
        </p>
      </div>
    );
  }

  return (
    <div className="h-screen">
      <WorkflowCanvas
        workflowId={workflowId}
        workflow={workflow ?? undefined}
      />
    </div>
  );
};

export default WorkflowEditor;
