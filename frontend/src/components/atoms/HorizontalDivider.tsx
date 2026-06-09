import type { HorizontalDividerProps } from '../../types';

export function HorizontalDivider({ className = '', ...rest }: HorizontalDividerProps) {
  return (
    <hr
      className={['h-px w-full bg-[var(--aw-border)] border-0', className].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}
