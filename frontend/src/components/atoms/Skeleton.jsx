import React from 'react';

/**
 * Skeleton — DaisyUI skeleton loading placeholder.
 *
 * Variants:
 *   - `text` — single line of text (default)
 *   - `circle` — avatar/icon placeholder
 *   - `rect` — rectangular block
 */
export default function Skeleton({ variant = 'text', width, height, className = '', count = 1 }) {
  const base = 'skeleton rounded';
  const variantClass = {
    text: 'h-4 w-full',
    circle: 'h-10 w-10 rounded-full',
    rect: 'h-20 w-full',
  }[variant];

  const style = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;

  if (count <= 1) {
    return <div className={`${base} ${variantClass} ${className}`} style={style} aria-hidden="true" />;
  }

  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`${base} ${variantClass} ${className}`} style={style} />
      ))}
    </div>
  );
}
