import React from 'react';

/**
 * HorizontalDivider — lightweight 1px full-width divider.
 *
 * Unlike the DaisyUI `Divider` atom which includes spacing and optional text,
 * this is a minimal visual separator matching FlowTest's pattern:
 *   `<div className="h-px w-full bg-gray-300" />`
 *
 * Uses design tokens for automatic dark mode support.
 *
 * @param {string} className — optional extra classes
 */
export default function HorizontalDivider({ className = '', ...rest }) {
  return (
    <div
      className={['h-px w-full bg-border dark:bg-border-dark', className].filter(Boolean).join(' ')}
      role="separator"
      {...rest}
    />
  );
}
