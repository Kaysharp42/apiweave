import { useNavigate, useParams } from 'react-router-dom';
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
    <div className="relative flex min-h-[60vh] overflow-hidden bg-surface p-10 dark:bg-surface-dark lg:p-14">
      <svg className="pointer-events-none absolute inset-0 h-full w-full text-border opacity-40 dark:text-border-dark" aria-hidden="true">
        <filter id="not-found-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="table" tableValues="0 0.08" />
          </feComponentTransfer>
        </filter>
        <pattern id="not-found-grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeWidth="1" />
        </pattern>
        <rect width="100%" height="100%" fill="url(#not-found-grid)" />
        <rect width="100%" height="100%" filter="url(#not-found-noise)" />
      </svg>

      <div className="relative z-10 flex max-w-3xl flex-col justify-center gap-6">
        <p className="font-mono text-xs uppercase tracking-[0.32em] text-text-muted dark:text-text-muted-dark">
          Error 404
        </p>
        <h2 className="text-[clamp(3rem,10vw,7rem)] font-extrabold leading-[0.95] tracking-tight text-text-primary dark:text-text-primary-dark">
          Not found
        </h2>
        <p className="max-w-xl text-sm leading-6 text-text-secondary dark:text-text-secondary-dark sm:text-base">
          {contextPath
            ? `The resource at "${contextPath}" does not exist or you do not have permission to access it.`
            : 'The page you are looking for does not exist.'}
        </p>
        <div>
          <Button
            variant="outline"
            intent="default"
            size="sm"
            onClick={() => navigate(contextPath ? `${contextPath}/workflows` : '/')}
          >
            Back to workflows
          </Button>
        </div>
      </div>
    </div>
  );
}

export default NotFoundPage;
