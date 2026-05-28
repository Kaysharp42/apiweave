import React from 'react';

export interface HorizontalDividerProps extends React.HTMLAttributes<HTMLHRElement> {
  className?: string;
}

export function HorizontalDivider({ className = '', ...rest }: HorizontalDividerProps) {
  return (
    <hr
      className={['h-px w-full bg-border dark:bg-border-dark', className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}
