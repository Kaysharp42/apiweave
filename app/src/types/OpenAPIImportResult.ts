import type { Workflow } from "./Workflow";

export interface OpenAPIImportResult {
  workflows: Workflow[];
  errors: string[];
  count: number;
}
