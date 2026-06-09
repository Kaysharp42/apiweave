import type { ReactElement, ReactNode } from 'react';

export interface TooltipProps {
  children: ReactElement;
  content?: string | ReactNode;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  disabled?: boolean;
  className?: string;
}
