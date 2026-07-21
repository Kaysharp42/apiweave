import React, { useId } from "react";
import type { InputProps } from "../../types";

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      size = "md",
      className = "",
      id: externalId,
      ...rest
    },
    ref,
  ) => {
    const autoId = useId();
    const id = externalId ?? autoId;

    const sizeClass: Record<string, string> = {
      xs: "h-7 px-2 text-xs",
      sm: "h-8 px-2.5 text-sm",
      md: "h-10 px-3 text-sm",
      lg: "h-11 px-3.5 text-base",
    };

    return (
      <div className="form-control w-full">
        {label && (
          <label htmlFor={id} className="label px-0 py-1">
            <span className="label-text text-sm font-medium text-text-primary dark:text-text-primary-dark">
              {label}
            </span>
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={[
            "w-full rounded-sm border",
            "bg-surface-raised dark:bg-surface-dark-raised",
            "text-text-primary dark:text-text-primary-dark",
            "border-border dark:border-border-dark",
            "placeholder:text-text-muted dark:placeholder:text-text-muted-dark",
            "focus:border-primary dark:focus:border-primary-light",
            "focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]",
            "transition-[border-color,outline,background-color] duration-[var(--aw-transition-fast)] ease-in-out",
            sizeClass[size] ?? "",
            error && "border-status-error dark:border-[var(--aw-status-error)]",
            className,
          ]
            .filter(Boolean)
            .join(" ")}
          aria-invalid={!!error}
          aria-describedby={
            error ? `${id}-error` : helperText ? `${id}-helper` : undefined
          }
          {...rest}
        />
        {error && (
          <label className="label px-0 py-1" id={`${id}-error`}>
            <span className="label-text-alt text-xs text-status-error dark:text-[var(--aw-status-error)]">
              {error}
            </span>
          </label>
        )}
        {!error && helperText && (
          <label className="label px-0 py-1" id={`${id}-helper`}>
            <span className="label-text-alt text-xs text-text-muted dark:text-text-muted-dark">
              {helperText}
            </span>
          </label>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";
