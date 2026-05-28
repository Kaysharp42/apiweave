import type { IconSwitchProps } from '../../types';

const intentClassName: Record<NonNullable<IconSwitchProps['intent']>, string> = {
  primary: 'bg-primary/20 dark:bg-cyan-400/20 border-primary/30 dark:border-cyan-400/40',
  success: 'bg-status-success/20 border-status-success/40',
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
        'relative inline-flex h-7 w-14 flex-shrink-0 items-center rounded-full border p-0.5 transition-all duration-200',
        'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-surface-raised dark:focus:ring-offset-surface-dark-raised',
        checked ? intentClassName[intent] : 'bg-surface-overlay dark:bg-surface-dark-overlay border-border dark:border-border-dark',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:shadow-sm',
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
          'pointer-events-none z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white text-text-primary shadow transition-transform duration-200 dark:bg-surface-dark-raised dark:text-text-primary-dark',
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
