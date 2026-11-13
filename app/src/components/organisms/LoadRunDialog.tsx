import { useId, useState } from "react";
import { Input } from "../atoms/Input";
import { TextArea } from "../atoms/TextArea";
import { FormField } from "../molecules/FormField";
import { ImportFilePicker } from "../molecules/ImportFilePicker";
import { Modal } from "../molecules/Modal";
import { ModalFormFooter } from "../molecules/ModalFormFooter";
import {
  MAX_ITERATION_DATA_BYTES,
  parseIterationData,
  type IterationRow,
} from "@shared/iteration-data/iterationData";
import type { LoadRunDialogProps, LoadRunRequest } from "../../types";

const MAX_ITERATIONS = 100_000;

/** Whole seconds typed in a field, as milliseconds; undefined when blank, null when not a positive number. */
function secondsToMs(text: string): number | undefined | null {
  if (text.trim() === "") return undefined;
  const seconds = Number(text);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
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
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
          Runs the workflow many times at once and reports per-step latency
          percentiles and throughput. Only the first failure of each step is kept.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Iterations" hint="Total runs; a data file's rows are reused in order">
            <Input aria-label="Iterations" type="number" min={1} value={iterations} onChange={(event) => setIterations(event.target.value)} />
          </FormField>
          <FormField label="Concurrency" hint="Runs in flight at once">
            <Input aria-label="Concurrency" type="number" min={1} value={concurrency} onChange={(event) => setConcurrency(event.target.value)} />
          </FormField>
          <FormField label="Duration (s)" hint="Optional: stop starting runs after this long">
            <Input aria-label="Duration (s)" type="number" min={0} value={duration} onChange={(event) => setDuration(event.target.value)} />
          </FormField>
          <FormField label="Ramp-up (s)" hint="Optional: grow from 1 to the concurrency over this long">
            <Input aria-label="Ramp-up (s)" type="number" min={0} value={rampUp} onChange={(event) => setRampUp(event.target.value)} />
          </FormField>
        </div>
        <FormField label="Thresholds" hint="One per line, e.g. p95<500 or errors<1%. A breach fails the run.">
          <TextArea aria-label="Thresholds" rows={3} value={thresholds} onChange={(event) => setThresholds(event.target.value)} />
        </FormField>
        <ImportFilePicker
          title="Data file (optional)"
          hint="CSV or JSON: each row is {{data.<column>}}"
          accept=".csv,.json,text/csv,application/json"
          inputAriaLabel="Data file for the load run"
          file={file}
          onFileSelect={(picked) => void pickFile(picked)}
        />
        {error !== undefined && (
          <p role="alert" className="text-sm text-status-error">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
