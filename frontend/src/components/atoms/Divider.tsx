import type { DividerProps } from '../../types';

export function Divider({
  direction = 'horizontal',
  text,
  className = '',
  ...rest
}: DividerProps) {
  if (direction === 'vertical') {
    return (
      <div
        className={['divider divider-horizontal before:bg-border after:bg-border dark:before:bg-border-dark dark:after:bg-border-dark', className].filter(Boolean).join(' ')}
        {...rest}
      >
        {text}
      </div>
    );
  }

  return (
    <div className={['divider before:bg-border after:bg-border dark:before:bg-border-dark dark:after:bg-border-dark', className].filter(Boolean).join(' ')} {...rest}>
      {text}
    </div>
  );
}
