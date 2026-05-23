import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import WorkflowCanvas from '../components/WorkflowCanvas';
import { Spinner } from '../components/atoms';
import API_BASE_URL from '../utils/api';
import type { WorkflowCanvasWorkflow } from '../components/WorkflowCanvas';

interface Workflow extends WorkflowCanvasWorkflow {
  id: string;
  [key: string]: unknown;
}

const WorkflowEditor = () => {
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWorkflow = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}`);
        if (response.ok) {
          const data = await response.json() as Workflow;
          setWorkflow(data);
        } else {
          toast.error('Workflow not found');
          navigate('/');
        }
      } catch {
        toast.error('Error loading workflow');
        navigate('/');
      } finally {
        setLoading(false);
      }
    };

    if (workflowId) {
      fetchWorkflow();
    }
  }, [workflowId, navigate]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3 bg-surface dark:bg-surface-dark" aria-label="Loading workflow">
        <Spinner size="lg" />
        <span className="text-sm text-text-secondary dark:text-text-secondary-dark">Loading workflow&hellip;</span>
      </div>
    );
  }

  return (
    <div className="h-screen">
      <WorkflowCanvas workflowId={workflowId} workflow={workflow ?? undefined} />
    </div>
  );
};

export default WorkflowEditor;
