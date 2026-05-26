import { Activity, CheckCircle, Code2, Server, Workflow } from 'lucide-react';
import { motion } from 'framer-motion';

export function AuthInteractiveHero() {
  return (
    <div
      data-testid="auth-hero"
      className="w-full h-full relative overflow-hidden bg-transparent"
      aria-hidden="true"
    >
      {/* Deep Space Background within Hero */}
      <div className="absolute inset-0 bg-black/20" />
      <div className="absolute inset-0 opacity-20 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:30px_30px]" />

      {/* Static fallback for reduced-motion users */}
      <div
        data-testid="auth-hero-static"
        className="absolute inset-0 hidden motion-reduce:flex flex-col items-center justify-center p-8 text-white z-20"
      >
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-500 p-[1px] shadow-lg mb-4">
          <div className="w-full h-full bg-slate-950 rounded-2xl flex items-center justify-center">
            <Workflow className="w-10 h-10 text-cyan-400" />
          </div>
        </div>
        <h2 className="text-5xl font-display font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-cyan-200 tracking-tight drop-shadow-md mt-4">
          APIWeave
        </h2>
        <p className="text-cyan-100/70 text-base font-medium mt-2">Visual API Testing &amp; Orchestration</p>
      </div>

      {/* Animated content — hidden for reduced-motion users */}
      <div
        data-testid="auth-hero-animated"
        className="absolute inset-0 flex motion-reduce:hidden flex-col items-center justify-center"
      >
      {/* Animated Glowing Orbs */}
      <motion.div 
        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3], x: [0, 50, 0], y: [0, -50, 0] }}
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-20 left-20 w-64 h-64 bg-cyan-500/20 rounded-full blur-[100px]" 
      />
      <motion.div 
        animate={{ scale: [1, 1.5, 1], opacity: [0.2, 0.4, 0.2], x: [0, -30, 0], y: [0, 60, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
        className="absolute bottom-20 right-20 w-80 h-80 bg-purple-500/20 rounded-full blur-[120px]" 
      />

      {/* Main Content Area */}
      <div className="absolute inset-0 flex flex-col items-center justify-center p-8 z-10">
        <motion.div
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
          <h2 className="text-5xl font-display font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-cyan-200 tracking-tight drop-shadow-md mt-4">
            APIWeave
          </h2>
          <p className="text-cyan-100/70 text-base font-medium">Visual API Testing & Orchestration</p>
        </motion.div>

        {/* Floating Node Network */}
        <div className="relative w-full max-w-[440px] h-[360px]">
          {/* SVG Connections */}
          <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none">
            <motion.path 
              d="M 220 50 L 220 160" 
              stroke="url(#gradient1)" 
              strokeWidth="2.5" 
              fill="none" 
              strokeDasharray="6 6"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.5 }}
              transition={{ duration: 1.5, delay: 0.5 }}
            />
            <motion.path 
              d="M 220 160 L 110 280" 
              stroke="url(#gradient2)" 
              strokeWidth="2.5" 
              fill="none" 
              strokeDasharray="6 6"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.5 }}
              transition={{ duration: 1.5, delay: 1 }}
            />
             <motion.path 
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

            {/* Data Packets flowing */}
            <motion.circle r="4" className="fill-cyan-300" filter="drop-shadow(0 0 6px rgb(103 232 249))">
              <animateMotion dur="2s" repeatCount="indefinite" path="M 220 50 L 220 160" />
            </motion.circle>
            <motion.circle r="4" className="fill-green-300" filter="drop-shadow(0 0 6px rgb(134 239 172))">
              <animateMotion dur="2.5s" repeatCount="indefinite" path="M 220 160 L 110 280" begin="0.5s" />
            </motion.circle>
            <motion.circle r="4" className="fill-purple-300" filter="drop-shadow(0 0 6px rgb(216 180 254))">
              <animateMotion dur="2.5s" repeatCount="indefinite" path="M 220 160 L 330 280" begin="0.8s" />
            </motion.circle>
            <motion.circle r="4" className="fill-green-300" filter="drop-shadow(0 0 6px rgb(134 239 172))">
              <animateMotion dur="2.5s" repeatCount="indefinite" path="M 220 160 L 110 280" begin="0.5s" />
            </motion.circle>
             <motion.circle r="4" className="fill-purple-300" filter="drop-shadow(0 0 6px rgb(216 180 254))">
              <animateMotion dur="2.5s" repeatCount="indefinite" path="M 220 160 L 330 280" begin="0.8s" />
            </motion.circle>
          </svg>

          {/* Node 1: Request */}
          <motion.div 
            initial={{ scale: 0, opacity: 0, x: '-50%' }}
            animate={{ 
              scale: 1, 
              opacity: 1,
              y: [0, -8, 0]
            }}
            transition={{ 
              scale: { type: 'spring', bounce: 0.4, duration: 0.8, delay: 0.4 },
              y: { repeat: Infinity, duration: 4, ease: "easeInOut", delay: 1.2 }
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
          </motion.div>

          {/* Node 2: Transform */}
          <motion.div 
            initial={{ scale: 0, opacity: 0, x: '-50%' }}
            animate={{ 
              scale: 1, 
              opacity: 1,
              y: [0, -8, 0]
            }}
            transition={{ 
              scale: { type: 'spring', bounce: 0.4, duration: 0.8, delay: 0.8 },
              y: { repeat: Infinity, duration: 4.5, ease: "easeInOut", delay: 1.6 }
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
          </motion.div>

          {/* Node 3: Save */}
          <motion.div 
            initial={{ scale: 0, opacity: 0 }}
            animate={{ 
              scale: 1, 
              opacity: 1,
              y: [0, -6, 0]
            }}
            transition={{ 
              scale: { type: 'spring', bounce: 0.4, duration: 0.8, delay: 1.2 },
              y: { repeat: Infinity, duration: 3.8, ease: "easeInOut", delay: 2.0 }
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
          </motion.div>

          {/* Node 4: Assert */}
          <motion.div 
            initial={{ scale: 0, opacity: 0 }}
            animate={{ 
              scale: 1, 
              opacity: 1,
              y: [0, -6, 0]
            }}
            transition={{ 
              scale: { type: 'spring', bounce: 0.4, duration: 0.8, delay: 1.4 },
              y: { repeat: Infinity, duration: 4.2, ease: "easeInOut", delay: 2.2 }
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
          </motion.div>
        </div>
      </div>
      </div>
    </div>
  );
}
