import { Braces } from "lucide-react";
import { toast } from "sonner";
import { IconButton } from "../atoms/IconButton";
import { formatOrMinifyJson } from "../../utils/jsonFormat";
import type { BeautifyButtonProps } from "../../types";

export function BeautifyButton({
  value,
  onChange,
  className = "",
}: BeautifyButtonProps) {
  const handleBeautifyJson = () => {
    const { success, result } = formatOrMinifyJson(value);
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
