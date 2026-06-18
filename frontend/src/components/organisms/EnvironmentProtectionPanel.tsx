import { useState, useEffect } from 'react';
import { ShieldOff, Save } from 'lucide-react';
import { Button } from '../atoms/Button';
import { Toggle } from '../atoms/Toggle';
import { Card } from '../molecules/Card';
import { FormField } from '../molecules/FormField';
import { ReviewerSelector } from './ReviewerSelector';
import type {
  EnvironmentProtectionPanelProps,
  ProtectionFormState,
} from '../../types';

const DEFAULT_STATE: ProtectionFormState = {
  requiredReviewers: [],
  allowSelfApproval: false,
  bypassPolicy: 'none',
  bypassAllowlist: [],
};

export function EnvironmentProtectionPanel({
  protection,
  reviewerOptions,
  onSave,
  onRemove,
  saving = false,
  className = '',
}: EnvironmentProtectionPanelProps) {
  const [form, setForm] = useState<ProtectionFormState>(DEFAULT_STATE);

  useEffect(() => {
    if (protection) {
      setForm({
        requiredReviewers: protection.requiredReviewers,
        allowSelfApproval: protection.allowSelfApproval,
        bypassPolicy: protection.bypassPolicy,
        bypassAllowlist: protection.bypassAllowlist,
      });
    } else {
      setForm(DEFAULT_STATE);
    }
  }, [protection]);

  function update<K extends keyof ProtectionFormState>(key: K, value: ProtectionFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    await onSave(form);
  }

  const isProtected = protection !== null;
  const hasChanges =
    isProtected &&
    (JSON.stringify(form.requiredReviewers) !== JSON.stringify(protection?.requiredReviewers) ||
      form.allowSelfApproval !== protection?.allowSelfApproval ||
      form.bypassPolicy !== protection?.bypassPolicy ||
      JSON.stringify(form.bypassAllowlist) !== JSON.stringify(protection?.bypassAllowlist));

  return (
    <div className={`space-y-4 ${className}`}>
      <Card
        title="Environment Protection"
        headerActions={
          isProtected ? (
            <Button
              variant="ghost"
              intent="error"
              size="xs"
              icon={<ShieldOff className="w-3.5 h-3.5" />}
              onClick={onRemove}
              disabled={saving}
            >
              Remove Protection
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-5">
          {/* Required Reviewers */}
          <ReviewerSelector
            value={form.requiredReviewers}
            onChange={(ids) => update('requiredReviewers', ids)}
            options={reviewerOptions}
            label="Required Reviewers"
          />

          {/* Self-Approval */}
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
                Allow Self-Approval
              </p>
              <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
                Let the person who triggered the run also approve it
              </p>
            </div>
            <Toggle
              checked={form.allowSelfApproval}
              onChange={(e) => update('allowSelfApproval', e.target.checked)}
              variant="primary"
            />
          </div>

          {/* Bypass Policy */}
          <FormField
            label="Bypass Policy"
            hint="Allow trusted service tokens to bypass the approval requirement"
          >
            <select
              value={form.bypassPolicy}
              onChange={(e) =>
                update('bypassPolicy', e.target.value as ProtectionFormState['bypassPolicy'])
              }
              className="select select-bordered w-full rounded bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark text-sm focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
            >
              <option value="none">None — approval always required</option>
              <option value="trusted_token_only">Trusted Token Only — service tokens can bypass</option>
            </select>
          </FormField>

          {/* Bypass Allowlist */}
          {form.bypassPolicy === 'trusted_token_only' && (
            <FormField
              label="Bypass Allowlist"
              hint="Service token IDs allowed to bypass protection"
            >
              <div className="space-y-1.5">
                {form.bypassAllowlist.length === 0 && (
                  <p className="text-xs text-text-muted dark:text-text-muted-dark py-1">
                    No tokens in allowlist. Add service token IDs below.
                  </p>
                )}
                {form.bypassAllowlist.map((tokenId, idx) => (
                  <div key={tokenId} className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono px-2 py-1 rounded bg-surface-overlay dark:bg-surface-dark-overlay text-text-primary dark:text-text-primary-dark border border-border dark:border-border-dark">
                      {tokenId}
                    </code>
                    <Button
                      variant="ghost"
                      intent="error"
                      size="xs"
                      onClick={() =>
                        update(
                          'bypassAllowlist',
                          form.bypassAllowlist.filter((_, i) => i !== idx),
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <BypassTokenInput
                  onAdd={(tokenId) =>
                    update('bypassAllowlist', [...form.bypassAllowlist, tokenId])
                  }
                />
              </div>
            </FormField>
          )}
        </div>
      </Card>

      {/* Save */}
      <div className="flex justify-end">
        <Button
          variant="primary"
          intent="success"
          icon={<Save className="w-4 h-4" />}
          loading={saving}
          onClick={handleSave}
          disabled={!hasChanges && isProtected}
        >
          {isProtected ? 'Update Protection' : 'Enable Protection'}
        </Button>
      </div>
    </div>
  );
}

/** Small inline input to add a token ID to the bypass allowlist. */
function BypassTokenInput({ onAdd }: { onAdd: (tokenId: string) => void }) {
  const [value, setValue] = useState('');

  function handleAdd() {
    const trimmed = value.trim();
    if (trimmed) {
      onAdd(trimmed);
      setValue('');
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleAdd();
          }
        }}
        placeholder="Enter service token ID"
        className="flex-1 input input-bordered input-sm rounded bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark text-xs font-mono focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)]"
      />
      <Button variant="outline" size="xs" onClick={handleAdd} disabled={!value.trim()}>
        Add
      </Button>
    </div>
  );
}
