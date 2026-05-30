import React, { useReducer, useEffect, useCallback } from 'react';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';
import { FormField } from '../molecules/FormField';
import { authenticatedJson, authenticatedFetch } from '../../utils/authenticatedApi';
import API_BASE_URL from '../../utils/api';
import type { ApprovedDomain } from '../../types';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';

export function ApprovedDomainManager() {
  type ApprovedDomainState = {
    domains: ApprovedDomain[];
    loading: boolean;
    newDomain: string;
    adding: boolean;
    error: string | null;
  };

  type ApprovedDomainAction =
    | { type: 'set-domains'; value: ApprovedDomain[] }
    | { type: 'set-loading'; value: boolean }
    | { type: 'set-new-domain'; value: string }
    | { type: 'set-adding'; value: boolean }
    | { type: 'set-error'; value: string | null }
    | { type: 'reset-form' };

  const [state, dispatch] = useReducer((current: ApprovedDomainState, action: ApprovedDomainAction): ApprovedDomainState => {
    switch (action.type) {
      case 'set-domains':
        return { ...current, domains: action.value };
      case 'set-loading':
        return { ...current, loading: action.value };
      case 'set-new-domain':
        return { ...current, newDomain: action.value };
      case 'set-adding':
        return { ...current, adding: action.value };
      case 'set-error':
        return { ...current, error: action.value };
      case 'reset-form':
        return { ...current, newDomain: '', error: null, adding: false };
      default:
        return current;
    }
  }, { domains: [], loading: true, newDomain: '', adding: false, error: null });

  const fetchDomains = useCallback(async () => {
    try {
      dispatch({ type: 'set-loading', value: true });
      const data = await authenticatedJson<ApprovedDomain[]>(`${API_BASE_URL}/api/auth/domains`);
      dispatch({ type: 'set-domains', value: data });
    } catch {
      toast.error('Failed to load approved domains');
    } finally {
      dispatch({ type: 'set-loading', value: false });
    }
  }, []);

  useEffect(() => {
    void fetchDomains();
  }, [fetchDomains]);

  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    const domainStr = state.newDomain.trim();
    if (!domainStr) {
      dispatch({ type: 'set-error', value: 'Domain is required' });
      return;
    }

    dispatch({ type: 'set-adding', value: true });
    dispatch({ type: 'set-error', value: null });

    try {
      const added = await authenticatedJson<ApprovedDomain>(
        `${API_BASE_URL}/api/auth/domains`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: domainStr }),
        }
      );
      dispatch({ type: 'set-domains', value: [...state.domains, added] });
      dispatch({ type: 'reset-form' });
      toast.success('Domain added successfully');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add domain';
      dispatch({ type: 'set-error', value: msg });
    } finally {
      dispatch({ type: 'set-adding', value: false });
    }
  };

  const handleRemoveDomain = async (domainId: string) => {
    try {
      const res = await authenticatedFetch(`${API_BASE_URL}/api/auth/domains/${domainId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        throw new Error('Failed to delete domain');
      }
      dispatch({ type: 'set-domains', value: state.domains.filter((d) => d.id !== domainId) });
      toast.success('Domain removed');
    } catch {
      toast.error('Failed to remove domain');
    }
  };

  if (state.loading) {
    return (
      <div className="flex items-center justify-center p-8 text-text-muted">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-lg p-5">
        <h3 className="text-sm font-semibold mb-4 text-text-primary dark:text-text-primary-dark">
          Add Approved Domain
        </h3>
          <form onSubmit={handleAddDomain} className="flex items-end gap-3">
            <div className="flex-1">
              <FormField label="Domain Name" {...(state.error ? { error: state.error } : {})}>
                <Input
                  placeholder="example.com"
                  value={state.newDomain}
                  onChange={(e) => dispatch({ type: 'set-new-domain', value: e.target.value })}
                  disabled={state.adding}
                />
            </FormField>
          </div>
          <Button type="submit" loading={state.adding} disabled={!state.newDomain.trim()}>
            Add
          </Button>
        </form>
      </div>

      <div className="bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-lg overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-text-secondary dark:text-text-secondary-dark uppercase bg-surface-raised dark:bg-surface-dark-raised border-b border-border dark:border-border-dark">
            <tr>
              <th className="px-6 py-3">Domain</th>
              <th className="px-6 py-3 w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {state.domains.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-6 py-8 text-center text-text-muted">
                  No approved domains configured
                </td>
              </tr>
            ) : (
              state.domains.map((domain) => (
                <tr
                  key={domain.id}
                  className="border-b border-border dark:border-border-dark last:border-0 hover:bg-surface-raised dark:hover:bg-surface-dark-raised transition-colors"
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
    </div>
  );
}
