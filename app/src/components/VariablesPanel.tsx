import { useReducer } from "react";
import { useWorkflow } from "../contexts/WorkflowContext";
import { GitMerge, Pencil, Search, Trash2 } from "lucide-react";
import { Button } from "./atoms/Button";
import { IconButton } from "./atoms/IconButton";
import { Input } from "./atoms/Input";
import { TextArea } from "./atoms/TextArea";
import { EmptyState } from "./molecules/EmptyState";

export default function VariablesPanel() {
  const { variables, updateVariable, deleteVariablesWithCleanup } =
    useWorkflow();

  type VariablesPanelState = {
    showForm: boolean;
    newVarName: string;
    newVarValue: string;
    editingVar: string | null;
    editValue: string;
    searchTerm: string;
  };

  type VariablesPanelAction =
    | { type: "toggle-form" }
    | { type: "set-new-var-name"; value: string }
    | { type: "set-new-var-value"; value: string }
    | { type: "start-edit"; varName: string; value: string }
    | { type: "set-edit-value"; value: string }
    | { type: "clear-edit" }
    | { type: "set-search-term"; value: string }
    | { type: "reset-add-form" };

  const initialState: VariablesPanelState = {
    showForm: false,
    newVarName: "",
    newVarValue: "",
    editingVar: null,
    editValue: "",
    searchTerm: "",
  };

  const [state, dispatch] = useReducer(
    (
      current: VariablesPanelState,
      action: VariablesPanelAction,
    ): VariablesPanelState => {
      switch (action.type) {
        case "toggle-form":
          return { ...current, showForm: !current.showForm };
        case "set-new-var-name":
          return { ...current, newVarName: action.value };
        case "set-new-var-value":
          return { ...current, newVarValue: action.value };
        case "start-edit":
          return {
            ...current,
            editingVar: action.varName,
            editValue: action.value,
          };
        case "set-edit-value":
          return { ...current, editValue: action.value };
        case "clear-edit":
          return { ...current, editingVar: null, editValue: "" };
        case "set-search-term":
          return { ...current, searchTerm: action.value };
        case "reset-add-form":
          return {
            ...current,
            showForm: false,
            newVarName: "",
            newVarValue: "",
          };
        default:
          return current;
      }
    },
    initialState,
  );

  const normalizedQuery = state.searchTerm.trim().toLowerCase();
  const filteredVariables = Object.entries(variables ?? {}).filter(
    ([varName, varValue]) => {
      if (!normalizedQuery) return true;

      const valueText =
        typeof varValue === "string" ? varValue : JSON.stringify(varValue);
      const usageHint = `{{variables.${varName}}}`;

      return (
        varName.toLowerCase().includes(normalizedQuery) ||
        valueText.toLowerCase().includes(normalizedQuery) ||
        usageHint.toLowerCase().includes(normalizedQuery)
      );
    },
  );

  const handleAdd = () => {
    if (state.newVarName.trim()) {
      updateVariable(state.newVarName.trim(), state.newVarValue);
      dispatch({ type: "reset-add-form" });
    }
  };

  const handleDelete = (varName: string) => {
    deleteVariablesWithCleanup([varName]);
  };

  const handleEdit = (varName: string, value: string) => {
    updateVariable(varName, value);
    dispatch({ type: "clear-edit" });
  };

  return (
    <div className="w-full min-w-0 h-full flex flex-col bg-surface-raised dark:bg-surface-dark-raised">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-surface-overlay dark:bg-surface-dark-overlay border-b border-border dark:border-border-dark p-3 space-y-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted dark:text-text-muted-dark pointer-events-none" />
          <Input
            type="text"
            value={state.searchTerm}
            onChange={(event) =>
              dispatch({ type: "set-search-term", value: event.target.value })
            }
            placeholder="Search variables"
            className="pl-8 py-1.5 text-xs"
            aria-label="Search variables"
          />
        </div>

        <Button
          onClick={() => dispatch({ type: "toggle-form" })}
          size="xs"
          fullWidth
          variant={state.showForm ? "ghost" : "primary"}
        >
          {state.showForm ? "Cancel" : "+ Add Variable"}
        </Button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-3 space-y-2">
        {state.showForm && (
          <div className="p-2 bg-[var(--aw-primary)]/5 dark:bg-[var(--aw-primary)]/10 border border-[var(--aw-primary)]/20 dark:border-[var(--aw-primary)]/30 rounded space-y-2">
            <Input
              type="text"
              placeholder="Variable name"
              aria-label="Variable name"
              className="text-xs"
              value={state.newVarName}
              onChange={(e) =>
                dispatch({ type: "set-new-var-name", value: e.target.value })
              }
            />
            <TextArea
              placeholder="Value (can be JSON, text, etc.)"
              aria-label="Variable value"
              className="text-xs font-mono"
              rows={3}
              value={state.newVarValue}
              onChange={(e) =>
                dispatch({ type: "set-new-var-value", value: e.target.value })
              }
            />
            <div className="flex gap-2">
              <Button onClick={handleAdd} size="xs" intent="success" fullWidth>
                Save
              </Button>
              <Button
                onClick={() => dispatch({ type: "reset-add-form" })}
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
                className="min-w-0 p-2 bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <code
                    className="block min-w-0 flex-1 truncate text-xs font-semibold text-status-success dark:text-[var(--aw-status-success)] bg-status-success/10 dark:bg-[var(--aw-status-success)]/20 px-2 py-1 rounded"
                    title={varName}
                  >
                    {varName}
                  </code>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <IconButton
                      onClick={() =>
                        dispatch({
                          type: "start-edit",
                          varName,
                          value:
                            typeof varValue === "string"
                              ? varValue
                              : JSON.stringify(varValue),
                        })
                      }
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
                </div>

                {state.editingVar === varName ? (
                  <div className="space-y-1">
                    <TextArea
                      aria-label={`Variable ${varName} value`}
                      className="text-xs font-mono"
                      rows={3}
                      value={state.editValue}
                      onChange={(e) =>
                        dispatch({
                          type: "set-edit-value",
                          value: e.target.value,
                        })
                      }
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
                        onClick={() => dispatch({ type: "clear-edit" })}
                        variant="ghost"
                        size="xs"
                        fullWidth
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="min-w-0 max-h-24 overflow-y-auto overflow-x-hidden text-xs text-text-secondary dark:text-text-secondary-dark font-mono bg-surface-overlay dark:bg-surface-dark-overlay rounded p-1.5 border border-border/50 dark:border-border-dark/50">
                    {typeof varValue === "string" ? (
                      <pre className="whitespace-pre-wrap break-all">
                        {varValue}
                      </pre>
                    ) : (
                      <pre className="whitespace-pre-wrap break-all">
                        {JSON.stringify(varValue, null, 2)}
                      </pre>
                    )}
                  </div>
                )}

                <div className="min-w-0 text-[10px] text-text-muted dark:text-text-muted-dark">
                  <span className="break-all">
                    Use:{" "}
                    <code className="bg-surface dark:bg-surface-dark-raised px-1 rounded break-all">{`{{variables.${varName}}}`}</code>
                  </span>
                </div>
              </div>
            ))}

            {filteredVariables.length === 0 && (
              <EmptyState
                title="No matching variables"
                description="Try a different search term"
                className="py-6"
              />
            )}
          </div>
        ) : (
          <EmptyState
            title="No workflow variables yet"
            description="Create variables to share data between nodes"
            className="py-6"
          />
        )}
      </div>

      {/* Tips footer */}
      <div className="min-w-0 border-t border-border dark:border-border-dark p-3 text-[10px] text-text-muted dark:text-text-muted-dark bg-surface-overlay dark:bg-surface-dark-overlay space-y-1.5 overflow-x-hidden">
        <div className="font-semibold text-text-secondary dark:text-text-secondary-dark">
          Tips
        </div>
        <ul className="list-disc list-inside space-y-0.5 pl-1">
          <li>
            Extract values from API responses using &quot;Store Response
            Fields&quot;
          </li>
          <li>
            Reference variables anywhere:{" "}
            <code className="bg-surface dark:bg-surface-dark-raised px-1 break-all">{`{{variables.name}}`}</code>
          </li>
          <li>Variables persist throughout workflow execution</li>
        </ul>

        <div className="mt-2 pt-2 border-t border-border dark:border-border-dark flex items-center gap-1.5 text-text-secondary dark:text-text-secondary-dark">
          <GitMerge className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="font-semibold">Parallel Branches</span>
        </div>
        <ul className="list-disc list-inside space-y-0.5 pl-1">
          <li>
            Access branches:{" "}
            <code className="bg-surface dark:bg-surface-dark-raised px-1 break-all">{`{{prev[0].response}}`}</code>
          </li>
          <li>
            Single predecessor:{" "}
            <code className="bg-surface dark:bg-surface-dark-raised px-1 break-all">{`{{prev.response}}`}</code>
          </li>
        </ul>
      </div>
    </div>
  );
}
