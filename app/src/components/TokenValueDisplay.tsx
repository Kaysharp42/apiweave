import { useState, useRef, useCallback } from "react";
import { Copy, Check, AlertTriangle, Eye, EyeOff } from "lucide-react";
import { Button } from "./atoms/Button";
import type { TokenValueDisplayProps } from "../types/TokenValueDisplayProps";

/**
 * TokenValueDisplay — shows a one-time service token value with copy
 * functionality and a prominent warning that it won't be shown again.
 *
 * The token value is masked by default and revealed on click.
 * After dismissal, the value is NOT retained by this component.
 */
export function TokenValueDisplay({
  tokenValue,
  onDismiss,
  className = "",
}: TokenValueDisplayProps) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(tokenValue);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in non-secure contexts
    }
  }, [tokenValue]);

  const handleDismiss = useCallback(() => {
    setRevealed(false);
    onDismiss();
  }, [onDismiss]);

  return (
    <div
      className={[
        "rounded border border-status-warning/40 bg-status-warning/5 p-4",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Warning banner */}
      <div className="flex items-start gap-2 mb-3">
        <AlertTriangle
          className="w-5 h-5 text-status-warning flex-shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <div>
          <p className="text-sm font-semibold text-status-warning">
            Copy this token now
          </p>
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark mt-0.5">
            This value is shown only once. After you close this, it cannot be
            retrieved again.
          </p>
        </div>
      </div>

      {/* Token value display */}
      <div className="flex items-center gap-2">
        <code
          className={[
            "flex-1 px-3 py-2 rounded text-sm font-mono break-all",
            "bg-surface dark:bg-surface-dark",
            "border border-border dark:border-border-dark",
            "text-text-primary dark:text-text-primary-dark",
            revealed ? "" : "select-none",
          ].join(" ")}
          aria-label={revealed ? "Token value" : "Token value (hidden)"}
        >
          {revealed ? tokenValue : "••••••••••••••••"}
        </code>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRevealed(!revealed)}
          title={revealed ? "Hide token" : "Reveal token"}
        >
          {revealed ? (
            <EyeOff className="w-4 h-4" aria-hidden="true" />
          ) : (
            <Eye className="w-4 h-4" aria-hidden="true" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          title="Copy token to clipboard"
        >
          {copied ? (
            <Check className="w-4 h-4 text-status-success" aria-hidden="true" />
          ) : (
            <Copy className="w-4 h-4" aria-hidden="true" />
          )}
        </Button>
      </div>

      {/* Dismiss button */}
      <div className="mt-3 flex justify-end">
        <Button variant="outline" size="sm" onClick={handleDismiss}>
          I&apos;ve copied the token
        </Button>
      </div>
    </div>
  );
}
