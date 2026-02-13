import React from 'react';

/**
 * Divider — Horizontal or vertical divider.
 *
 * Uses DaisyUI's `divider` class for consistent styling.
 *
 * @param {'horizontal'|'vertical'} direction
 * @param {string} text — optional inline label
 */
export default function Divider({
  direction = 'horizontal',
  text,
  className = '',
  ...rest
}) {
  if (direction === 'vertical') {
    return (
      <div
        className={['divider divider-horizontal', className].filter(Boolean).join(' ')}
        {...rest}
      >
        {text}
      </div>
    );
  }

  return (
    <div className={['divider', className].filter(Boolean).join(' ')} {...rest}>
      {text}
    </div>
  );
}
