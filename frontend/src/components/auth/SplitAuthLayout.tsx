import type { SplitAuthLayoutProps } from '../../types';

export function SplitAuthLayout({ hero, children }: SplitAuthLayoutProps) {
  return (
    <div className="min-h-screen flex bg-surface dark:bg-surface-dark relative overflow-hidden text-text-primary dark:text-text-primary-dark">
      {/* Dynamic ambient background spanning the whole layout */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[var(--aw-primary)]/20 blur-[120px] rounded-full mix-blend-screen" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[var(--aw-status-info)]/20 blur-[120px] rounded-full mix-blend-screen" />
        <div className="absolute top-[40%] left-[60%] w-[30%] h-[30%] bg-[var(--aw-branch-edge)]/15 blur-[100px] rounded-full mix-blend-screen" />
        {/* Subtle noise texture */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
        />
      </div>

      {/* Left side: Hero (Hidden on mobile) */}
      <div className="hidden md:flex flex-1 relative z-10 lg:max-w-[60%] xl:max-w-[65%] border-r border-border dark:border-border-dark">
        <div className="w-full h-full absolute inset-0">
          {hero()}
        </div>
      </div>

      {/* Right side: Auth Controls */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 relative z-10 backdrop-blur-xl bg-surface-dark/20 dark:bg-surface-dark/40 shadow-modal">
        <div className="w-full max-w-sm relative">
          {/* Subtle glow behind the login box */}
          <div className="absolute -inset-4 bg-gradient-to-tr from-[var(--aw-primary)]/10 via-[var(--aw-status-info)]/10 to-[var(--aw-branch-edge)]/10 rounded-xl blur-xl z-0" />
          <div className="relative z-10">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
