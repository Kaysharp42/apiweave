import type { IconSwitchProps } from '../../types';

const intentClassName: Record<NonNullable<IconSwitchProps['intent']>, string> = {
  primary: 'bg-[var(--aw-primary)]/20 dark:bg-[var(--aw-primary-light)]/20 border-[var(--aw-primary)]/30 dark:border-[var(--aw-primary-light)]/40',
  success: 'bg-status-success/20 dark:bg-[var(--aw-status-success)]/20 border-status-success/40 dark:border-[var(--aw-status-success)]/40',
};

export function IconSwitch({
  checked,
  onCheckedChange,
  checkedIcon,
  uncheckedIcon,
  checkedLabel,
  uncheckedLabel,
  intent = 'primary',
  disabled = false,
  className = '',
  ...rest
}: IconSwitchProps) {
  const label = checked ? checkedLabel : uncheckedLabel;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={[
        'relative inline-flex h-7 w-14 flex-shrink-0 items-center rounded-full border p-0.5',
        'transition-[box-shadow,background-color,border-color] duration-[var(--aw-transition-fast)] ease-in-out',
        'focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]',
        checked ? intentClassName[intent] : 'bg-surface-overlay dark:bg-surface-dark-overlay border-border dark:border-border-dark',
        disabled ? 'cursor-not-allowed opacity-50 pointer-events-none' : 'cursor-pointer hover:shadow-raised',
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      <span className="pointer-events-none absolute left-2 text-amber-500 dark:text-amber-300 opacity-70">
        {uncheckedIcon}
      </span>
      <span className="pointer-events-none absolute right-2 text-cyan-500 dark:text-cyan-300 opacity-80">
        {checkedIcon}
      </span>
      <span
        className={[
          'pointer-events-none z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white text-text-primary shadow transition-transform duration-[var(--aw-transition-fast)] ease-in-out dark:bg-surface-dark-raised dark:text-text-primary-dark',
          checked ? 'translate-x-7' : 'translate-x-0',
        ].join(' ')}
      >
        <span className={checked ? 'text-cyan-500 dark:text-cyan-300' : 'text-amber-500'}>
          {checked ? checkedIcon : uncheckedIcon}
        </span>
      </span>
    </button>
  );
}
