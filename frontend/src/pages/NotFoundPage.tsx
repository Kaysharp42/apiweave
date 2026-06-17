import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Button } from '../components/atoms/Button';

/**
 * NotFoundPage — displayed when a workspace route doesn't match
 * any known resource (unauthorized or non-existent).
 */
export function NotFoundPage() {
  const navigate = useNavigate();
  const { orgSlug, workspaceSlug } = useParams<{
    orgSlug?: string;
    workspaceSlug?: string;
  }>();

  const contextPath = orgSlug && workspaceSlug
    ? `/${orgSlug}/${workspaceSlug}`
    : '';

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-8">
      <AlertTriangle className="w-16 h-16 text-text-muted dark:text-text-muted-dark" strokeWidth={1.5} />
      <h2 className="text-xl font-bold text-text-primary dark:text-text-primary-dark">
        Page not found
      </h2>
      <p className="text-sm text-text-secondary dark:text-text-secondary-dark text-center max-w-md">
        {contextPath
          ? `The resource at "${contextPath}" does not exist or you do not have permission to access it.`
          : 'The page you are looking for does not exist.'}
      </p>
      <div className="flex gap-3">
        <Button
          variant="primary"
          intent="default"
          size="sm"
          onClick={() => navigate(contextPath ? `${contextPath}/workflows` : '/')}
        >
          {contextPath ? 'Go to Workflows' : 'Go Home'}
        </Button>
      </div>
    </div>
  );
}

export default NotFoundPage;
