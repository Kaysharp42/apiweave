import React from 'react';

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  type?: 'spinner' | 'dots' | 'ring' | 'ball' | 'bars' | 'infinity';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  color?: string;
}

export function Spinner({
  type = 'spinner',
  size = 'md',
  color = '',
  className = '',
  ...rest
}: SpinnerProps) {
  const typeClass: Record<string, string> = {
    spinner: 'loading-spinner',
    dots: 'loading-dots',
    ring: 'loading-ring',
    ball: 'loading-ball',
    bars: 'loading-bars',
    infinity: 'loading-infinity',
  };

  const sizeClass: Record<string, string> = {
    xs: 'loading-xs',
    sm: 'loading-sm',
    md: 'loading-md',
    lg: 'loading-lg',
  };

  return (
    <span
      className={['loading', typeClass[type] ?? 'loading-spinner', sizeClass[size] ?? 'loading-md', color, className].filter(Boolean).join(' ')}
      role="status"
      aria-label="Loading"
      {...rest}
    />
  );
}
