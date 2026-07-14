import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import type { ExtractorFormProps } from "../../types";

const RESPONSE_PATH_PREFIX = "response.body.";

export function normalizeExtractorPath(path: string): string {
  const trimmed = path.trim();
  return trimmed.startsWith("response.")
    ? trimmed
    : `${RESPONSE_PATH_PREFIX}${trimmed}`;
}

export function ExtractorForm({ onAdd }: ExtractorFormProps) {
  const [variableName, setVariableName] = useState("");
  const [responsePath, setResponsePath] = useState("");

  const handleAdd = () => {
    if (!variableName.trim() || !responsePath.trim()) return;
    onAdd(variableName.trim(), normalizeExtractorPath(responsePath));
    setVariableName("");
    setResponsePath("");
  };

  return (
    <div className="space-y-2 rounded-sm border border-dashed border-border bg-surface-overlay p-3 dark:border-border-dark dark:bg-surface-dark-overlay">
      <Input
        value={variableName}
        onChange={(event) => setVariableName(event.target.value)}
        placeholder="Variable name (e.g., token)"
        aria-label="Extractor variable name"
        className="font-mono"
      />
      <div className="flex items-center rounded-sm border border-border bg-surface-raised focus-within:outline-2 focus-within:outline-[var(--aw-primary)] focus-within:outline-offset-[var(--aw-focus-ring-offset)] dark:border-border-dark dark:bg-surface-dark-raised">
        <span className="select-none pl-3 font-mono text-xs text-text-muted dark:text-text-muted-dark">
          {RESPONSE_PATH_PREFIX}
        </span>
        <input
          value={responsePath}
          onChange={(event) => setResponsePath(event.target.value)}
          placeholder="data.name"
          aria-label="Extractor path after response.body"
          className="h-10 min-w-0 flex-1 rounded-sm bg-transparent px-1 font-mono text-sm text-text-primary placeholder:text-text-muted focus:outline-none dark:text-text-primary-dark dark:placeholder:text-text-muted-dark"
        />
      </div>
      <Button type="button" size="sm" fullWidth onClick={handleAdd}>
        <Plus className="h-4 w-4" />
        Add extractor
      </Button>
    </div>
  );
}
