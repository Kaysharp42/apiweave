import { useReducer } from 'react';
import { useWorkflow } from '../contexts/WorkflowContext';
import { GitMerge, Pencil, Search, Trash2 } from 'lucide-react';
import { Button } from './atoms/Button';
import { IconButton } from './atoms/IconButton';

export default function VariablesPanel() {
  const { variables, updateVariable, deleteVariablesWithCleanup } = useWorkflow();

  type VariablesPanelState = {
    showForm: boolean;
    newVarName: string;
    newVarValue: string;
    editingVar: string | null;
    editValue: string;
    searchTerm: string;
  };

  type VariablesPanelAction =
    | { type: 'toggle-form' }
    | { type: 'set-new-var-name'; value: string }
    | { type: 'set-new-var-value'; value: string }
    | { type: 'start-edit'; varName: string; value: string }
    | { type: 'set-edit-value'; value: string }
    | { type: 'clear-edit' }
    | { type: 'set-search-term'; value: string }
    | { type: 'reset-add-form' };

  const initialState: VariablesPanelState = {
    showForm: false,
    newVarName: '',
    newVarValue: '',
    editingVar: null,
    editValue: '',
    searchTerm: '',
  };

  const [state, dispatch] = useReducer((current: VariablesPanelState, action: VariablesPanelAction): VariablesPanelState => {
    switch (action.type) {
      case 'toggle-form':
        return { ...current, showForm: !current.showForm };
      case 'set-new-var-name':
        return { ...current, newVarName: action.value };
      case 'set-new-var-value':
        return { ...current, newVarValue: action.value };
      case 'start-edit':
        return { ...current, editingVar: action.varName, editValue: action.value };
      case 'set-edit-value':
        return { ...current, editValue: action.value };
      case 'clear-edit':
        return { ...current, editingVar: null, editValue: '' };
      case 'set-search-term':
        return { ...current, searchTerm: action.value };
      case 'reset-add-form':
        return { ...current, showForm: false, newVarName: '', newVarValue: '' };
      default:
        return current;
    }
  }, initialState);

  const normalizedQuery = state.searchTerm.trim().toLowerCase();
  const filteredVariables = Object.entries(variables ?? {}).filter(([varName, varValue]) => {
    if (!normalizedQuery) return true;

    const valueText = typeof varValue === 'string' ? varValue : JSON.stringify(varValue);
    const usageHint = `{{variables.${varName}}}`;

    return (
      varName.toLowerCase().includes(normalizedQuery)
      || valueText.toLowerCase().includes(normalizedQuery)
      || usageHint.toLowerCase().includes(normalizedQuery)
    );
  });

  const handleAdd = () => {
    if (state.newVarName.trim()) {
      updateVariable(state.newVarName.trim(), state.newVarValue);
      dispatch({ type: 'reset-add-form' });
    }
  };

  const handleDelete = (varName: string) => {
    deleteVariablesWithCleanup([varName]);
  };

  const handleEdit = (varName: string, value: string) => {
    updateVariable(varName, value);
    dispatch({ type: 'clear-edit' });
  };

  return (
    <div className="w-full min-w-0 bg-white dark:bg-gray-800 h-full flex flex-col">
      <div className="sticky top-0 bg-slate-50 dark:bg-gray-900 border-b dark:border-gray-700 p-3 z-10">
        <div className="relative mb-2">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              value={state.searchTerm}
              onChange={(event) => dispatch({ type: 'set-search-term', value: event.target.value })}
            placeholder="Search variables"
            className="w-full pl-8 pr-2 py-1.5 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark dark:placeholder-gray-400 rounded text-xs focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label="Search variables"
          />
        </div>

        <Button
          onClick={() => dispatch({ type: 'toggle-form' })}
          size="xs"
          fullWidth
        >
          + Add Variable
        </Button>
      </div>

      <div className="p-3 space-y-2 flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
        {state.showForm && (
          <div className="p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded space-y-2">
            <input
              type="text"
              placeholder="Variable name"
              aria-label="Variable name"
              className="w-full px-2 py-1 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark dark:placeholder-gray-400 rounded text-xs focus:outline-none focus:ring-2 focus:ring-primary"
              value={state.newVarName}
              onChange={(e) => dispatch({ type: 'set-new-var-name', value: e.target.value })}
            />
            <textarea
              placeholder="Value (can be JSON, text, etc.)"
              aria-label="Variable value"
              className="w-full px-2 py-1 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark dark:placeholder-gray-400 rounded text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3}
              value={state.newVarValue}
              onChange={(e) => dispatch({ type: 'set-new-var-value', value: e.target.value })}
            />
            <div className="flex gap-2">
              <Button
                onClick={handleAdd}
                size="xs"
                intent="success"
                fullWidth
              >
                Save
              </Button>
                <Button
                  onClick={() => {
                    dispatch({ type: 'reset-add-form' });
                  }}
                variant="ghost"
                size="xs"
                fullWidth
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {variables && Object.keys(variables).length > 0 ? (
          <div className="space-y-2">
            {filteredVariables.map(([varName, varValue]) => (
              <div
                key={varName}
                className="min-w-0 overflow-hidden p-2 bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded space-y-1"
              >
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <code
                    className="block min-w-0 flex-1 truncate text-xs font-semibold text-status-success dark:text-status-success bg-status-success/10 dark:bg-status-success/20 px-2 py-1 rounded"
                    title={varName}
                  >
                    {varName}
                  </code>
                  <IconButton
                      onClick={() => dispatch({ type: 'start-edit', varName, value: typeof varValue === 'string' ? varValue : JSON.stringify(varValue) })}
                    variant="primary"
                    size="xs"
                    tooltip="Edit variable"
                    className="flex-shrink-0"
                  >
                    <Pencil className="w-3 h-3" />
                  </IconButton>
                  <IconButton
                    onClick={() => handleDelete(varName)}
                    variant="error"
                    size="xs"
                    tooltip="Delete variable"
                    className="flex-shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </IconButton>
                </div>

                {state.editingVar === varName ? (
                  <div className="space-y-1">
                    <textarea
                      aria-label={`Variable ${varName} value`}
                      className="w-full px-2 py-1 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark rounded text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                      rows={3}
                      value={state.editValue}
                      onChange={(e) => dispatch({ type: 'set-edit-value', value: e.target.value })}
                    />
                    <div className="flex gap-1">
                      <Button
                        onClick={() => handleEdit(varName, state.editValue)}
                        size="xs"
                        intent="success"
                        fullWidth
                      >
                        Save
                      </Button>
                      <Button
                        onClick={() => dispatch({ type: 'clear-edit' })}
                        variant="ghost"
                        size="xs"
                        fullWidth
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="min-w-0 max-h-20 overflow-y-auto overflow-x-hidden text-xs text-text-secondary dark:text-text-primary-dark font-mono">
                    {typeof varValue === 'string' ? (
                      <pre className="whitespace-pre-wrap break-all">{varValue}</pre>
                    ) : (
                      <pre className="whitespace-pre-wrap break-all">{JSON.stringify(varValue, null, 2)}</pre>
                    )}
                  </div>
                )}

                <div className="min-w-0 break-all text-[9px] text-text-muted dark:text-text-muted-dark">
                  Use in workflow: <code className="bg-surface dark:bg-surface-dark-raised px-1 rounded break-all">{`{{variables.${varName}}}`}</code>
                </div>
              </div>
            ))}

            {filteredVariables.length === 0 && (
              <div className="text-center py-4 text-text-muted dark:text-text-muted-dark text-sm border border-dashed border-border dark:border-border-dark rounded">
                <p>No matching variables</p>
                <p className="text-xs mt-1">Try a different search term</p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-4 text-text-muted dark:text-text-muted-dark text-sm">
            <p>No workflow variables yet</p>
            <p className="text-xs mt-1">Create variables to share data between nodes</p>
          </div>
        )}
      </div>

      <div className="min-w-0 overflow-hidden border-t dark:border-gray-700 p-3 text-[10px] text-text-muted dark:text-text-muted-dark bg-surface dark:bg-surface-dark/50 space-y-1">
        <div><strong>Tips:</strong></div>
        <ul className="list-disc list-inside space-y-0.5 pl-1">
          <li>Extract values from API responses using &quot;Store Response Fields&quot;</li>
          <li>Reference variables anywhere: <code className="bg-surface dark:bg-surface-dark-raised px-1 break-all">{`{{variables.name}}`}</code></li>
          <li>Variables persist throughout workflow execution</li>
          <li>Great for storing tokens, IDs, and authentication data</li>
        </ul>

        <div className="mt-2 pt-2 border-t border-border dark:border-border-dark flex items-center gap-2"><GitMerge className="w-4 h-4" /><strong>Parallel Branches:</strong></div>
        <ul className="list-disc list-inside space-y-0.5 pl-1">
          <li>Access specific branches: <code className="bg-surface dark:bg-surface-dark-raised px-1 break-all">{`{{prev[0].response}}`}</code></li>
          <li>Branch indexes shown on Merge node after execution</li>
          <li>Example: <code className="bg-surface dark:bg-surface-dark-raised px-1 break-all">{`{{prev[1].response.body.id}}`}</code></li>
          <li>Single predecessor: <code className="bg-surface dark:bg-surface-dark-raised px-1 break-all">{`{{prev.response}}`}</code></li>
        </ul>
      </div>
    </div>
  );
}
