import type { SplitAuthLayoutProps } from "../../types";

const NOISE_DATA_URI =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 240 240' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export function SplitAuthLayout({ hero, children }: SplitAuthLayoutProps) {
  return (
    <div className="min-h-screen flex bg-surface dark:bg-surface-dark text-text-primary dark:text-text-primary-dark">
      {/* Left side: Hero (hidden on mobile). Near-white / near-black with authentic grain. */}
      <div className="hidden md:flex flex-1 relative lg:max-w-[58%] xl:max-w-[62%] border-r border-border dark:border-border-dark overflow-hidden">
        {/* Faint Swiss grid */}
        <div className="absolute inset-0 opacity-[0.04] dark:opacity-[0.06] bg-[linear-gradient(currentColor_1px,transparent_1px),linear-gradient(90deg,currentColor_1px,transparent_1px)] bg-[size:48px_48px] text-text-primary dark:text-text-primary-dark" />
        {/* Authentic film grain — subtle, so it reads as a real surface not a gradient */}
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.05] dark:opacity-[0.08] pointer-events-none mix-blend-multiply dark:mix-blend-screen"
          style={{
            backgroundImage: NOISE_DATA_URI,
            backgroundSize: "240px 240px",
          }}
        />
        <div className="w-full h-full relative z-10">{hero()}</div>
      </div>

      {/* Right side: Auth controls. Generous negative space, sharp, no glow. */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 lg:p-16">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
