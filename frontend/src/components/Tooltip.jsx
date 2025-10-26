import React, { useState, useRef } from 'react';

export default function Tooltip({ children, text, placement = 'top' }) {
  const [visible, setVisible] = useState(false);
  const containerRef = useRef(null);

  return (
    <div
      ref={containerRef}
      className="relative inline-block"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      tabIndex={0}
    >
      {children}
      {visible && (
        <div
          role="tooltip"
          className={`absolute z-50 whitespace-nowrap text-[11px] px-2 py-1 rounded shadow-lg bg-gray-800 text-white ${
            placement === 'top' ? '-top-8 left-1/2 transform -translate-x-1/2' : ''
          }`}
        >
          {text}
        </div>
      )}
    </div>
  );
}
