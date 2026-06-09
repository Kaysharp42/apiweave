type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';
type IconButtonVariant = 'ghost' | 'primary' | 'error' | 'warning' | 'success';

const SIZE_CLASS_MAP: Record<ButtonSize, string> = {
  xs: 'h-7 w-7',
  sm: 'h-8 w-8',
  md: 'h-9 w-9',
  lg: 'h-10 w-10',
};

const VARIANT_CLASS_MAP: Record<IconButtonVariant, string> = {
  ghost:
    'border border-transparent text-text-secondary dark:text-text-secondary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay hover:text-text-primary dark:hover:text-text-primary-dark active:bg-surface-overlay dark:active:bg-surface-dark-overlay active:text-text-primary dark:active:text-text-primary-dark',
  primary:
    'bg-[var(--aw-primary)] dark:bg-[var(--aw-primary-light)] text-white dark:text-primary-dark border border-[var(--aw-primary)] dark:border-[var(--aw-primary-light)] hover:bg-[var(--aw-primary-hover)] dark:hover:bg-[var(--aw-primary-hover)] active:brightness-95 dark:active:brightness-105 shadow-raised hover:shadow-overlay',
  error:
    'bg-status-error dark:bg-[var(--aw-status-error)] text-white dark:text-red-950 border border-status-error dark:border-[var(--aw-status-error)] hover:brightness-95 dark:hover:brightness-105 active:brightness-90 dark:active:brightness-110 shadow-raised hover:shadow-overlay',
  warning:
    'bg-status-warning dark:bg-[var(--aw-status-warning)] text-white dark:text-amber-950 border border-status-warning dark:border-[var(--aw-status-warning)] hover:brightness-95 dark:hover:brightness-105 active:brightness-90 dark:active:brightness-110 shadow-raised hover:shadow-overlay',
  success:
    'bg-status-success dark:bg-[var(--aw-status-success)] text-white dark:text-green-950 border border-status-success dark:border-[var(--aw-status-success)] hover:brightness-95 dark:hover:brightness-105 active:brightness-90 dark:active:brightness-110 shadow-raised hover:shadow-overlay',
};

export const resolveIconButtonSizeClass = (size: ButtonSize): string => SIZE_CLASS_MAP[size] || SIZE_CLASS_MAP.sm;

export const resolveIconButtonVariantClass = (variant: IconButtonVariant): string =>
  VARIANT_CLASS_MAP[variant] || VARIANT_CLASS_MAP.ghost;

export const buildIconButtonClassName = ({
  size = 'sm',
  variant = 'ghost',
  disabled = false,
  className = '',
}: {
  size?: ButtonSize;
  variant?: IconButtonVariant;
  disabled?: boolean;
  className?: string;
} = {}): string =>
  [
    'inline-flex items-center justify-center rounded',
    'transition-[box-shadow,background-color,color,filter] duration-[var(--aw-transition-fast)] ease-in-out',
    'focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]',
    resolveIconButtonSizeClass(size),
    resolveIconButtonVariantClass(variant),
    disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer',
    className,
  ]
    .filter(Boolean)
    .join(' ');
