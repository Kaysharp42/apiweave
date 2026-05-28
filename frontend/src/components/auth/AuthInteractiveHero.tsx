import { Activity, CheckCircle, Code2, Server, Workflow } from 'lucide-react';
import { LazyMotion, domAnimation, m } from 'framer-motion';

export function AuthInteractiveHero() {
  return (
    <div
      data-testid="auth-hero"
      className="w-full h-full relative overflow-hidden bg-transparent"
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-slate-950/20" />
      <div className="absolute inset-0 opacity-20 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:30px_30px]" />

      <div
        data-testid="auth-hero-static"
        className="absolute inset-0 hidden motion-reduce:flex flex-col items-center justify-center p-8 text-white z-20"
      >
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-500 p-[1px] shadow-lg mb-4">
          <div className="w-full h-full bg-slate-950 rounded-2xl flex items-center justify-center">
            <Workflow className="w-10 h-10 text-cyan-400" />
          </div>
        </div>
        <h2 className="text-5xl font-display font-extrabold text-cyan-100 tracking-tight drop-shadow-md mt-4">
          APIWeave
        </h2>
        <p className="text-cyan-100/70 text-base font-medium mt-2">Visual API Testing &amp; Orchestration</p>
      </div>

      <LazyMotion features={domAnimation}>
        <div
          data-testid="auth-hero-animated"
          className="absolute inset-0 flex motion-reduce:hidden flex-col items-center justify-center"
        >
          <m.div
            animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3], x: [0, 50, 0], y: [0, -50, 0] }}
            transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute top-20 left-20 w-64 h-64 bg-cyan-500/20 rounded-full blur-[100px]"
          />
          <m.div
            animate={{ scale: [1, 1.5, 1], opacity: [0.2, 0.4, 0.2], x: [0, -30, 0], y: [0, 60, 0] }}
            transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute bottom-20 right-20 w-80 h-80 bg-purple-500/20 rounded-full blur-[120px]"
          />

          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 z-10">
            <m.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="flex flex-col items-center gap-3 mb-16"
            >
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-500 p-[1px] shadow-[0_0_50px_rgba(34,211,238,0.4)]">
                <div className="w-full h-full bg-slate-950 rounded-2xl flex items-center justify-center">
                  <Workflow className="w-10 h-10 text-cyan-400" />
                </div>
              </div>
              <h2 className="text-5xl font-display font-extrabold text-cyan-100 tracking-tight drop-shadow-md mt-4">
                APIWeave
              </h2>
              <p className="text-cyan-100/70 text-base font-medium">Visual API Testing & Orchestration</p>
            </m.div>

            <div className="relative w-full max-w-[440px] h-[360px]">
              <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none">
                <m.path
                  d="M 220 50 L 220 160"
                  stroke="url(#gradient1)"
                  strokeWidth="2.5"
                  fill="none"
                  strokeDasharray="6 6"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 0.5 }}
                  transition={{ duration: 1.5, delay: 0.5 }}
                />
                <m.path
                  d="M 220 160 L 110 280"
                  stroke="url(#gradient2)"
                  strokeWidth="2.5"
                  fill="none"
                  strokeDasharray="6 6"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 0.5 }}
                  transition={{ duration: 1.5, delay: 1 }}
                />
                <m.path
                  d="M 220 160 L 330 280"
                  stroke="url(#gradient3)"
                  strokeWidth="2.5"
                  fill="none"
                  strokeDasharray="6 6"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 0.5 }}
                  transition={{ duration: 1.5, delay: 1 }}
                />
                <defs>
                  <linearGradient id="gradient1" x1="220" y1="50" x2="220" y2="160" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="rgb(59 130 246)" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="rgb(34 211 238)" stopOpacity="0.8" />
                  </linearGradient>
                  <linearGradient id="gradient2" x1="220" y1="160" x2="110" y2="280" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="rgb(34 211 238)" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="rgb(74 222 128)" stopOpacity="0.8" />
                  </linearGradient>
                  <linearGradient id="gradient3" x1="220" y1="160" x2="330" y2="280" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="rgb(34 211 238)" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="rgb(192 132 252)" stopOpacity="0.8" />
                  </linearGradient>
                </defs>

                <m.circle r="4" className="fill-cyan-300" filter="drop-shadow(0 0 6px rgb(103 232 249))">
                  <animateMotion dur="2s" repeatCount="indefinite" path="M 220 50 L 220 160" />
                </m.circle>
                <m.circle r="4" className="fill-green-300" filter="drop-shadow(0 0 6px rgb(134 239 172))">
                  <animateMotion dur="2.5s" repeatCount="indefinite" path="M 220 160 L 110 280" begin="0.5s" />
                </m.circle>
                <m.circle r="4" className="fill-purple-300" filter="drop-shadow(0 0 6px rgb(216 180 254))">
                  <animateMotion dur="2.5s" repeatCount="indefinite" path="M 220 160 L 330 280" begin="0.8s" />
                </m.circle>
                <m.circle r="4" className="fill-green-300" filter="drop-shadow(0 0 6px rgb(134 239 172))">
                  <animateMotion dur="2.5s" repeatCount="indefinite" path="M 220 160 L 110 280" begin="0.5s" />
                </m.circle>
                <m.circle r="4" className="fill-purple-300" filter="drop-shadow(0 0 6px rgb(216 180 254))">
                  <animateMotion dur="2.5s" repeatCount="indefinite" path="M 220 160 L 330 280" begin="0.8s" />
                </m.circle>
              </svg>

              <m.div
                initial={{ opacity: 0, x: '-50%', y: 16 }}
                animate={{
                  opacity: 1,
                  y: [0, -8, 0],
                }}
                transition={{
                  y: { repeat: Infinity, duration: 4, ease: 'easeInOut', delay: 1.2 },
                }}
                className="absolute top-0 left-1/2 w-60 bg-white/10 backdrop-blur-xl border border-blue-400/40 rounded-2xl p-4 shadow-[0_0_40px_rgba(59,130,246,0.2)] flex items-center gap-4 cursor-default"
              >
                <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center flex-shrink-0 shadow-inner">
                  <Code2 className="w-6 h-6 text-blue-400" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-white/90 mb-1.5">API Request</div>
                  <div className="flex gap-1.5">
                    <div className="h-2 w-10 bg-blue-400/50 rounded-full" />
                    <div className="h-2 w-20 bg-white/20 rounded-full" />
                  </div>
                </div>
              </m.div>

              <m.div
                initial={{ opacity: 0, x: '-50%', y: 16 }}
                animate={{
                  opacity: 1,
                  y: [0, -8, 0],
                }}
                transition={{
                  y: { repeat: Infinity, duration: 4.5, ease: 'easeInOut', delay: 1.6 },
                }}
                className="absolute top-[140px] left-1/2 w-60 bg-white/10 backdrop-blur-xl border border-cyan-400/40 rounded-2xl p-4 shadow-[0_0_40px_rgba(34,211,238,0.2)] flex items-center gap-4 cursor-default"
              >
                <div className="w-12 h-12 rounded-xl bg-cyan-500/20 flex items-center justify-center flex-shrink-0 shadow-inner">
                  <Activity className="w-6 h-6 text-cyan-400" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-white/90 mb-1.5">Transform</div>
                  <div className="flex gap-1.5">
                    <div className="h-2 w-14 bg-cyan-400/50 rounded-full" />
                    <div className="h-2 w-14 bg-white/20 rounded-full" />
                  </div>
                </div>
              </m.div>

              <m.div
                initial={{ opacity: 0, y: 16 }}
                animate={{
                  opacity: 1,
                  y: [0, -6, 0],
                }}
                transition={{
                  y: { repeat: Infinity, duration: 3.8, ease: 'easeInOut', delay: 2.0 },
                }}
                className="absolute top-[260px] left-0 w-52 bg-white/10 backdrop-blur-xl border border-green-400/40 rounded-2xl p-4 shadow-[0_0_40px_rgba(74,222,128,0.2)] flex items-center gap-4 cursor-default"
              >
                <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center flex-shrink-0 shadow-inner">
                  <Server className="w-6 h-6 text-green-400" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-white/90 mb-1.5">Save State</div>
                  <div className="h-2 w-full bg-white/20 rounded-full" />
                </div>
              </m.div>

              <m.div
                initial={{ opacity: 0, y: 16 }}
                animate={{
                  opacity: 1,
                  y: [0, -6, 0],
                }}
                transition={{
                  y: { repeat: Infinity, duration: 4.2, ease: 'easeInOut', delay: 2.2 },
                }}
                className="absolute top-[260px] right-0 w-52 bg-white/10 backdrop-blur-xl border border-purple-400/40 rounded-2xl p-4 shadow-[0_0_40px_rgba(192,132,252,0.2)] flex items-center gap-4 cursor-default"
              >
                <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0 shadow-inner">
                  <CheckCircle className="w-6 h-6 text-purple-400" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-white/90 mb-1.5">Assert Value</div>
                  <div className="h-2 w-full bg-white/20 rounded-full" />
                </div>
              </m.div>
            </div>
          </div>
        </div>
      </LazyMotion>
    </div>
  );
}
