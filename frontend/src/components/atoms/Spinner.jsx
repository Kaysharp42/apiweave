import React from 'react';

/**
 * Spinner — DaisyUI `loading` with size variants.
 *
 * @param {'spinner'|'dots'|'ring'|'ball'|'bars'|'infinity'} type
 * @param {'xs'|'sm'|'md'|'lg'} size
 * @param {string} color — Tailwind text-color class, e.g. 'text-primary'
 */
export default function Spinner({
  type = 'spinner',
  size = 'md',
  color = '',
  className = '',
  ...rest
}) {
  const typeClass = {
    spinner: 'loading-spinner',
    dots: 'loading-dots',
    ring: 'loading-ring',
    ball: 'loading-ball',
    bars: 'loading-bars',
    infinity: 'loading-infinity',
  }[type] ?? 'loading-spinner';

  const sizeClass = {
    xs: 'loading-xs',
    sm: 'loading-sm',
    md: 'loading-md',
    lg: 'loading-lg',
  }[size] ?? 'loading-md';

  return (
    <span
      className={['loading', typeClass, sizeClass, color, className].filter(Boolean).join(' ')}
      role="status"
      aria-label="Loading"
      {...rest}
    />
  );
}
