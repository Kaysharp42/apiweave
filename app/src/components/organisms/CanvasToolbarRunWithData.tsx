import { useRef } from "react";
import { FileSpreadsheet } from "lucide-react";
import { IconButton } from "../atoms/IconButton";
import type { CanvasToolbarRunWithDataProps } from "../../types";

/** Pick a CSV or JSON file to run the workflow once per row. */
export function CanvasToolbarRunWithData({
  onRunWithData,
  isRunning,
}: CanvasToolbarRunWithDataProps) {
  const dataFileRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <IconButton
        onClick={() => dataFileRef.current?.click()}
        disabled={isRunning}
        tooltip="Run with data… (CSV or JSON, once per row)"
        aria-label="Run with data"
        variant="ghost"
        size="sm"
      >
        <FileSpreadsheet className="w-4 h-4" />
      </IconButton>
      <input
        ref={dataFileRef}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        className="hidden"
        aria-label="Data file to run with"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so picking the same file again still fires.
          event.target.value = "";
          if (file) onRunWithData(file);
        }}
      />
    </>
  );
}
