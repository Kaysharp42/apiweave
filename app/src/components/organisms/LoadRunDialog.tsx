import { useId, useRef, useState } from "react";
import { FileSpreadsheet, X } from "lucide-react";
import { Button } from "../atoms/Button";
import { IconButton } from "../atoms/IconButton";
import { Input } from "../atoms/Input";
import { TextArea } from "../atoms/TextArea";
import { FormField } from "../molecules/FormField";
import { Modal } from "../molecules/Modal";
import { ModalFormFooter } from "../molecules/ModalFormFooter";
import {
  MAX_ITERATION_DATA_BYTES,
  parseIterationData,
  type IterationRow,
} from "@shared/iteration-data/iterationData";
import type { LoadRunDialogProps, LoadRunRequest } from "../../types";

const MAX_ITERATIONS = 100_000;

const SECTION_HEADING =
  "mb-2 text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-secondary-dark";

/** Whole seconds typed in a field, as milliseconds; undefined when blank, null when not a positive number. */
function secondsToMs(text: string): number | undefined | null {
  if (text.trim() === "") return undefined;
  const seconds = Number(text);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
}

interface DataFileRowProps {
  file: File | null;
  rows: IterationRow[] | undefined;
  onSelect: (picked: File) => void;
  onClear: () => void;
}

/** The data file's one-line summary, with the controls that choose, replace or remove it. */
function DataFileRow({ file, rows, onSelect, onClear }: DataFileRowProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasFile = file !== null;

  return (
    <div className="flex items-center gap-3 rounded-sm border border-border px-3 py-2.5 dark:border-border-dark">
      <FileSpreadsheet className="h-4 w-4 shrink-0 text-text-muted dark:text-text-muted-dark" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text-primary dark:text-text-primary-dark">
          {hasFile ? file.name : "No data file"}
        </p>
        <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
          {hasFile
            ? `${rows?.length ?? 0} rows, reused in order`
            : "CSV or JSON; each row is available as {{data.<column>}}"}
        </p>
      </div>
      {hasFile && (
        <IconButton
          tooltip="Remove data file"
          size="sm"
          onClick={() => {
            onClear();
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      )}
      <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
        {hasFile ? "Replace…" : "Choose file…"}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        aria-label="Data file for the load run"
        tabIndex={-1}
        className="hidden"
        onChange={(event) => {
          const picked = event.target.files?.[0];
          if (picked) onSelect(picked);
        }}
      />
    </div>
  );
}

/** Collects a load run's settings: iterations or a data file, concurrency, duration, ramp-up and thresholds. */
export function LoadRunDialog({ isOpen, onClose, onStart }: LoadRunDialogProps) {
  const formId = useId();
  const [iterations, setIterations] = useState("100");
  const [concurrency, setConcurrency] = useState("10");
  const [duration, setDuration] = useState("");
  const [rampUp, setRampUp] = useState("");
  const [thresholds, setThresholds] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<IterationRow[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const pickFile = async (picked: File) => {
    setError(undefined);
    if (picked.size > MAX_ITERATION_DATA_BYTES) {
      setError(`${picked.name} is larger than ${MAX_ITERATION_DATA_BYTES / 1024 / 1024} MB`);
      return;
    }
    try {
      const parsed = parseIterationData(await picked.text(), picked.name);
      setFile(picked);
      setRows(parsed);
      setIterations(String(parsed.length));
    } catch (failure) {
      setError(`Cannot use ${picked.name}: ${failure instanceof Error ? failure.message : String(failure)}`);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const iterationCount = Number(iterations);
    const concurrencyCount = Number(concurrency);
    const durationMs = secondsToMs(duration);
    const rampUpMs = secondsToMs(rampUp);
    if (!Number.isInteger(iterationCount) || iterationCount < 1 || iterationCount > MAX_ITERATIONS) {
      setError(`Iterations must be a whole number from 1 to ${MAX_ITERATIONS}`);
      return;
    }
    if (!Number.isInteger(concurrencyCount) || concurrencyCount < 1 || concurrencyCount > 1000) {
      setError("Concurrency must be a whole number from 1 to 1000");
      return;
    }
    if (durationMs === null || rampUpMs === null) {
      setError("Duration and ramp-up are positive seconds, or blank");
      return;
    }
    const request: LoadRunRequest = {
      iterations: iterationCount,
      concurrency: concurrencyCount,
      thresholds: thresholds.split("\n").map((line) => line.trim()).filter((line) => line !== ""),
      ...(rows === undefined ? {} : { rows }),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(rampUpMs === undefined ? {} : { rampUpMs }),
    };
    setError(undefined);
    onStart(request);
    onClose();
  };

  const clearFile = () => {
    setFile(null);
    setRows(undefined);
  };

  const iterationsHint = rows === undefined ? "Total runs to make" : `Set from ${rows.length} data rows`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Load run"
      size="md"
      footer={
        <ModalFormFooter
          formId={formId}
          submitLabel="Start load run"
          onCancel={onClose}
          busy={false}
          canSubmit
        />
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-6 p-5">
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
          Runs the workflow many times in parallel and reports per-step latency
          percentiles and throughput. Only the first failure of each step is kept.
        </p>

        {error !== undefined && (
          <div
            role="alert"
            className="rounded-sm border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error dark:bg-status-error/20"
          >
            {error}
          </div>
        )}

        <fieldset>
          <legend className={SECTION_HEADING}>Load</legend>
          <div className="grid grid-cols-2 gap-x-4">
            <FormField
              label="Iterations"
              hint={iterationsHint}
            >
              <Input aria-label="Iterations" size="sm" type="number" min={1} value={iterations} onChange={(event) => setIterations(event.target.value)} />
            </FormField>
            <FormField label="Concurrency" hint="Runs in flight at once">
              <Input aria-label="Concurrency" size="sm" type="number" min={1} value={concurrency} onChange={(event) => setConcurrency(event.target.value)} />
            </FormField>
          </div>
        </fieldset>

        <fieldset>
          <legend className={SECTION_HEADING}>Pacing · optional</legend>
          <div className="grid grid-cols-2 gap-x-4">
            <FormField label="Duration (s)" hint="Stop starting runs after this long">
              <Input aria-label="Duration (s)" size="sm" type="number" min={0} placeholder="No limit" value={duration} onChange={(event) => setDuration(event.target.value)} />
            </FormField>
            <FormField label="Ramp-up (s)" hint="Grow from 1 to full concurrency">
              <Input aria-label="Ramp-up (s)" size="sm" type="number" min={0} placeholder="Start at full concurrency" value={rampUp} onChange={(event) => setRampUp(event.target.value)} />
            </FormField>
          </div>
        </fieldset>

        <fieldset>
          <legend className={SECTION_HEADING}>Pass criteria · optional</legend>
          <FormField label="Thresholds" hint="One per line. A breach fails the run.">
            <TextArea
              aria-label="Thresholds"
              size="sm"
              rows={3}
              placeholder={"p95<500\nerrors<1%"}
              className="font-mono"
              value={thresholds}
              onChange={(event) => setThresholds(event.target.value)}
            />
          </FormField>
        </fieldset>

        <fieldset>
          <legend className={SECTION_HEADING}>Data · optional</legend>
          <DataFileRow file={file} rows={rows} onSelect={(picked) => void pickFile(picked)} onClear={clearFile} />
        </fieldset>
      </form>
    </Modal>
  );
}
