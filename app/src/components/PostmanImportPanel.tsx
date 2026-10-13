import { useState, type ChangeEvent } from "react";
import { AlertCircle, Eye, Upload } from "lucide-react";
import type { PostmanImportPreview } from "@shared/types/PostmanImportPreview";
import type { PostmanImportResult } from "@shared/types/PostmanImportResult";
import { Button } from "./atoms/Button";
import { Input } from "./atoms/Input";
import { Toggle } from "./atoms/Toggle";
import { Card } from "./molecules/Card";
import { useScopeContext } from "../hooks/useScopeContext";
import { apiweave } from "../utils/apiweaveClient";

interface PostmanImportPanelProps {
  readonly onImported: (projectId: string) => void;
}

interface LoadedFile {
  readonly name: string;
  readonly json: Record<string, unknown>;
}

const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error(`Cannot read ${file.name}`));
    reader.readAsText(file);
  });
}

/** Reads a picked JSON file, or explains why it is not one. */
async function readJsonFile(file: File): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readText(file));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${file.name} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Postman Collection v2.1 → a new project. Picks the collection (and an
 * optional Postman environment), previews what the import creates without
 * writing anything, then imports. Secret values are never imported: the
 * preview lists the secrets to create instead.
 */
export function PostmanImportPanel({ onImported }: PostmanImportPanelProps) {
  const { workspaceId } = useScopeContext();
  const [collection, setCollection] = useState<LoadedFile | null>(null);
  const [environment, setEnvironment] = useState<LoadedFile | null>(null);
  const [perRequest, setPerRequest] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [preview, setPreview] = useState<PostmanImportPreview | null>(null);
  const [result, setResult] = useState<PostmanImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick =
    (set: (file: LoadedFile | null) => void) =>
    async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = event.target.files?.[0];
      setPreview(null);
      setResult(null);
      setError(null);
      if (!file) return set(null);
      try {
        set({ name: file.name, json: await readJsonFile(file) });
      } catch (readError: unknown) {
        set(null);
        setError(
          readError instanceof SyntaxError
            ? `${file.name} is not valid JSON`
            : errorText(readError, `Cannot read ${file.name}`),
        );
      }
    };

  const request = () => ({
    workspaceId: workspaceId ?? "",
    collection: collection?.json ?? {},
    ...(environment ? { environment: environment.json } : {}),
    mode: perRequest ? ("request" as const) : ("folder" as const),
    ...(projectName.trim() ? { projectName: projectName.trim() } : {}),
  });

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (!workspaceId || !collection) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (actionError: unknown) {
      setError(errorText(actionError, "Postman import failed"));
    } finally {
      setBusy(false);
    }
  };

  const handlePreview = () =>
    run(async () => {
      const next = await apiweave.projects.previewPostman(request());
      setPreview(next);
      setProjectName((current) => current || next.projectName);
    });

  const handleImport = () =>
    run(async () => {
      const imported = await apiweave.projects.importPostman(request());
      setResult(imported);
      onImported(imported.projectId);
    });

  return (
    <div className="space-y-4">
      <Input
        type="file"
        label="Postman collection (v2.1)"
        accept=".json"
        onChange={(event) => void pick(setCollection)(event)}
      />
      <Input
        type="file"
        label="Postman environment (optional)"
        accept=".json"
        onChange={(event) => void pick(setEnvironment)(event)}
      />
      <Input
        label="Project name"
        value={projectName}
        placeholder="Defaults to the collection name"
        onChange={(event) => setProjectName(event.target.value)}
      />
      <Toggle
        label="One workflow per request (instead of one per folder)"
        checked={perRequest}
        onChange={(event) => {
          setPerRequest(event.target.checked);
          setPreview(null);
        }}
      />

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 text-sm text-status-error dark:text-[var(--aw-status-error)]"
        >
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /> {error}
        </p>
      )}

      {preview && !result && <PostmanPreview preview={preview} />}

      {result && (
        <Card title="Imported">
          <p className="text-sm text-text-primary dark:text-text-primary-dark">
            Created a project with {result.workflowCount} workflow(s)
            {result.environmentCount > 0 ? " and its environment" : ""}.
          </p>
          {result.missingSecrets.length > 0 && (
            <p className="mt-2 text-sm text-text-secondary dark:text-text-secondary-dark">
              Create these secrets before running it:{" "}
              {result.missingSecrets.join(", ")}
            </p>
          )}
        </Card>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          icon={<Eye size={16} />}
          disabled={busy || !collection}
          onClick={() => void handlePreview()}
        >
          Preview
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          icon={<Upload size={16} />}
          disabled={busy || !preview || result !== null}
          onClick={() => void handleImport()}
        >
          {busy ? "Working..." : "Import as new project"}
        </Button>
      </div>
    </div>
  );
}

function PostmanPreview({ preview }: { readonly preview: PostmanImportPreview }) {
  return (
    <div className="space-y-3">
      <Card title={`${preview.workflows.length} workflow(s)`}>
        <ul className="space-y-1 text-sm text-text-primary dark:text-text-primary-dark">
          {preview.workflows.map((workflow) => (
            <li key={workflow.name} className="flex justify-between gap-2">
              <span className="truncate">{workflow.name}</span>
              <span className="text-text-muted dark:text-text-muted-dark">
                {workflow.requestCount} request(s)
              </span>
            </li>
          ))}
        </ul>
        {preview.environment && (
          <p className="mt-2 text-xs text-text-secondary dark:text-text-secondary-dark">
            Environment "{preview.environment.name}" with{" "}
            {preview.environment.variableCount} variable(s)
          </p>
        )}
      </Card>
      {preview.requiredSecrets.length > 0 && (
        <Card title="Secrets to create">
          <p className="mb-2 text-xs text-text-secondary dark:text-text-secondary-dark">
            Credential values are never imported. Create these secrets in the
            workspace with the values from Postman.
          </p>
          <ul className="space-y-1 text-sm">
            {preview.requiredSecrets.map((secret) => (
              <li key={secret.name}>
                <code className="font-mono text-text-primary dark:text-text-primary-dark">
                  {secret.name}
                </code>{" "}
                <span className="text-text-muted dark:text-text-muted-dark">
                  — {secret.usedBy}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {preview.warnings.length > 0 && (
        <Card title={`${preview.warnings.length} warning(s)`} collapsible>
          <ul className="list-disc space-y-1 pl-4 text-xs text-text-secondary dark:text-text-secondary-dark">
            {preview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export default PostmanImportPanel;
