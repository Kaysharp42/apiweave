const SIZE_CLASS_MAP = {
  xs: 'h-7 w-7',
  sm: 'h-8 w-8',
  md: 'h-9 w-9',
  lg: 'h-10 w-10',
};

const VARIANT_CLASS_MAP = {
  ghost:
    'border border-transparent text-text-secondary dark:text-text-secondary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay hover:text-text-primary dark:hover:text-text-primary-dark',
  primary:
    'bg-primary dark:bg-[#22d3ee] text-white border border-primary dark:border-[#22d3ee] hover:bg-primary-hover dark:hover:bg-cyan-400 shadow-sm hover:shadow-md',
  error:
    'bg-red-600 border border-red-600 text-white hover:bg-red-700 shadow-sm hover:shadow-md',
  warning:
    'bg-yellow-600 border border-yellow-600 text-white hover:bg-yellow-700 shadow-sm hover:shadow-md',
  success:
    'bg-green-600 border border-green-600 text-white hover:bg-green-700 shadow-sm hover:shadow-md',
};

export const resolveIconButtonSizeClass = (size) => SIZE_CLASS_MAP[size] || SIZE_CLASS_MAP.sm;

export const resolveIconButtonVariantClass = (variant) =>
  VARIANT_CLASS_MAP[variant] || VARIANT_CLASS_MAP.ghost;

export const buildIconButtonClassName = ({
  size = 'sm',
  variant = 'ghost',
  disabled = false,
  className = '',
} = {}) =>
  [
    'inline-flex items-center justify-center rounded transition',
    resolveIconButtonSizeClass(size),
    resolveIconButtonVariantClass(variant),
    disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
    className,
  ]
    .filter(Boolean)
    .join(' ');
