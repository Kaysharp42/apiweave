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
        className={[
          'inline-flex h-full min-h-4 w-px items-center justify-center bg-border dark:bg-border-dark',
          text && 'bg-transparent text-xs text-text-muted dark:text-text-muted-dark before:h-full before:w-px before:bg-border dark:before:bg-border-dark after:h-full after:w-px after:bg-border dark:after:bg-border-dark',
          className,
        ].filter(Boolean).join(' ')}
        {...rest}
      >
        {text && <span className="px-1 font-mono text-[10px] uppercase tracking-wide">{text}</span>}
      </div>
    );
  }

  return (
    <div
      className={[
        'flex w-full items-center text-xs text-text-muted dark:text-text-muted-dark',
        text ? 'gap-2' : 'h-px bg-border dark:bg-border-dark',
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {text && (
        <>
          <span className="h-px flex-1 bg-border dark:bg-border-dark" />
          <span className="font-mono text-[10px] uppercase tracking-wide">{text}</span>
          <span className="h-px flex-1 bg-border dark:bg-border-dark" />
        </>
      )}
    </div>
  );
}
