import React from 'react';

export interface HorizontalDividerProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export function HorizontalDivider({ className = '', ...rest }: HorizontalDividerProps) {
  return (
    <div
      className={['h-px w-full bg-border dark:bg-border-dark', className].filter(Boolean).join(' ')}
      role="separator"
      {...rest}
    />
  );
}
