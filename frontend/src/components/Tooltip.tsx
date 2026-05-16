import { useState, useRef, type ReactNode } from 'react';

export interface TooltipProps {
  children: ReactNode;
  text: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

export default function Tooltip({ children, text, placement = 'top' }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const placementClasses: Record<string, string> = {
    top: '-top-8 left-1/2 -translate-x-1/2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1',
  };

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
          className={`absolute z-50 whitespace-nowrap text-[11px] px-2 py-1 rounded shadow-lg bg-gray-800 text-white ${placementClasses[placement] ?? placementClasses.top}`}
        >
          {text}
        </div>
      )}
    </div>
  );
}
