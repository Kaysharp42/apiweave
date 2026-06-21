import { Navigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import type { ReactNode } from 'react';

export function AdminRoute({ children }: { children: ReactNode }) {
  const { status, hasPermission, isSingleUser, modeLoaded } = useAuth();

  if (status === 'loading' || !modeLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface dark:bg-surface-dark">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Only redirect to /login in multi-tenant mode. In single-user mode the
  // implicit owner always has users:invite permission, so falling through
  // to the hasPermission check below returns the user to /app, which is
  // what we want.
  if (status === 'unauthenticated' && !isSingleUser) {
    return <Navigate to="/login" replace />;
  }

  // Single-user mode has no multi-tenant admin surface (no orgs, no invites,
  // no approved domains). Send the owner back to the app.
  if (isSingleUser) {
    return <Navigate to="/app" replace />;
  }

  if (!hasPermission('users:invite')) {
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
}
