import React from 'react';
import Tippy from '@tippyjs/react';

export interface TooltipProps {
  children: React.ReactElement;
  content?: string | React.ReactNode;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  disabled?: boolean;
  className?: string;
}

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
