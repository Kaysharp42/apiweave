import React from 'react';
import Tippy from '@tippyjs/react';
import { buildIconButtonClassName } from '../../utils/iconButtonStyles';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tooltip?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'primary' | 'error' | 'warning' | 'success';
  disabled?: boolean;
  children?: React.ReactNode;
}

export function IconButton({
  children,
  tooltip,
  size = 'sm',
  variant = 'ghost',
  className = '',
  disabled = false,
  onClick,
  ...rest
}: IconButtonProps) {
  const buttonClassName = buildIconButtonClassName({
    size,
    variant,
    disabled,
    className,
  });

  const button = (
    <button
      type="button"
      className={buttonClassName}
      disabled={disabled}
      onClick={onClick}
      aria-label={tooltip}
      {...rest}
    >
      {children}
    </button>
  );

  if (!tooltip) return button;

  return (
    <Tippy content={tooltip} placement="top" delay={[300, 0]}>
      {button}
    </Tippy>
  );
}
