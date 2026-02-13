import React from 'react';
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';

/**
 * Tooltip — Wrapper around Tippy.js with consistent APIWeave styling.
 *
 * @param {string} content   — tooltip text or JSX
 * @param {'top'|'bottom'|'left'|'right'} placement
 * @param {number} delay     — show delay in ms
 */
export default function Tooltip({
  children,
  content,
  placement = 'top',
  delay = 300,
  disabled = false,
  className = '',
  ...rest
}) {
  if (!content || disabled) return children;

  return (
    <Tippy
      content={content}
      placement={placement}
      delay={[delay, 0]}
      className={className}
      {...rest}
    >
      {children}
    </Tippy>
  );
}
