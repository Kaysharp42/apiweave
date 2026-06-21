import React from 'react';
import type { SkeletonProps } from '../../types';

export function Skeleton({ variant = 'text', width, height, className = '', count = 1, ...rest }: SkeletonProps) {
  const base = 'animate-pulse rounded-sm bg-surface-overlay dark:bg-surface-dark-overlay motion-reduce:animate-none';
  const variantClass: Record<string, string> = {
    text: 'h-4 w-full',
    circle: 'h-10 w-10 rounded-full',
    rect: 'h-20 w-full rounded-sm',
  };

  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;

  if (count <= 1) {
    return <div className={`${base} ${variantClass[variant]} ${className}`} style={style} aria-hidden="true" {...rest} />;
  }

  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`${base} ${variantClass[variant]} ${className}`} style={style} />
      ))}
    </div>
  );
}
