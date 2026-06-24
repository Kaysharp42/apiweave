import { memo, useState, useCallback, useMemo } from "react";
import { Handle, Position, useReactFlow } from "reactflow";
import { BaseNode } from "../atoms/flow/BaseNode";
import AssertionEditor from "../AssertionEditor";
import { XCircle, Info, Pencil, Trash2, BadgeCheck } from "lucide-react";
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
    <div className="space-y-1.5 p-2 rounded-sm border border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay">
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
          className="nodrag w-full px-1.5 py-0.5 border rounded-sm text-xs focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] cursor-pointer"
          style={{
            borderColor: "var(--aw-border)",
            backgroundColor: "var(--aw-surface-raised)",
            color: "var(--aw-text-primary)",
          }}
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
              `nodrag w-full px-1.5 py-0.5 border rounded text-xs focus-visible:outline-2 focus-visible:outline-offset-[var(--aw-focus-ring-offset)] ` +
              (errors.path
                ? "focus-visible:outline-[var(--aw-status-error)] bg-[var(--aw-status-error)]/5"
                : "focus-visible:outline-[var(--aw-primary)]")
            }
            style={
              errors.path
                ? {
                    borderColor: "var(--aw-status-error)",
                    color: "var(--aw-status-error)",
                  }
                : {
                    borderColor: "var(--aw-border)",
                    backgroundColor: "var(--aw-surface-raised)",
                    color: "var(--aw-text-primary)",
                  }
            }
          />
          {errors.path && (
            <div
              className="text-xs mt-1"
              style={{ color: "var(--aw-status-error)" }}
            >
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
          className="nodrag w-full px-1.5 py-0.5 border rounded-sm text-xs focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] cursor-pointer"
          style={{
            borderColor: "var(--aw-border)",
            backgroundColor: "var(--aw-surface-raised)",
            color: "var(--aw-text-primary)",
          }}
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
              `nodrag w-full px-1.5 py-0.5 border rounded text-xs font-mono focus-visible:outline-2 focus-visible:outline-offset-[var(--aw-focus-ring-offset)] ` +
              (errors.expectedValue
                ? "focus-visible:outline-[var(--aw-status-error)] bg-[var(--aw-status-error)]/5"
                : "focus-visible:outline-[var(--aw-primary)]")
            }
            style={
              errors.expectedValue
                ? {
                    borderColor: "var(--aw-status-error)",
                    color: "var(--aw-status-error)",
                  }
                : {
                    borderColor: "var(--aw-border)",
                    backgroundColor: "var(--aw-surface-raised)",
                    color: "var(--aw-text-primary)",
                  }
            }
          />
          {errors.expectedValue && (
            <div
              className="text-xs mt-1"
              style={{ color: "var(--aw-status-error)" }}
            >
              {errors.expectedValue}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={handleAdd}
        aria-label="Add assertion"
        className="w-full px-2 py-1 text-surface-raised dark:text-surface-dark-raised text-xs font-semibold rounded-sm nodrag transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] motion-reduce:transition-none bg-primary dark:bg-primary-light"
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

  const icon = useMemo(
    () =>
      data.executionStatus === "error" ? (
        <XCircle
          className="w-4 h-4"
          style={{ color: "var(--aw-status-error)" }}
        />
      ) : (
        <BadgeCheck
          className="w-4 h-4"
          style={{ color: "var(--aw-status-success)" }}
        />
      ),
    [data.executionStatus],
  );

  const titleExtra = useMemo(() => {
    if (!data.assertionStats) return null;

    return (
      <span
        className={`text-xs font-mono px-1.5 py-0.5 rounded-sm border ${
          data.assertionStats.failedCount > 0
            ? "bg-[var(--aw-status-error)]/10 text-status-error dark:text-status-error-dark border-status-error/30"
            : "bg-[var(--aw-status-success)]/10 text-status-success dark:text-status-success-dark border-status-success/30"
        }`}
      >
        {data.assertionStats.failedCount > 0
          ? `${data.assertionStats.failedCount}/${data.assertionStats.totalCount} failed`
          : `${data.assertionStats.passedCount}/${data.assertionStats.totalCount} passed`}
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
          <Handle
            type="source"
            position={Position.Right}
            id="pass"
            className="!bg-[var(--aw-status-success)] !w-3.5 !h-3.5 !border-2 !border-[var(--aw-surface-raised)] dark:!border-[var(--aw-surface-dark)] !rounded-full"
            style={{ position: "relative" }}
            title="Pass &mdash; all assertions passed"
          />
          <div
            className="absolute text-xs font-semibold pointer-events-none select-none text-right opacity-0 group-hover:opacity-100 transition-opacity motion-reduce:transition-none"
            style={{
              right: 14,
              top: -4,
              lineHeight: "1",
              whiteSpace: "nowrap",
              color: "var(--aw-status-success)",
            }}
          >
            Pass
          </div>
        </div>

        <div
          className="group absolute"
          style={{ top: "50%", right: 0, transform: "translateY(20px)" }}
        >
          <Handle
            type="source"
            position={Position.Right}
            id="fail"
            className="!bg-[var(--aw-status-error)] !w-3.5 !h-3.5 !border-2 !border-[var(--aw-surface-raised)] dark:!border-[var(--aw-surface-dark)] !rounded-full"
            style={{ position: "relative" }}
            title="Fail &mdash; one or more assertions failed"
          />
          <div
            className="absolute text-xs font-semibold pointer-events-none select-none text-right opacity-0 group-hover:opacity-100 transition-opacity motion-reduce:transition-none"
            style={{
              right: 14,
              top: -4,
              lineHeight: "1",
              whiteSpace: "nowrap",
              color: "var(--aw-status-error)",
            }}
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

  return (
    <BaseNode
      title={data.label ?? "Assertions"}
      icon={icon}
      status={data.executionStatus ?? "idle"}
      selected={selected ?? false}
      nodeId={id}
      handleLeft={{ type: "target" }}
      collapsible={true}
      defaultExpanded={false}
      titleExtra={titleExtra}
      extraHandles={extraHandles}
      className={`min-w-[250px] ${data?.invalid ? "ring-2 ring-[var(--aw-status-error)] animate-pulse motion-reduce:animate-none" : ""}`}
    >
      {({ isExpanded }) => (
        <div className="p-3 space-y-1.5">
          <div className="text-xs text-text-muted dark:text-text-muted-dark">
            {assertionCount} assertion{assertionCount !== 1 ? "s" : ""}
          </div>

          {data.executionStatus && data.assertionStats && (
            <div
              className={`mt-1 p-1.5 rounded-sm text-xs border ${
                data.assertionStats.failedCount > 0
                  ? "bg-[var(--aw-status-error)]/5 border-status-error/30"
                  : "bg-[var(--aw-status-success)]/5 border-status-success/30"
              }`}
            >
              <div
                className="font-semibold mb-1"
                style={{
                  color:
                    data.assertionStats.failedCount > 0
                      ? "var(--aw-status-error)"
                      : "var(--aw-status-success)",
                }}
              >
                Last Run Results
              </div>
              <div className="space-y-0.5">
                <div style={{ color: "var(--aw-status-success)" }}>
                  &check; {data.assertionStats.passedCount} passed
                </div>
                {data.assertionStats.failedCount > 0 && (
                  <div style={{ color: "var(--aw-status-error)" }}>
                    &times; {data.assertionStats.failedCount} failed
                  </div>
                )}
              </div>
            </div>
          )}

          {isExpanded && (
            <div
              className="space-y-2 pt-1 border-t"
              style={{ borderColor: "var(--aw-border)" }}
            >
              <AssertionForm onAdd={handleAddAssertion} />

              {data.config?.assertions && data.config.assertions.length > 0 ? (
                <div className="space-y-1.5">
                  {data.config.assertions.map((assertion, index) => (
                    <div
                      key={`${assertion.source}-${assertion.path}-${assertion.operator}-${assertion.expectedValue}`}
                      className="p-1.5 border rounded-sm space-y-0.5"
                      style={{
                        backgroundColor: "var(--aw-surface-raised)",
                        borderColor: "var(--aw-border)",
                      }}
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
                              <div
                                className="mb-1 text-xs font-semibold"
                                style={{ color: "var(--aw-status-success)" }}
                              >
                                &check; Passed
                              </div>
                            )}
                            {data.assertionStats?.failed?.some(
                              (f) => f.index === index,
                            ) && (
                              <div className="mb-1 text-xs">
                                <div
                                  className="font-semibold"
                                  style={{ color: "var(--aw-status-error)" }}
                                >
                                  &times; Failed
                                </div>
                                <div
                                  className="mt-0.5"
                                  style={{ color: "var(--aw-status-error)" }}
                                >
                                  {
                                    data.assertionStats.failed.find(
                                      (f) => f.index === index,
                                    )?.message
                                  }
                                </div>
                              </div>
                            )}
                            <div className="text-xs">
                              <div
                                className="font-semibold"
                                style={{ color: "var(--aw-status-success)" }}
                              >
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
                                <code
                                  className="px-0.5 rounded"
                                  style={{
                                    backgroundColor:
                                      "var(--aw-surface-overlay)",
                                  }}
                                >
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
                              className="px-1.5 py-0.5 text-status-warning dark:text-status-warning-dark bg-[var(--aw-status-warning)]/10 border border-status-warning/30 text-xs rounded-sm nodrag transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] motion-reduce:transition-none"
                              title="Edit assertion"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteAssertion(index)}
                              className="px-1.5 py-0.5 text-status-error dark:text-status-error-dark bg-[var(--aw-status-error)]/10 border border-status-error/30 text-xs rounded-sm nodrag transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] motion-reduce:transition-none"
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
                <div className="text-xs italic py-2 text-text-muted dark:text-text-muted-dark">
                  No assertions yet. Add one above.
                </div>
              )}

              <div className="text-xs space-y-1 p-2 rounded-sm border bg-[var(--aw-status-info)]/5 border-status-info/30">
                <p className="flex items-center gap-1">
                  <Info
                    className="w-3 h-3 flex-shrink-0"
                    style={{ color: "var(--aw-status-info)" }}
                  />
                  <span>
                    <strong>Pass/Fail:</strong> Connect the green handle for
                    all-pass, red for any-fail.
                  </span>
                </p>
                <p>
                  Use{" "}
                  <code
                    className="px-1.5 py-0.5 rounded text-xs font-mono"
                    style={{
                      backgroundColor: "var(--aw-surface-overlay)",
                      color: "var(--aw-status-info)",
                    }}
                  >
                    prev.*
                  </code>{" "}
                  to reference previous node results, or{" "}
                  <code
                    className="px-1.5 py-0.5 rounded text-xs font-mono"
                    style={{
                      backgroundColor: "var(--aw-surface-overlay)",
                      color: "var(--aw-status-info)",
                    }}
                  >
                    variables.*
                  </code>{" "}
                  for workflow variables.
                </p>
                <p className="text-xs">
                  <strong>JSONPath examples:</strong>{" "}
                  <code
                    className="px-1.5 py-0.5 rounded text-xs font-mono"
                    style={{
                      backgroundColor: "var(--aw-surface-overlay)",
                      color: "var(--aw-status-info)",
                    }}
                  >
                    body.data[0].id
                  </code>
                  ,
                  <code
                    className="px-1.5 py-0.5 rounded text-xs font-mono"
                    style={{
                      backgroundColor: "var(--aw-surface-overlay)",
                      color: "var(--aw-status-info)",
                    }}
                  >
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
