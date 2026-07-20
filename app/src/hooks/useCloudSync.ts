import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiweave,
  IpcError,
  onCloudStatusChanged,
} from "../utils/apiweaveClient";
import type { CloudSyncStatus } from "../types/cloud";
import type { UseCloudSync } from "../types/UseCloudSync";

/**
 * Single typed entry point the account menu and Cloud Sync page share. Fetches
 * `cloud.status` on mount, refetches whenever main emits the token-free
 * cloud-status-changed signal, and wraps every mutating action so its returned
 * status is applied immediately (and stale async results are ignored).
 */
export function useCloudSync(): UseCloudSync {
  const [status, setStatus] = useState<CloudSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  // Monotonic token so a slow refresh cannot clobber a newer result.
  const seqRef = useRef(0);
  const mountedRef = useRef(true);

  const apply = useCallback((next: CloudSyncStatus) => {
    const token = ++seqRef.current;
    // Actions return the freshest status synchronously with their resolve, so
    // stamp it as the newest and store it.
    if (mountedRef.current && token === seqRef.current) {
      setStatus(next);
    }
    return next;
  }, []);

  const refresh = useCallback(async () => {
    const token = ++seqRef.current;
    try {
      const next = await apiweave.cloud.status();
      if (mountedRef.current && token === seqRef.current) {
        setStatus(next);
        setUnavailable(false);
      }
    } catch (error) {
      // A missing bridge (web preview) surfaces as an IpcError; treat as
      // unavailable rather than an error toast.
      if (
        error instanceof IpcError &&
        (error.code === "denied" || error.code === "not_found")
      ) {
        if (mountedRef.current && token === seqRef.current) {
          setUnavailable(true);
          setStatus(null);
        }
        return;
      }
      throw error;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const unsubscribe = onCloudStatusChanged(() => {
      void refresh();
    });
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [refresh]);

  // Wrap an action so it flips `busy`, applies its returned status, and always
  // re-syncs from the source of truth afterward.
  const run = useCallback(
    async (
      action: () => Promise<CloudSyncStatus>,
    ): Promise<CloudSyncStatus> => {
      setBusy(true);
      try {
        return apply(await action());
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [apply],
  );

  return {
    status,
    loading,
    unavailable,
    busy,
    refresh,
    link: (deviceLabel) => run(() => apiweave.cloud.link(deviceLabel)),
    cancelLink: () => run(() => apiweave.cloud.cancelLink()),
    unlink: (localOnly) => run(() => apiweave.cloud.unlink(localOnly)),
    bindWorkspace: (input) => run(() => apiweave.cloud.bindWorkspace(input)),
    unbindWorkspace: (workspaceId) =>
      run(() => apiweave.cloud.unbindWorkspace(workspaceId)),
    initializeWorkspace: (workspaceId) =>
      run(() => apiweave.cloud.initializeWorkspace(workspaceId)),
    refreshWorkspaceCatalog: () =>
      run(() => apiweave.cloud.refreshWorkspaceCatalog()),
    retryDeadLetters: (workspaceId) =>
      run(() => apiweave.cloud.retryDeadLetters(workspaceId)),
    discardDeadLetters: (workspaceId) =>
      run(() => apiweave.cloud.discardDeadLetters(workspaceId)),
    pull: () => run(() => apiweave.cloud.pull()),
    push: () => run(() => apiweave.cloud.push()),
  };
}
