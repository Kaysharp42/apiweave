import type { ReportFormat } from "@shared/types/ReportFormat";

/**
 * Saves text as a file through a browser download, which Electron answers
 * with the native Save dialog. Every export in the app leaves this way.
 */
export function downloadTextFile(
  fileName: string,
  content: string,
  type: string,
): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const REPORT_FILE: Record<ReportFormat, { extension: string; type: string }> = {
  junit: { extension: "xml", type: "application/xml" },
  html: { extension: "html", type: "text/html" },
};

/** Saves a run report built by `runs.report` or `projects.runReport`. */
export function downloadReport(
  baseName: string,
  format: ReportFormat,
  content: string,
): void {
  const { extension, type } = REPORT_FILE[format];
  downloadTextFile(`${baseName}.${extension}`, content, type);
}
