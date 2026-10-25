import { Badge } from "../atoms/Badge";
import { MergeValueControl } from "./MergeValueControl";
import { useMergeValueDraft } from "../../hooks/useMergeValueDraft";
import { draftTextOf } from "../../utils/draftTextOf";
import type { MergeResultEditorProps } from "../../types";

/**
 * The Result cell of one conflicted field: what the merge would write now — the
 * remote copy's until a decision arrives — editable as a value of the user's
 * own. Empty or unparseable text decides nothing; the field goes back to
 * unresolved and the error is said in place.
 */
export function MergeResultEditor({
  label,
  value,
  text: textValue,
  long,
  resolved,
  disabled,
  onChange,
  onClear,
  onInvalidChange,
}: MergeResultEditorProps) {
  const draft = useMergeValueDraft({
    shown: draftTextOf(value, textValue),
    textValue,
    onChange,
    onClear,
    onInvalidChange,
  });
  return (
    <div className="space-y-1">
      <Badge variant={resolved ? "success" : "warning"} size="xs">
        {resolved ? "Resolved" : "Unresolved"}
      </Badge>
      <MergeValueControl
        label={label}
        value={value}
        text={draft.text}
        long={long}
        textValue={textValue}
        disabled={disabled}
        error={draft.error}
        onChange={draft.commit}
      />
    </div>
  );
}
