import type { ReactNode } from 'react';

export interface SplitAuthLayoutProps {
  hero: ReactNode;
  children: ReactNode;
}

export function SplitAuthLayout({ hero, children }: SplitAuthLayoutProps) {
  return (
    <div className="min-h-screen flex bg-surface dark:bg-surface-dark">
      {/* Left side: Hero (Hidden on mobile) */}
      <div className="hidden md:flex flex-1 items-center justify-center p-8 bg-surface-overlay dark:bg-surface-dark-overlay overflow-hidden relative">
        <div className="w-full max-w-lg h-full max-h-[800px] flex items-center justify-center">
          {hero}
        </div>
      </div>

      {/* Right side: Auth Controls */}
      <div className="flex-1 flex items-center justify-center p-4 md:p-8 relative">
        <div className="w-full max-w-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
