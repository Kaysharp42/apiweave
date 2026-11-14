import type { ReactNode } from "react";
import type { StreamFinishCondition } from "@shared/types/StreamFinishCondition";

export interface StreamFinishConditionsEditorProps {
  readonly conditions: readonly StreamFinishCondition[];
  readonly onChange: (conditions: StreamFinishCondition[]) => void;
  /** What a path addresses in this protocol's normalized message. */
  readonly hint: ReactNode;
  readonly pathPlaceholder?: string;
}
