import { useEffect, useRef, useState } from "react";
import { Badge } from "../atoms/Badge";
import { MergeValueControl } from "./MergeValueControl";
import { isLongValue, parseValueText, valueText } from "../../utils/mergeValues";
import type { MergeResultEditorProps } from "../../types";

/**
 * The Result cell of one conflicted field. It shows the value the merge would
 * write now — the remote copy's until a decision arrives — and lets the user
 * write their own. A text value is edited as itself and stays text; anything
 * else is edited as JSON, so `42`, `true` and `null` stay the types they are,
 * and text that does not parse is refused in place rather than decided.
 */
export function MergeResultEditor({
  label,
  value,
  resolved,
  disabled,
  onChange,
}: MergeResultEditorProps) {
  const textValue = typeof value === "string";
  const long = isLongValue(value);
  const shown = textValue ? value : value === undefined ? "" : valueText(value);
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  // The text of the last value this editor sent, so echoing the server's answer
  // does not move the caret under the user's hands.
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (shown === sent.current) return;
    setText(shown);
    setError(null);
  }, [shown]);

  const commit = (next: string): void => {
    setText(next);
    if (textValue) {
      setError(null);
      sent.current = next;
      onChange(next);
      return;
    }
    const parsed = parseValueText(next);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    sent.current = valueText(parsed.value);
    onChange(parsed.value);
  };

  return (
    <div className="space-y-1">
      <Badge variant={resolved ? "success" : "warning"} size="xs">
        {resolved ? "Resolved" : "Unresolved"}
      </Badge>
      <MergeValueControl
        label={label}
        value={value}
        text={text}
        long={long}
        textValue={textValue}
        disabled={disabled}
        error={error}
        onChange={commit}
      />
    </div>
  );
}
