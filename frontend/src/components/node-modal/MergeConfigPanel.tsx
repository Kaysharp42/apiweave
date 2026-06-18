import { useState, useRef, type ChangeEvent } from 'react';
import { CheckCircle, AlertTriangle, X } from 'lucide-react';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';
import { FormField } from '../molecules/FormField';
import { PanelTabs } from '../molecules/PanelTabs';
import type { MergeConfigPanelProps } from '../../types/MergeConfigPanelProps';
import type { MergeConditionType } from '../../types/MergeConditionType';

export function MergeConfigPanel({ initialConfig, workingDataRef }: MergeConfigPanelProps) {
  const [activeTab, setActiveTab] = useState('parameters');
  const [currentStrategy, setCurrentStrategy] = useState(initialConfig.mergeStrategy || 'all');
  const [conditions, setConditions] = useState<MergeConditionType[]>(initialConfig.conditions || []);
  const [conditionLogic, setConditionLogic] = useState(initialConfig.conditionLogic || 'OR');

  const strategyRef = useRef(initialConfig.mergeStrategy || 'all');
  const conditionsRef = useRef<MergeConditionType[]>(initialConfig.conditions || []);
  const conditionLogicRef = useRef(initialConfig.conditionLogic || 'OR');

  const updateRef = () => {
    const newConfig = {
      mergeStrategy: strategyRef.current,
      conditions: conditionsRef.current,
      conditionLogic: conditionLogicRef.current,
    };
    if (workingDataRef) {
      workingDataRef.current = { ...workingDataRef.current, config: newConfig };
    }
  };

  const strategyDescriptions: Record<string, string> = {
    all: 'Waits for all incoming branches to complete before continuing (AND logic).',
    any: 'Continues as soon as any branch completes (OR logic).',
    first: 'Uses the first branch that completes and ignores the rest.',
    conditional: 'Merges only branches that match the configured conditions.',
  };

  const addCondition = () => {
    const newConditions: MergeConditionType[] = [
      ...conditionsRef.current,
      { branchIndex: 0, field: 'statusCode', operator: 'equals', value: '200' },
    ];
    conditionsRef.current = newConditions;
    setConditions(newConditions);
    updateRef();
  };

  const removeCondition = (index: number) => {
    const newConditions = conditionsRef.current.filter((_, i) => i !== index);
    conditionsRef.current = newConditions;
    setConditions(newConditions);
    updateRef();
  };

  const updateCondition = (index: number, updates: Partial<MergeConditionType>) => {
    const newConditions = conditionsRef.current.map((cond, i) =>
      i === index ? { ...cond, ...updates } : cond,
    );
    conditionsRef.current = newConditions;
    setConditions(newConditions);
    updateRef();
  };

  return (
    <div className="flex flex-col h-full">
      <PanelTabs
        tabs={[
          { key: 'parameters', label: 'Merge Strategy' },
          ...(currentStrategy === 'conditional' ? [{ key: 'conditions', label: 'Conditions' }] : []),
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'parameters' && (
          <>
            <FormField
              label="Wait Strategy"
              hint={(strategyDescriptions[currentStrategy] || strategyDescriptions.all) as string}
            >
              <select
                value={currentStrategy}
                onChange={(e) => {
                  const newStrategy = e.target.value;
                  strategyRef.current = newStrategy;
                  setCurrentStrategy(newStrategy);
                  updateRef();
                  if (newStrategy === 'conditional') {
                    setActiveTab('conditions');
                  }
                }}
                className="w-full cursor-pointer rounded-sm border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary transition-[border-color,outline] duration-[var(--aw-transition-fast)] focus:border-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark dark:focus:border-primary-light"
              >
                <option value="all">Wait for All (AND)</option>
                <option value="any">Wait for Any (OR)</option>
                <option value="first">First Completes</option>
                <option value="conditional">Conditional Merge</option>
              </select>
            </FormField>

            <div className="mt-6 rounded-sm border border-border bg-surface-overlay p-4 dark:border-border-dark dark:bg-surface-dark-overlay">
              <h4 className="mb-2 text-sm font-semibold text-text-primary dark:text-text-primary-dark">How Merge Works</h4>
              <ul className="text-xs text-text-secondary dark:text-text-secondary-dark space-y-1">
                <li> Multiple edges leading to this node create parallel branches</li>
                <li> Access branch results using: <code className="rounded-sm bg-surface px-1 py-0.5 font-mono dark:bg-surface-dark">{'{{prev[0].response}}'}</code></li>
                <li> Index [0], [1], [2]... corresponds to branch execution order</li>
                <li> Use <code className="rounded-sm bg-surface px-1 py-0.5 font-mono dark:bg-surface-dark">{'{{prev.response}}'}</code> for single predecessor (backward compatible)</li>
                {currentStrategy === 'conditional' && (
                  <li className="mt-2 border-t border-border pt-2 dark:border-border-dark">
                    <strong>Conditional:</strong> Define conditions to filter which branches to merge
                  </li>
                )}
              </ul>
            </div>
          </>
        )}

        {activeTab === 'conditions' && currentStrategy === 'conditional' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-text-secondary dark:text-text-secondary-dark">
                Merge Conditions
              </h3>
              <Button
                onClick={addCondition}
                variant="primary"
                size="xs"
                className="!px-3 cursor-pointer"
              >
                Add Condition
              </Button>
            </div>

            {conditions.length > 1 && (
              <div className="mb-4 rounded-sm border border-border bg-surface-raised p-3 dark:border-border-dark dark:bg-surface-dark-raised">
                <div className="block text-xs font-medium text-text-secondary dark:text-text-secondary-dark mb-2">
                  Evaluation Logic:
                </div>
                <div className="flex gap-3">
                  <label htmlFor="condition-logic-or" className="flex items-center cursor-pointer">
                    <input
                      id="condition-logic-or"
                      type="radio"
                      name="conditionLogic"
                      value="OR"
                      checked={conditionLogic === 'OR'}
                      onChange={(e) => {
                        const newLogic = e.target.value;
                        conditionLogicRef.current = newLogic;
                        setConditionLogic(newLogic);
                        updateRef();
                      }}
                      className="mr-2"
                    />
                    <span className="text-sm text-text-secondary dark:text-text-secondary-dark">
                      <strong>OR</strong> - Match ANY condition
                    </span>
                  </label>
                  <label htmlFor="condition-logic-and" className="flex items-center cursor-pointer">
                    <input
                      id="condition-logic-and"
                      type="radio"
                      name="conditionLogic"
                      value="AND"
                      checked={conditionLogic === 'AND'}
                      onChange={(e) => {
                        const newLogic = e.target.value;
                        conditionLogicRef.current = newLogic;
                        setConditionLogic(newLogic);
                        updateRef();
                      }}
                      className="mr-2"
                    />
                    <span className="text-sm text-text-secondary dark:text-text-secondary-dark">
                      <strong>AND</strong> - Match ALL conditions
                    </span>
                  </label>
                </div>
                <p className="text-xs text-text-muted dark:text-text-muted-dark mt-2 flex items-center gap-1">
                  <CheckCircle className="w-4 h-4 text-[var(--aw-status-success)]" />
                  <span>
                    {conditionLogic === 'OR'
                      ? 'A branch is merged if it matches at least one condition'
                      : 'A branch is merged only if it matches all conditions'}
                  </span>
                </p>
              </div>
            )}

            {conditions.length === 0 ? (
              <div className="rounded-sm border border-dashed border-border py-8 text-center text-sm text-text-muted dark:border-border-dark dark:text-text-muted-dark">
                No conditions defined. Click &quot;Add Condition&quot; to start.
              </div>
            ) : (
              <div className="space-y-3">
                {conditions.map((condition, index) => (
                  <div
                    key={`${condition.branchIndex}-${condition.field}-${condition.operator}-${condition.value}`}
                    className="rounded-sm border border-border bg-surface-raised p-3 dark:border-border-dark dark:bg-surface-dark-raised"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-text-secondary dark:text-text-secondary-dark">
                        Condition {index + 1} {conditions.length > 1 && index < conditions.length - 1 && (
                          <span className="ml-2 text-[var(--aw-branch-edge)] font-bold">
                            {conditionLogic}
                          </span>
                        )}
                      </span>
                      <Button
                        onClick={() => removeCondition(index)}
                        variant="ghost"
                        size="xs"
                        className="!p-1 !min-w-0 text-[var(--aw-status-error)] hover:text-[var(--aw-status-error)]/80 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label htmlFor={`merge-condition-branch-${index}`} className="block text-xs text-text-secondary dark:text-text-secondary-dark mb-1">Branch</label>
                        <Input
                          id={`merge-condition-branch-${index}`}
                          type="number"
                          value={condition.branchIndex}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => updateCondition(index, { branchIndex: parseInt(e.target.value) || 0 })}
                          className="w-full"
                          min="0"
                        />
                      </div>

                      <div>
                        <label htmlFor={`merge-condition-field-${index}`} className="block text-xs text-text-secondary dark:text-text-secondary-dark mb-1">
                          Field
                          <span className="ml-1 text-[10px] text-[var(--aw-branch-edge)]">
                            (supports variables)
                          </span>
                        </label>
                        <Input
                          id={`merge-condition-field-${index}`}
                          type="text"
                          value={condition.field}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => updateCondition(index, { field: e.target.value })}
                          className="w-full font-mono"
                          placeholder="statusCode or {{prev[0].response.body.name}}"
                        />
                        <div className="mt-0.5 text-[9px] text-text-muted dark:text-text-muted-dark">
                          Common: <code>statusCode</code>, <code>response.body</code>, <code>response.headers</code>
                        </div>
                      </div>

                      <div>
                        <label htmlFor={`merge-condition-operator-${index}`} className="block text-xs text-text-secondary dark:text-text-secondary-dark mb-1">Operator</label>
                        <select
                          id={`merge-condition-operator-${index}`}
                          value={condition.operator}
                          onChange={(e) => updateCondition(index, { operator: e.target.value })}
                          className="w-full cursor-pointer rounded-sm border border-border bg-surface-raised px-2 py-1 text-xs text-text-primary focus:border-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark dark:focus:border-primary-light"
                        >
                          <option value="equals">Equals</option>
                          <option value="notEquals">Not Equals</option>
                          <option value="contains">Contains</option>
                          <option value="gt">Greater Than</option>
                          <option value="lt">Less Than</option>
                          <option value="exists">Exists</option>
                        </select>
                      </div>

                      <div>
                        <label htmlFor={`merge-condition-value-${index}`} className="block text-xs text-text-secondary dark:text-text-secondary-dark mb-1">
                          Value
                          <span className="ml-1 text-[10px] text-[var(--aw-branch-edge)]">
                            (supports variables)
                          </span>
                        </label>
                        <Input
                          id={`merge-condition-value-${index}`}
                          type="text"
                          value={condition.value}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => updateCondition(index, { value: e.target.value })}
                          className="w-full font-mono"
                          placeholder="200 or {{prev[0].id}}"
                        />
                      </div>
                    </div>

                    <div className="mt-2 rounded-sm bg-surface-overlay p-1.5 text-[10px] text-text-muted dark:bg-surface-dark-overlay dark:text-text-muted-dark">
                      Examples: <code className="text-[var(--aw-branch-edge)]">200</code>,
                      <code className="ml-1 text-[var(--aw-branch-edge)]">{'{{prev[0].response.body.status}}'}</code>,
                      <code className="ml-1 text-[var(--aw-branch-edge)]">{'{{variables.expectedCode}}'}</code>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 rounded-sm border border-status-info/30 bg-status-info/10 p-3 dark:border-[var(--aw-status-info)]/30 dark:bg-[var(--aw-status-info)]/10">
              <p className="text-xs text-[var(--aw-status-info)] flex items-start gap-2">
                <span><strong>How it works:</strong> {conditionLogic === 'OR'
                  ? 'Each branch is evaluated independently. If a branch matches ANY condition, it passes.'
                  : 'Each branch is evaluated independently. A branch passes ONLY if it matches ALL conditions.'}</span>
              </p>
              <p className="text-xs text-[var(--aw-status-error)] mt-2 font-semibold flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span><strong>Important:</strong> If ANY branch fails its conditions, the entire merge FAILS and the workflow stops (like an assertion).</span>
              </p>
              <p className="text-xs text-[var(--aw-status-info)] mt-2 flex items-start gap-2">
                <span><strong>Variable support:</strong> Use <code className="rounded-sm bg-surface px-1 font-mono dark:bg-surface-dark">{'{{prev[N].path}}'}</code> to reference other branch data or <code className="rounded-sm bg-surface px-1 font-mono dark:bg-surface-dark">{'{{variables.name}}'}</code> for workflow variables.</span>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
