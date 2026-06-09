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
    primary: 'toggle-primary',
    secondary: 'toggle-secondary',
    success: 'toggle-success',
    error: 'toggle-error',
    warning: 'toggle-warning',
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
          <span className="label-text text-text-primary dark:text-text-primary-dark">
            {label}
          </span>
        )}
        <input
          id={id}
          type="checkbox"
          className={[
            'toggle',
            variantClass[variant] ?? 'toggle-primary',
            sizeClass[size] ?? 'toggle-sm',
            'focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]',
            'transition-[outline] duration-[var(--aw-transition-fast)] ease-in-out',
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
