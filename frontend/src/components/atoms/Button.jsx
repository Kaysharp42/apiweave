import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Button — FlowTest-inspired button system with filled/outlined/ghost variants.
 *
 * Replaces DaisyUI button patterns with custom Tailwind composition for better
 * control over shadows, hover states, and dark mode colors.
 *
 * @param {'primary'|'secondary'|'ghost'} variant — Button style: filled, outlined, or minimal
 * @param {'default'|'success'|'error'|'warning'|'info'} intent — Semantic color intent
 * @param {'xs'|'sm'|'md'|'lg'} size
 * @param {boolean} loading
 * @param {boolean} disabled
 * @param {boolean} fullWidth
 * @param {string} className  — escape hatch for one-off overrides
 */
const Button = React.forwardRef(function Button(
  {
    children,
    variant = 'primary',
    intent = 'default',
    size = 'md',
    loading = false,
    disabled = false,
    fullWidth = false,
    className = '',
    type = 'button',
    onClick,
    ...rest
  },
  ref,
) {
  const baseClasses = 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded transition';

  // Size classes
  const sizeClasses = {
    xs: 'px-2 py-1 text-xs',
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  }[size];

  // Variant + Intent classes
  const getVariantClasses = () => {
    if (variant === 'primary') {
      // Filled buttons with shadow
      const intentMap = {
        default: 'bg-primary dark:bg-[#22d3ee] text-white border border-primary dark:border-[#22d3ee] hover:bg-primary-hover dark:hover:bg-cyan-400 shadow-sm hover:shadow-md',
        success: 'bg-green-600 border border-green-600 text-white hover:bg-green-700 shadow-sm hover:shadow-md',
        error: 'bg-red-600 border border-red-600 text-white hover:bg-red-700 shadow-sm hover:shadow-md',
        warning: 'bg-yellow-600 border border-yellow-600 text-white hover:bg-yellow-700 shadow-sm hover:shadow-md',
        info: 'bg-blue-600 border border-blue-600 text-white hover:bg-blue-700 shadow-sm hover:shadow-md',
      };
      return intentMap[intent] || intentMap.default;
    }

    if (variant === 'secondary') {
      // Outlined buttons with light background tint
      const intentMap = {
        default: 'bg-primary/5 dark:bg-[#22d3ee]/10 text-primary dark:text-[#22d3ee] border border-primary dark:border-[#22d3ee] hover:bg-primary/10 dark:hover:bg-[#22d3ee]/20',
        success: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border border-green-600 dark:border-green-500 hover:bg-green-100 dark:hover:bg-green-900/30',
        error: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-600 dark:border-red-500 hover:bg-red-100 dark:hover:bg-red-900/30',
        warning: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400 border border-yellow-600 dark:border-yellow-500 hover:bg-yellow-100 dark:hover:bg-yellow-900/30',
        info: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-600 dark:border-blue-500 hover:bg-blue-100 dark:hover:bg-blue-900/30',
      };
      return intentMap[intent] || intentMap.default;
    }

    if (variant === 'ghost') {
      // Minimal button with no border, only hover background
      return 'text-text-secondary dark:text-text-secondary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay';
    }

    return '';
  };

  const variantClasses = getVariantClasses();

  // Disabled/loading opacity
  const stateClasses = (disabled || loading) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer';

  return (
    <button
      ref={ref}
      type={type}
      className={[
        baseClasses,
        sizeClasses,
        variantClasses,
        stateClasses,
        fullWidth && 'w-full',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled || loading}
      onClick={onClick}
      {...rest}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
});

export default Button;
