import type { KeyValuePair } from "@shared/types/KeyValuePair";

export type { KeyValuePair } from "@shared/types/KeyValuePair";

export interface KeyValueEditorProps {
  pairs?: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  readOnly?: boolean;
  className?: string;
}
