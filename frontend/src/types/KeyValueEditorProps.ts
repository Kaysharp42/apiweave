import type { KeyValuePair } from "./KeyValuePair";

export type { KeyValuePair } from "./KeyValuePair";

export interface KeyValueEditorProps {
  pairs?: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  readOnly?: boolean;
  className?: string;
}
