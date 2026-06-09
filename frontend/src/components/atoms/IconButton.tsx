import Tippy from '@tippyjs/react';
import { buildIconButtonClassName } from '../../utils/iconButtonStyles';
import type { IconButtonProps } from '../../types';

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
