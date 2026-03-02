import React from 'react';
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import { buildIconButtonClassName } from '../../utils/iconButtonStyles';

/**
 * IconButton — Icon-only button with tooltip.
 *
 * Replaces the scattered `<button onClick><Icon /></button>` patterns
 * with a consistent, accessible, tooltip-bearing component.
 *
 * @param {string} tooltip     — tooltip text (required for a11y)
 * @param {'xs'|'sm'|'md'|'lg'} size
 * @param {'ghost'|'primary'|'error'|'warning'|'success'} variant
 */
export default function IconButton({
  children,
  tooltip,
  size = 'sm',
  variant = 'ghost',
  className = '',
  disabled = false,
  onClick,
  ...rest
}) {
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
