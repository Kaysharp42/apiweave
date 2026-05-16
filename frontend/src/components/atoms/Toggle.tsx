import React, { useId } from 'react';

export interface ToggleProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  checked?: boolean;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  variant?: 'primary' | 'secondary' | 'success' | 'error' | 'warning';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  disabled?: boolean;
  id?: string;
}

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
          className={['toggle', variantClass[variant] ?? 'toggle-primary', sizeClass[size] ?? 'toggle-sm', className].filter(Boolean).join(' ')}
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          {...rest}
        />
      </label>
    </div>
  );
}
