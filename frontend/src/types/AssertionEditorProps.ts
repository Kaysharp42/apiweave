import type { AssertionValue } from "./AssertionValue";

export interface AssertionEditorProps {
  value: AssertionValue | null;
  onChange: (value: AssertionValue) => void;
  onCancel: () => void;
  onSave: () => void;
}
