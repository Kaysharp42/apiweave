import React from 'react';

export interface DividerProps extends React.HTMLAttributes<HTMLDivElement> {
  direction?: 'horizontal' | 'vertical';
  text?: string;
}

export function Divider({
  direction = 'horizontal',
  text,
  className = '',
  ...rest
}: DividerProps) {
  if (direction === 'vertical') {
    return (
      <div
        className={['divider divider-horizontal', className].filter(Boolean).join(' ')}
        {...rest}
      >
        {text}
      </div>
    );
  }

  return (
    <div className={['divider', className].filter(Boolean).join(' ')} {...rest}>
      {text}
    </div>
  );
}
