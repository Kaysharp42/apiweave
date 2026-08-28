import { Braces } from "lucide-react";
import { toast } from "sonner";
import { IconButton } from "../atoms/IconButton";
import { tryFormatJson } from "../../utils/jsonFormat";
import type { BeautifyButtonProps } from "../../types";

export function BeautifyButton({
  value,
  onChange,
  className = "",
}: BeautifyButtonProps) {
  const handleBeautifyJson = () => {
    // Format-only, never minify: the button says "Format JSON", so a second
    // click must be a no-op rather than collapsing the body back to one line.
    const { success, result } = tryFormatJson(value);
    if (success) {
      onChange(result);
    } else {
      toast.error("Invalid JSON -- cannot format");
    }
  };

  return (
    <IconButton
      tooltip="Format JSON"
      size="sm"
      variant="ghost"
      className={className}
      onClick={handleBeautifyJson}
    >
      <Braces className="w-4 h-4" />
    </IconButton>
  );
}
