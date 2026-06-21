import { useId } from 'react';
import type { ToggleProps } from '../../types';

export function Toggle({
  label,
  checked,
  onChange,
  variant = 'primary',
  size = 'sm',
  disabled = false,
  className = '',
  id: externalId,
  ...rest
}: ToggleProps) {
  const autoId = useId();
  const id = externalId ?? autoId;

  const variantClass: Record<string, string> = {
    primary: 'checked:bg-primary dark:checked:bg-primary-light checked:border-primary dark:checked:border-primary-light',
    secondary: 'checked:bg-text-secondary dark:checked:bg-text-secondary-dark checked:border-text-secondary dark:checked:border-text-secondary-dark',
    success: 'checked:bg-status-success dark:checked:bg-[var(--aw-status-success)] checked:border-status-success dark:checked:border-[var(--aw-status-success)]',
    error: 'checked:bg-status-error dark:checked:bg-[var(--aw-status-error)] checked:border-status-error dark:checked:border-[var(--aw-status-error)]',
    warning: 'checked:bg-status-warning dark:checked:bg-[var(--aw-status-warning)] checked:border-status-warning dark:checked:border-[var(--aw-status-warning)]',
  };

  const sizeClass: Record<string, string> = {
    xs: 'toggle-xs',
    sm: 'toggle-sm',
    md: '',
    lg: 'toggle-lg',
  };

  return (
    <div className="form-control">
      <label htmlFor={id} className="label cursor-pointer gap-2">
        {label && (
          <span className="label-text text-sm font-medium text-text-primary dark:text-text-primary-dark">
            {label}
          </span>
        )}
        <input
          id={id}
          type="checkbox"
          className={[
            'toggle rounded-full border-border bg-surface-overlay dark:border-border-dark dark:bg-surface-dark-overlay',
            variantClass[variant] ?? 'toggle-primary',
            sizeClass[size] ?? 'toggle-sm',
            'focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]',
            'transition-[background-color,border-color,outline] duration-[var(--aw-transition-fast)] ease-in-out',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
            className,
          ].filter(Boolean).join(' ')}
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          {...rest}
        />
      </label>
    </div>
  );
}
