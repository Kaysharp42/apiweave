import { useId } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { FormFieldProps } from '../../types';

/**
 * FormField — Reusable form field wrapper with label, hint, and error.
 *
 * Used by: NodeModal, AssertionConfig, DelayConfig, MergeConfig,
 * VariablesPanel, and all forms across the app.
 *
 * @param label — field label
 * @param hint — optional helper text below the field
 * @param error — optional error message (turns border red)
 * @param required — show required indicator
 * @param children — the input element (Input, TextArea, Select, etc.)
 * @param className — extra classes on the wrapper
 */
export function FormField({
  label,
  hint,
  error,
  required = false,
  children,
  className = '',
}: FormFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className={`form-control w-full ${className}`}>
      {label && (
        <label htmlFor={id} className="label py-1 px-0">
          <span className="label-text text-xs font-medium text-text-primary dark:text-text-primary-dark">
            {label}
            {required && <span className="text-status-error ml-0.5" aria-hidden="true">*</span>}
          </span>
        </label>
      )}

      <div id={id} aria-describedby={hint || error ? hintId : undefined}>
        {children}
      </div>

      {(error || hint) && (
        <label className="label py-1 px-0" id={hintId}>
          {error ? (
            <span className="label-text-alt text-xs text-status-error flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
              {error}
            </span>
          ) : (
            <span className="label-text-alt text-xs text-text-muted dark:text-text-muted-dark">{hint}</span>
          )}
        </label>
      )}
    </div>
  );
}
