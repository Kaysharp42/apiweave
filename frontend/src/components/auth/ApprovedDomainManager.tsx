import React, { useReducer, useEffect, useCallback } from "react";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { Spinner } from "../atoms/Spinner";
import { FormField } from "../molecules/FormField";
import { EmptyState } from "../molecules/EmptyState";
import { Panel } from "../molecules/Panel";
import {
  authenticatedJson,
  authenticatedFetch,
} from "../../utils/authenticatedApi";
import API_BASE_URL from "../../utils/api";
import type { ApprovedDomain } from "../../types";
import { toast } from "sonner";
import { Globe, Trash2 } from "lucide-react";

export function ApprovedDomainManager() {
  type ApprovedDomainState = {
    domains: ApprovedDomain[];
    loading: boolean;
    newDomain: string;
    adding: boolean;
    error: string | null;
  };

  type ApprovedDomainAction =
    | { type: "set-domains"; value: ApprovedDomain[] }
    | { type: "set-loading"; value: boolean }
    | { type: "set-new-domain"; value: string }
    | { type: "set-adding"; value: boolean }
    | { type: "set-error"; value: string | null }
    | { type: "reset-form" };

  const [state, dispatch] = useReducer(
    (
      current: ApprovedDomainState,
      action: ApprovedDomainAction,
    ): ApprovedDomainState => {
      switch (action.type) {
        case "set-domains":
          return { ...current, domains: action.value };
        case "set-loading":
          return { ...current, loading: action.value };
        case "set-new-domain":
          return { ...current, newDomain: action.value };
        case "set-adding":
          return { ...current, adding: action.value };
        case "set-error":
          return { ...current, error: action.value };
        case "reset-form":
          return { ...current, newDomain: "", error: null, adding: false };
        default:
          return current;
      }
    },
    { domains: [], loading: true, newDomain: "", adding: false, error: null },
  );

  const fetchDomains = useCallback(async () => {
    try {
      dispatch({ type: "set-loading", value: true });
      const data = await authenticatedJson<ApprovedDomain[]>(
        `${API_BASE_URL}/api/auth/domains`,
      );
      dispatch({ type: "set-domains", value: data });
    } catch {
      toast.error("Failed to load approved domains");
    } finally {
      dispatch({ type: "set-loading", value: false });
    }
  }, []);

  useEffect(() => {
    void fetchDomains();
  }, [fetchDomains]);

  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    const domainStr = state.newDomain.trim();
    if (!domainStr) {
      dispatch({ type: "set-error", value: "Domain is required" });
      return;
    }

    dispatch({ type: "set-adding", value: true });
    dispatch({ type: "set-error", value: null });

    try {
      const added = await authenticatedJson<ApprovedDomain>(
        `${API_BASE_URL}/api/auth/domains`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: domainStr }),
        },
      );
      dispatch({ type: "set-domains", value: [...state.domains, added] });
      dispatch({ type: "reset-form" });
      toast.success("Domain added successfully");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add domain";
      dispatch({ type: "set-error", value: msg });
    } finally {
      dispatch({ type: "set-adding", value: false });
    }
  };

  const handleRemoveDomain = async (domainId: string) => {
    try {
      const res = await authenticatedFetch(
        `${API_BASE_URL}/api/auth/domains/${domainId}`,
        {
          method: "DELETE",
        },
      );
      if (!res.ok) {
        throw new Error("Failed to delete domain");
      }
      dispatch({
        type: "set-domains",
        value: state.domains.filter((d) => d.id !== domainId),
      });
      toast.success("Domain removed");
    } catch {
      toast.error("Failed to remove domain");
    }
  };

  if (state.loading) {
    return (
      <div className="flex items-center justify-center p-8 text-text-muted">
        <Spinner size="lg" className="text-primary dark:text-primary-light" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Add Approved Domain"
        icon={Globe as React.ComponentType<{ className?: string }>}
      >
        <div className="p-5 border-b border-border dark:border-border-dark">
          <form onSubmit={handleAddDomain} className="flex items-end gap-3">
            <div className="flex-1">
              <FormField
                label="Domain Name"
                {...(state.error ? { error: state.error } : {})}
              >
                <Input
                  placeholder="example.com"
                  value={state.newDomain}
                  onChange={(e) =>
                    dispatch({ type: "set-new-domain", value: e.target.value })
                  }
                  disabled={state.adding}
                />
              </FormField>
            </div>
            <Button
              type="submit"
              loading={state.adding}
              disabled={!state.newDomain.trim()}
            >
              Add
            </Button>
          </form>
        </div>
      </Panel>

      <Panel title="Approved Domains">
        <div className="overflow-hidden">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="text-xs text-text-secondary dark:text-text-secondary-dark uppercase bg-surface-overlay dark:bg-surface-dark-overlay border-b border-border dark:border-border-dark">
              <tr>
                <th className="px-6 py-3">Domain</th>
                <th className="px-6 py-3 w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.domains.length === 0 ? (
                <tr>
                  <td colSpan={2}>
                    <EmptyState
                      title="No approved domains"
                      description="Add a domain above to automatically approve users from that organization."
                    />
                  </td>
                </tr>
              ) : (
                state.domains.map((domain) => (
                  <tr
                    key={domain.id}
                    className="border-b border-border dark:border-border-dark last:border-0 hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors duration-200 motion-reduce:transition-none focus-within:outline-2 focus-within:outline-[var(--aw-primary)] focus-within:outline-offset-[-2px]"
                    tabIndex={0}
                  >
                    <td className="px-6 py-3 font-medium text-text-primary dark:text-text-primary-dark">
                      {domain.domain}
                    </td>
                    <td className="px-6 py-3">
                      <Button
                        size="xs"
                        variant="ghost"
                        intent="error"
                        onClick={() => handleRemoveDomain(domain.id)}
                        icon={<Trash2 className="w-4 h-4" />}
                        aria-label="Remove domain"
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
