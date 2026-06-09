import { useState, type ChangeEvent } from 'react';
import { Info, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';
import { PanelTabs } from '../molecules/PanelTabs';
import AssertionEditor from '../AssertionEditor';
import type { AssertionConfigPanelProps } from '../../types/AssertionConfigPanelProps';

interface AssertionItem {
  source: string;
  path: string;
  operator: string;
  expectedValue: string;
}

interface AssertionFormModalInternalProps {
  onAdd: (assertion: AssertionItem) => void;
}

function AssertionFormModal({ onAdd }: AssertionFormModalInternalProps) {
  const [source, setSource] = useState('prev');
  const [path, setPath] = useState('');
  const [operator, setOperator] = useState('equals');
  const [expectedValue, setExpectedValue] = useState('');
  const [errors, setErrors] = useState({ path: '', expectedValue: '' });

  const handleAdd = () => {
    if (source === 'status') {
      onAdd({
        source: source.trim(),
        path: '',
        operator,
        expectedValue: expectedValue.trim(),
      });
    } else if (['exists', 'notExists'].includes(operator)) {
      if (path.trim()) {
        onAdd({
          source: source.trim(),
          path: path.trim(),
          operator,
          expectedValue: '',
        });
        setErrors({ path: '', expectedValue: '' });
      } else {
        setErrors({ path: 'Path is required', expectedValue: '' });
        return;
      }
    } else if (operator === 'count') {
      if (path.trim() && expectedValue.trim()) {
        onAdd({
          source: source.trim(),
          path: path.trim(),
          operator: 'count',
          expectedValue: expectedValue.trim(),
        });
        setErrors({ path: '', expectedValue: '' });
      } else {
        setErrors({ path: path.trim() ? '' : 'Path is required', expectedValue: expectedValue.trim() ? '' : 'Expected count is required' });
        return;
      }
    } else {
      if (path.trim() && expectedValue.trim()) {
        onAdd({
          source: source.trim(),
          path: path.trim(),
          operator,
          expectedValue: expectedValue.trim(),
        });
        setErrors({ path: '', expectedValue: '' });
      } else {
        setErrors({ path: path.trim() ? '' : 'Path is required', expectedValue: expectedValue.trim() ? '' : 'Expected value is required' });
        return;
      }
    }

    setPath('');
    setExpectedValue('');
    setSource('prev');
    setOperator('equals');
  };

  return (
    <div className="space-y-3 p-4 bg-[var(--aw-status-success)]/5 border border-[var(--aw-status-success)]/20 dark:border-[var(--aw-status-success)]/30 rounded-lg">
      <div>
        <label htmlFor="assertion-source" className="block text-xs font-semibold text-text-secondary dark:text-text-secondary-dark mb-1.5">
          Assert On
        </label>
        <select
          id="assertion-source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="w-full px-3 py-2 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark rounded text-sm focus:outline-none focus:ring-2 focus:ring-[var(--aw-primary)] cursor-pointer"
        >
          <option value="prev">Previous Node Result (prev.*)</option>
          <option value="variables">Workflow Variables (variables.*)</option>
          <option value="status">HTTP Status Code</option>
          <option value="cookies">Cookies</option>
          <option value="headers">Response Headers</option>
        </select>
      </div>

      {source !== 'status' && (
        <div>
          <label htmlFor="assertion-path" className="block text-xs font-semibold text-text-secondary dark:text-text-secondary-dark mb-1.5">
            {source === 'prev' ? 'JSONPath (e.g., body.status)' :
             source === 'variables' ? 'Variable name' :
             source === 'cookies' ? 'Cookie name' : 'Header name'}
          </label>
          <div>
            <Input
              id="assertion-path"
              type="text"
              placeholder={source === 'prev' ? 'body.status' : source === 'variables' ? 'tokenId' : 'Set-Cookie'}
              value={path}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setPath(e.target.value); setErrors({ ...errors, path: '' }); }}
              {...(errors.path ? { error: errors.path } : {})}
            />
          </div>
        </div>
      )}

      <div>
        <label htmlFor="assertion-operator" className="block text-xs font-semibold text-text-secondary dark:text-text-secondary-dark mb-1.5">
          Operator
        </label>
        <select
          id="assertion-operator"
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
          className="w-full px-3 py-2 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark rounded text-sm focus:outline-none focus:ring-2 focus:ring-[var(--aw-primary)] cursor-pointer"
        >
          <option value="equals">Equals (==)</option>
          <option value="notEquals">Not Equals (!=)</option>
          <option value="contains">Contains</option>
          <option value="notContains">Does Not Contain</option>
          <option value="gt">Greater Than (&gt;)</option>
          <option value="gte">Greater Than or Equal (&gt;=)</option>
          <option value="lt">Less Than (&lt;)</option>
          <option value="lte">Less Than or Equal (&lt;=)</option>
          <option value="count">Count (array length)</option>
          <option value="exists">Exists</option>
          <option value="notExists">Does Not Exist</option>
        </select>
      </div>

      {!['exists', 'notExists'].includes(operator) && (
        <div>
          <label htmlFor="assertion-expected-value" className="block text-xs font-semibold text-text-secondary dark:text-text-secondary-dark mb-1.5">
            {operator === 'count' ? 'Expected Count' : 'Expected Value'}
          </label>
          <div>
            <Input
              id="assertion-expected-value"
              type="text"
              placeholder={operator === 'count' ? '5' : '200'}
              value={expectedValue}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { setExpectedValue(e.target.value); setErrors({ ...errors, expectedValue: '' }); }}
              {...(errors.expectedValue ? { error: errors.expectedValue } : {})}
              className="font-mono"
            />
          </div>
        </div>
      )}

      <Button onClick={handleAdd} variant="primary" intent="success" size="sm" fullWidth className="cursor-pointer">
        Add Assertion
      </Button>
    </div>
  );
}

export function AssertionConfigPanel({ initialConfig, workingDataRef }: AssertionConfigPanelProps) {
  const [activeTab, setActiveTab] = useState('parameters');
  const [assertions, setAssertions] = useState<AssertionItem[]>(initialConfig.assertions || []);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [editDraft, setEditDraft] = useState<AssertionItem | null>(null);

  const handleAddAssertion = (assertion: AssertionItem) => {
    const updated = [...assertions, assertion];
    setAssertions(updated);

    if (workingDataRef) {
      workingDataRef.current = {
        ...workingDataRef.current,
        config: {
          ...(workingDataRef.current.config as Record<string, unknown>),
          assertions: updated,
        },
      };
    }
  };

  const handleDeleteAssertion = (index: number) => {
    const updated = assertions.filter((_, i) => i !== index);
    setAssertions(updated);

    if (workingDataRef) {
      workingDataRef.current = {
        ...workingDataRef.current,
        config: {
          ...(workingDataRef.current.config as Record<string, unknown>),
          assertions: updated,
        },
      };
    }
  };

  return (
    <div className="flex flex-col h-full">
      <PanelTabs
        tabs={[
          { key: 'parameters', label: 'Assertions' },
          { key: 'settings', label: 'Settings' },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'parameters' && (
          <div className="space-y-4">
            <div className="p-3 bg-[var(--aw-status-info)]/5 border border-[var(--aw-status-info)]/20 dark:border-[var(--aw-status-info)]/30 rounded-lg text-sm text-[var(--aw-status-info)]">
              <p className="font-medium mb-1 flex items-center gap-2">
                <Info className="w-4 h-4" />
                <span>Assertion Configuration</span>
              </p>
              <p className="text-xs">
                Assertions configured: <span className="font-bold">{assertions.length}</span>
              </p>
              <p className="text-xs mt-2">
                If ANY assertion fails, the workflow will fail at this node.
              </p>
            </div>

            <AssertionFormModal onAdd={handleAddAssertion} />

            {assertions.length > 0 ? (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-text-secondary dark:text-text-secondary-dark">
                  Current Assertions ({assertions.length})
                </h4>
                {assertions.map((assertion, index) => (
                  <div
                    key={`${assertion.source}-${assertion.path}-${assertion.operator}-${assertion.expectedValue}`}
                    className="p-3 bg-surface-overlay dark:bg-surface-dark-overlay border border-border dark:border-border-dark rounded-lg space-y-2"
                  >
                    {editingIndex === index ? (
                      <AssertionEditor
                        value={editDraft as AssertionItem}
                        onChange={(next) => setEditDraft(next as AssertionItem)}
                        onCancel={() => {
                          setEditingIndex(-1);
                          setEditDraft(null);
                        }}
                        onSave={() => {
                          const updatedAssertion = { ...editDraft } as AssertionItem;
                          const updated = assertions.map((a, i) => (i === index ? updatedAssertion : a));
                          setAssertions(updated);
                          if (workingDataRef) {
                            workingDataRef.current = {
                              ...workingDataRef.current,
                              config: {
                                ...(workingDataRef.current.config as Record<string, unknown>),
                                assertions: updated,
                              },
                            };
                          }
                          setEditingIndex(-1);
                          setEditDraft(null);
                        }}
                      />
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 text-sm min-w-0">
                          <div className="text-[var(--aw-status-success)] font-semibold font-mono">
                            {assertion.source === 'prev' ? '{{prev.' :
                             assertion.source === 'variables' ? '{{variables.' :
                             assertion.source === 'status' ? 'status' :
                             assertion.source === 'cookies' ? 'Cookie: ' :
                             'Header: '}
                            {assertion.source !== 'status' && assertion.path}
                            {(assertion.source === 'prev' || assertion.source === 'variables') && '}}'}
                          </div>
                          <div className="text-text-secondary dark:text-text-secondary-dark mt-1 text-xs">
                            <span className="font-medium">{assertion.operator}</span>
                            {assertion.expectedValue && (
                              <>
                                {' '}<code className="bg-surface dark:bg-surface-dark-raised px-1.5 py-0.5 rounded">{assertion.expectedValue}</code>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 min-w-[92px]">
                          <Button
                            onClick={() => {
                              setEditingIndex(index);
                              setEditDraft({ ...assertion });
                            }}
                            variant="primary"
                            intent="warning"
                            size="xs"
                            className="!justify-start cursor-pointer"
                            title="Edit assertion"
                          >
                            <Pencil className="w-3.5 h-3.5" /> Edit
                          </Button>
                          <Button
                            onClick={() => handleDeleteAssertion(index)}
                            variant="primary"
                            intent="error"
                            size="xs"
                            className="!justify-start cursor-pointer"
                            title="Delete assertion"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-text-muted dark:text-text-muted-dark italic text-center py-6 border-2 border-dashed border-border dark:border-border-dark rounded-lg">
                No assertions yet. Add one above to get started.
              </div>
            )}

            <div className="text-xs text-text-muted dark:text-text-muted-dark space-y-1 p-3 bg-surface-overlay dark:bg-surface-dark-overlay rounded-lg border border-border dark:border-border-dark">
              <p><strong>Tips:</strong></p>
              <ul className="list-disc list-inside space-y-0.5 ml-2">
                <li>Use <code className="bg-surface dark:bg-surface-dark-raised px-1">prev.*</code> to reference the previous node&apos;s response</li>
                <li>Use <code className="bg-surface dark:bg-surface-dark-raised px-1">variables.*</code> to reference workflow variables</li>
                <li>JSONPath example: <code className="bg-surface dark:bg-surface-dark-raised px-1">body.data[0].id</code></li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-3">
            <p className="text-sm text-text-muted dark:text-text-muted-dark">
              No additional settings for assertion nodes.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}