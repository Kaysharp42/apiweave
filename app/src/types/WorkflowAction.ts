import type { JsonValue } from "@shared/types/JsonValue";
import type { Project } from "./Project";
import type { WorkflowVariables } from "./WorkflowVariables";

export type WorkflowAction =
  | { type: "set-variables"; value: React.SetStateAction<WorkflowVariables> }
  | { type: "set-collections"; value: Project[] }
  | { type: "set-loading-collections"; value: boolean }
  | {
      type: "set-current-collection-id";
      value: React.SetStateAction<string | null>;
    }
  | { type: "update-variable"; varName: string; varValue: JsonValue }
  | { type: "delete-variable"; varName: string }
  | { type: "delete-variables"; varNames: string[] }
  | { type: "update-variables"; value: WorkflowVariables }
  | { type: "register-extractors"; value: WorkflowVariables };
