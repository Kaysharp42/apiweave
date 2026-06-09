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
      className={className}
      {...rest}
    >
      {children}
    </Tippy>
  );
}
