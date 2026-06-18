import Tippy from '@tippyjs/react';
import type { TooltipProps } from '../../types';

export function Tooltip({
  children,
  content,
  placement = 'top',
  delay = 300,
  disabled = false,
  className = '',
  ...rest
}: TooltipProps) {
  if (!content || disabled) return children;

  return (
    <Tippy
      content={content}
      placement={placement}
      delay={[delay, 0]}
      className={[
        'rounded-sm border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised px-2 py-1 font-sans text-xs text-text-primary dark:text-text-primary-dark shadow-popover',
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </Tippy>
  );
}
