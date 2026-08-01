import { memo, useState, useCallback, useMemo } from "react";
import { useReactFlow } from "reactflow";
import { BaseNode } from "../atoms/flow/BaseNode";
import { NodeHandle } from "../atoms/flow/NodeHandle";
import AssertionEditor from "../AssertionEditor";
import { Info, ListChecks, Pencil, Trash2 } from "lucide-react";
import type {
  AssertionNodeProps,
  AssertionItem,
} from "../../types/AssertionNodeProps";

type AssertionSource = AssertionItem["source"];
type AssertionOperator = AssertionItem["operator"];

interface AssertionFormProps {
  onAdd: (assertion: AssertionItem) => void;
}

interface FormErrors {
  path: string;
  expectedValue: string;
}

const AssertionForm = ({ onAdd }: AssertionFormProps) => {
  const [source, setSource] = useState<AssertionSource>("prev");
  const [path, setPath] = useState("");
  const [operator, setOperator] = useState<AssertionOperator>("equals");
  const [expectedValue, setExpectedValue] = useState("");
  const [errors, setErrors] = useState<FormErrors>({
    path: "",
    expectedValue: "",
  });

  const handleAdd = () => {
    setErrors({ path: "", expectedValue: "" });

    if (source === "status") {
      onAdd({
        source,
        path: "",
        operator,
        expectedValue: expectedValue.trim(),
      });
      setErrors({ path: "", expectedValue: "" });
    } else if (["exists", "notExists"].includes(operator)) {
      if (path.trim()) {
        onAdd({
          source,
          path: path.trim(),
          operator,
          expectedValue: "",
        });
        setErrors({ path: "", expectedValue: "" });
      } else {
        setErrors({ path: "Path is required", expectedValue: "" });
        return;
      }
    } else if (operator === "count") {
      if (path.trim() && expectedValue.trim()) {
        onAdd({
          source,
          path: path.trim(),
          operator,
          expectedValue: expectedValue.trim(),
        });
        setErrors({ path: "", expectedValue: "" });
      } else {
        setErrors({
          path: path.trim() ? "" : "Path is required",
          expectedValue: expectedValue.trim() ? "" : "Count value required",
        });
        return;
      }
    } else {
      if (path.trim() && expectedValue.trim()) {
        onAdd({
          source,
          path: path.trim(),
          operator,
          expectedValue: expectedValue.trim(),
        });
        setErrors({ path: "", expectedValue: "" });
      } else {
        setErrors({
          path: path.trim() ? "" : "Path is required",
          expectedValue: expectedValue.trim() ? "" : "Expected value required",
        });
        return;
      }
    }

    setPath("");
    setExpectedValue("");
    setSource("prev");
    setOperator("equals");
  };

  return (
    <div className="space-y-1.5 p-2 rounded-node-ctl border border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay">
      <div>
        <label
          htmlFor="assertion-source"
          className="block text-xs font-semibold mb-0.5 text-text-secondary dark:text-text-secondary-dark"
        >
          Assert On
        </label>
        <select
          id="assertion-source"
          value={source}
          onChange={(e) => setSource(e.target.value as AssertionSource)}
          className="nodrag w-full px-1.5 py-0.5 border rounded-node-ctl text-xs border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] cursor-pointer"
        >
          <option value="prev">Previous Node Result (prev.*)</option>
          <option value="variables">Workflow Variables (variables.*)</option>
          <option value="status">HTTP Status Code</option>
          <option value="cookies">Cookies</option>
          <option value="headers">Response Headers</option>
        </select>
      </div>

      {source !== "status" && (
        <div>
          <label
            htmlFor="assertion-path"
            className="block text-xs font-semibold mb-0.5 text-text-secondary dark:text-text-secondary-dark"
          >
            {source === "prev"
              ? "JSONPath (e.g., body.status)"
              : source === "variables"
                ? "Variable name"
                : source === "cookies"
                  ? "Cookie name"
                  : "Header name"}
          </label>
          <input
            id="assertion-path"
            type="text"
            placeholder={
              source === "prev"
                ? "body.status"
                : source === "variables"
                  ? "tokenId"
                  : "Set-Cookie"
            }
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className={
              `nodrag w-full px-1.5 py-0.5 border rounded-node-ctl text-xs focus-visible:outline-2 focus-visible:outline-offset-[var(--aw-focus-ring-offset)] ` +
              (errors.path
                ? "border-[var(--aw-status-error)] text-[var(--aw-status-error)] bg-[var(--aw-status-error)]/5 focus-visible:outline-[var(--aw-status-error)]"
                : "border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus-visible:outline-[var(--aw-primary)]")
            }
          />
          {errors.path && (
            <div className="text-xs mt-1 text-[var(--aw-status-error)]">
              {errors.path}
            </div>
          )}
        </div>
      )}

      <div>
        <label
          htmlFor="assertion-operator"
          className="block text-xs font-semibold mb-0.5 text-text-secondary dark:text-text-secondary-dark"
        >
          Operator
        </label>
        <select
          id="assertion-operator"
          value={operator}
          onChange={(e) => setOperator(e.target.value as AssertionOperator)}
          className="nodrag w-full px-1.5 py-0.5 border rounded-node-ctl text-xs border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] cursor-pointer"
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

      {!["exists", "notExists"].includes(operator) && (
        <div>
          <label
            htmlFor="assertion-expected-value"
            className="block text-xs font-semibold mb-0.5 text-text-secondary dark:text-text-secondary-dark"
          >
            {operator === "count" ? "Expected Count" : "Expected Value"}
          </label>
          <input
            id="assertion-expected-value"
            type="text"
            placeholder={operator === "count" ? "5" : "200"}
            value={expectedValue}
            onChange={(e) => setExpectedValue(e.target.value)}
            className={
              `nodrag w-full px-1.5 py-0.5 border rounded-node-ctl text-xs font-mono focus-visible:outline-2 focus-visible:outline-offset-[var(--aw-focus-ring-offset)] ` +
              (errors.expectedValue
                ? "border-[var(--aw-status-error)] text-[var(--aw-status-error)] bg-[var(--aw-status-error)]/5 focus-visible:outline-[var(--aw-status-error)]"
                : "border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus-visible:outline-[var(--aw-primary)]")
            }
          />
          {errors.expectedValue && (
            <div className="text-xs mt-1 text-[var(--aw-status-error)]">
              {errors.expectedValue}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={handleAdd}
        aria-label="Add assertion"
        className="w-full px-2 py-1 text-surface-raised dark:text-surface-dark-raised text-xs font-semibold rounded-node-ctl nodrag transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] motion-reduce:transition-none bg-primary dark:bg-primary-light"
      >
        Add Assertion
      </button>
    </div>
  );
};

const AssertionNode = ({ id, data, selected }: AssertionNodeProps) => {
  const { setNodes } = useReactFlow();
  const [editingIndex, setEditingIndex] = useState(-1);
  const [editDraft, setEditDraft] = useState<AssertionItem | null>(null);

  // A fixed identity icon, never a status swap. The status is already drawn by
  // the shell's border, glow and affordance; an icon that also changed with it
  // was the same fact rendered twice — and a green BadgeCheck sitting beside the
  // shell's success check read as two checks on one node.
  const icon = useMemo(() => <ListChecks className="w-4 h-4" />, []);

  const typeChip = useMemo(() => {
    if (!data.assertionStats) return null;

    const failed = data.assertionStats.failedCount > 0;

    return (
      <span
        className={`flex-shrink-0 text-[11px] font-mono px-1.5 py-0.5 rounded-node-chip ${
          failed
            ? "bg-[color-mix(in_srgb,var(--aw-status-error)_12%,transparent)] text-[var(--aw-status-error)]"
            : "bg-[color-mix(in_srgb,var(--aw-status-success)_12%,transparent)] text-[var(--aw-status-success)]"
        }`}
      >
        {failed
          ? `${data.assertionStats.failedCount}/${data.assertionStats.totalCount}`
          : `${data.assertionStats.passedCount}/${data.assertionStats.totalCount}`}
      </span>
    );
  }, [data.assertionStats]);

  const extraHandles = useMemo(
    () => (
      <>
        <div
          className="group absolute"
          style={{ top: "50%", right: 0, transform: "translateY(-20px)" }}
        >
          {/* Pinned to their semantic colours — these two sockets mean pass and
              fail regardless of the node's own state. */}
          <NodeHandle
            type="source"
            position="right"
            id="pass"
            color="var(--aw-status-success)"
            style={{ position: "relative" }}
          />
          <div
            className="absolute text-xs font-semibold pointer-events-none select-none text-right opacity-0 group-hover:opacity-100 transition-opacity motion-reduce:transition-none text-[var(--aw-status-success)]"
            style={{ right: 14, top: -4, lineHeight: "1", whiteSpace: "nowrap" }}
          >
            Pass
          </div>
        </div>

        <div
          className="group absolute"
          style={{ top: "50%", right: 0, transform: "translateY(20px)" }}
        >
          <NodeHandle
            type="source"
            position="right"
            id="fail"
            color="var(--aw-status-error)"
            style={{ position: "relative" }}
          />
          <div
            className="absolute text-xs font-semibold pointer-events-none select-none text-right opacity-0 group-hover:opacity-100 transition-opacity motion-reduce:transition-none text-[var(--aw-status-error)]"
            style={{ right: 14, top: -4, lineHeight: "1", whiteSpace: "nowrap" }}
          >
            Fail
          </div>
        </div>
      </>
    ),
    [],
  );

  const updateNodeData = useCallback(
    (key: string, value: unknown) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  config: { ...node.data.config, [key]: value },
                },
              }
            : node,
        ),
      );
    },
    [id, setNodes],
  );

  const handleAddAssertion = (assertion: AssertionItem) => {
    const assertions = data.config?.assertions ?? [];
    updateNodeData("assertions", [...assertions, assertion]);
  };

  const handleDeleteAssertion = (index: number) => {
    const assertions = data.config?.assertions ?? [];
    updateNodeData(
      "assertions",
      assertions.filter((_, i) => i !== index),
    );
  };

  const assertionCount = data.config?.assertions?.length ?? 0;
  const stats = data.assertionStats;
  const status = data.executionStatus ?? "idle";

  /**
   * `2 passed`, or `1 failed: data.accessToken` — naming *what* broke is the
   * whole value of the summary. Falls back to the failure message when the
   * failed assertion no longer resolves to a configured path.
   */
  const resultSummary = useMemo(() => {
    if (!stats) return undefined;

    if (stats.failedCount > 0) {
      const firstFailure = stats.failed?.[0];
      const failedPath =
        firstFailure !== undefined
          ? (data.config?.assertions?.[firstFailure.index]?.path ??
            firstFailure.message)
          : undefined;

      return {
        operation: `${stats.failedCount} failed`,
        ...(failedPath && { argument: failedPath }),
      };
    }

    return { operation: `${stats.passedCount} passed` };
  }, [stats, data.config?.assertions]);

  return (
    <BaseNode
      title={data.label ?? "Assertions"}
      icon={icon}
      tileHue="var(--aw-status-info)"
      status={status}
      selected={selected ?? false}
      nodeId={id}
      presetNodeType="assertion"
      handleLeft={{ type: "target" }}
      collapsible={true}
      defaultExpanded={false}
      typeChip={typeChip}
      extraHandles={extraHandles}
      restLine={{
        operation: `${assertionCount} assertion${assertionCount !== 1 ? "s" : ""}`,
      }}
      activityLine={{
        operation: "checking",
        argument: `${assertionCount} assertion${assertionCount !== 1 ? "s" : ""}`,
      }}
      {...(resultSummary && { resultSummary })}
      metrics={[
        {
          label: "passed",
          value: stats ? `${stats.passedCount}/${stats.totalCount}` : null,
        },
        // Assertion stats are counts; the runner does not time the check itself.
        { label: "duration", value: null },
      ]}
      progress={status === "running" ? "indeterminate" : null}
      className={`min-w-[250px] ${data?.invalid ? "ring-2 ring-[var(--aw-status-error)]" : ""}`}
    >
      {({ isExpanded }) => (
        <div className={isExpanded ? "p-3 space-y-1.5" : ""}>
          {isExpanded && (
            <div className="space-y-2 pt-1 border-t border-border dark:border-border-dark">
              <AssertionForm onAdd={handleAddAssertion} />

              {data.config?.assertions && data.config.assertions.length > 0 ? (
                <div className="space-y-1.5">
                  {data.config.assertions.map((assertion, index) => (
                    <div
                      key={`${assertion.source}-${assertion.path}-${assertion.operator}-${assertion.expectedValue}`}
                      className="p-1.5 border rounded-node-ctl space-y-0.5 border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised"
                    >
                      {editingIndex === index ? (
                        <AssertionEditor
                          value={editDraft}
                          onChange={(next) =>
                            setEditDraft(next as AssertionItem)
                          }
                          onCancel={() => {
                            setEditingIndex(-1);
                            setEditDraft(null);
                          }}
                          onSave={() => {
                            const updated = (data.config?.assertions ?? []).map(
                              (a, i) => (i === index ? { ...editDraft } : a),
                            );
                            updateNodeData("assertions", updated);
                            setEditingIndex(-1);
                            setEditDraft(null);
                          }}
                        />
                      ) : (
                        <div className="flex items-start justify-between gap-1">
                          <div className="flex-1 min-w-0">
                            {data.assertionStats?.passed?.some(
                              (p) => p.index === index,
                            ) && (
                              <div className="mb-1 text-xs font-semibold text-[var(--aw-status-success)]">
                                &check; Passed
                              </div>
                            )}
                            {data.assertionStats?.failed?.some(
                              (f) => f.index === index,
                            ) && (
                              <div className="mb-1 text-xs">
                                <div className="font-semibold text-[var(--aw-status-error)]">
                                  &times; Failed
                                </div>
                                <div className="mt-0.5 text-[var(--aw-status-error)]">
                                  {
                                    data.assertionStats.failed.find(
                                      (f) => f.index === index,
                                    )?.message
                                  }
                                </div>
                              </div>
                            )}
                            <div className="text-xs">
                              <div className="font-semibold text-[var(--aw-status-success)]">
                                {assertion.source === "prev"
                                  ? "{{prev."
                                  : assertion.source === "variables"
                                    ? "{{variables."
                                    : assertion.source === "status"
                                      ? "status"
                                      : assertion.source === "cookies"
                                        ? "Cookie: "
                                        : "Header: "}
                                {assertion.source !== "status" &&
                                  assertion.path}
                                {(assertion.source === "prev" ||
                                  assertion.source === "variables") &&
                                  "}}"}
                              </div>
                              <div className="mt-0.5 text-text-secondary dark:text-text-secondary-dark">
                                {assertion.operator}{" "}
                                <code className="px-0.5 rounded-node-chip bg-surface-overlay dark:bg-surface-dark-overlay">
                                  {assertion.expectedValue}
                                </code>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingIndex(index);
                                setEditDraft({ ...assertion });
                              }}
                              className="px-1.5 py-0.5 text-status-warning dark:text-status-warning-dark bg-[var(--aw-status-warning)]/10 border border-status-warning/30 text-xs rounded-node-ctl nodrag transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] motion-reduce:transition-none"
                              title="Edit assertion"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteAssertion(index)}
                              className="px-1.5 py-0.5 text-status-error dark:text-status-error-dark bg-[var(--aw-status-error)]/10 border border-status-error/30 text-xs rounded-node-ctl nodrag transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] motion-reduce:transition-none"
                              title="Delete assertion"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs italic py-2 text-[var(--aw-node-text-muted)]">
                  No assertions yet. Add one above.
                </div>
              )}

              <div className="text-xs space-y-1 p-2 rounded-node-ctl border bg-[var(--aw-status-info)]/5 border-status-info/30">
                <p className="flex items-center gap-1">
                  <Info className="w-3 h-3 flex-shrink-0 text-[var(--aw-status-info)]" />
                  <span>
                    <strong>Pass/Fail:</strong> Connect the green handle for
                    all-pass, red for any-fail.
                  </span>
                </p>
                <p>
                  Use{" "}
                  <code className="px-1.5 py-0.5 rounded-node-chip text-xs font-mono bg-surface-overlay dark:bg-surface-dark-overlay text-[var(--aw-status-info)]">
                    prev.*
                  </code>{" "}
                  to reference previous node results, or{" "}
                  <code className="px-1.5 py-0.5 rounded-node-chip text-xs font-mono bg-surface-overlay dark:bg-surface-dark-overlay text-[var(--aw-status-info)]">
                    variables.*
                  </code>{" "}
                  for workflow variables.
                </p>
                <p className="text-xs">
                  <strong>JSONPath examples:</strong>{" "}
                  <code className="px-1.5 py-0.5 rounded-node-chip text-xs font-mono bg-surface-overlay dark:bg-surface-dark-overlay text-[var(--aw-status-info)]">
                    body.data[0].id
                  </code>
                  ,
                  <code className="px-1.5 py-0.5 rounded-node-chip text-xs font-mono bg-surface-overlay dark:bg-surface-dark-overlay text-[var(--aw-status-info)]">
                    response.user.email
                  </code>
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </BaseNode>
  );
};

export default memo(AssertionNode);
