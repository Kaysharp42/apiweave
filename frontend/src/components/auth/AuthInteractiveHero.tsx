import { Activity, CheckCircle, Code2, Server } from 'lucide-react';

export function AuthInteractiveHero() {
  return (
    <div
      data-testid="auth-hero"
      className="w-full h-full relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-dark to-primary border border-border dark:border-border-dark shadow-xl"
      aria-hidden="true"
    >
      {/* Background Mesh/Grid */}
      <div className="absolute inset-0 opacity-20 bg-[linear-gradient(rgba(255,255,255,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.1)_1px,transparent_1px)] bg-[size:20px_20px]" />

      {/* Static version (Reduced motion) */}
      <div
        data-testid="auth-hero-static"
        className="absolute inset-0 hidden motion-reduce:flex flex-col items-center justify-center p-8 text-white"
      >
        <div className="w-24 h-24 mb-6 rounded-2xl bg-white/10 flex items-center justify-center backdrop-blur-sm border border-white/20">
          <Activity className="w-12 h-12 text-cyan-300" />
        </div>
        <h2 className="text-3xl font-display font-bold text-center mb-4">
          APIWeave
        </h2>
        <p className="text-center text-cyan-100 text-lg max-w-xs">
          Visual API Testing & Orchestration
        </p>

        <div className="mt-12 w-full max-w-xs space-y-4">
          <div className="p-4 rounded-lg bg-white/5 border border-white/10 flex items-center gap-3">
            <Code2 className="w-5 h-5 text-cyan-200" />
            <span className="text-sm font-medium">Build Workflows</span>
          </div>
          <div className="p-4 rounded-lg bg-white/5 border border-white/10 flex items-center gap-3">
            <Server className="w-5 h-5 text-green-300" />
            <span className="text-sm font-medium">Test APIs</span>
          </div>
          <div className="p-4 rounded-lg bg-white/5 border border-white/10 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-blue-300" />
            <span className="text-sm font-medium">Assert Results</span>
          </div>
        </div>
      </div>

      {/* Animated version */}
      <div
        data-testid="auth-hero-animated"
        className="absolute inset-0 flex motion-reduce:hidden flex-col items-center justify-center p-8 text-white"
      >
        <h2 className="text-4xl font-display font-bold text-center mb-12 drop-shadow-md tracking-tight">
          APIWeave
        </h2>

        {/* Node Graph Visualization */}
        <div className="relative w-full max-w-xs h-64">
          {/* Central Line */}
          <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-cyan-500/30 -translate-x-1/2" />
          
          {/* Animated dot moving down */}
          <div className="absolute left-1/2 top-0 w-3 h-3 bg-cyan-300 rounded-full shadow-[0_0_10px_rgba(103,232,249,0.8)] -translate-x-1/2 animate-[bounce_3s_infinite_linear]" style={{ animationName: 'flow-down', animationDuration: '3s', animationIterationCount: 'infinite', animationTimingFunction: 'linear' }} />

          {/* Node 1 */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 bg-surface-dark-raised border border-cyan-500/30 rounded-xl p-3 shadow-lg z-10 flex items-center gap-3 animate-[fade-in-up_1s_ease-out_forwards]">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
              <Code2 className="w-4 h-4 text-blue-400" />
            </div>
            <div className="flex-1">
              <div className="h-2 w-16 bg-surface-dark-overlay rounded mb-1.5" />
              <div className="h-1.5 w-24 bg-surface-dark-overlay rounded" />
            </div>
          </div>

          {/* Node 2 */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 bg-surface-dark-raised border border-cyan-500/30 rounded-xl p-3 shadow-lg z-10 flex items-center gap-3 animate-[fade-in-up_1s_ease-out_0.5s_both]">
            <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center flex-shrink-0">
              <Server className="w-4 h-4 text-green-400" />
            </div>
            <div className="flex-1">
              <div className="h-2 w-20 bg-surface-dark-overlay rounded mb-1.5" />
              <div className="h-1.5 w-12 bg-surface-dark-overlay rounded" />
            </div>
          </div>

          {/* Node 3 */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-48 bg-surface-dark-raised border border-cyan-500/30 rounded-xl p-3 shadow-lg z-10 flex items-center gap-3 animate-[fade-in-up_1s_ease-out_1s_both]">
            <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
              <CheckCircle className="w-4 h-4 text-purple-400" />
            </div>
            <div className="flex-1">
              <div className="h-2 w-12 bg-surface-dark-overlay rounded mb-1.5" />
              <div className="h-1.5 w-20 bg-surface-dark-overlay rounded" />
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes flow-down {
          0% { top: 0; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        @keyframes fade-in-up {
          from { opacity: 0; transform: translate(-50%, 10px); }
          to { opacity: 1; transform: translate(-50%, -50%); }
        }
      `}</style>
    </div>
  );
}
