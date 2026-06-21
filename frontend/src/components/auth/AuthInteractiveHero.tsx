import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Play,
  Square,
  type LucideIcon,
} from "lucide-react";
import { LazyMotion, domAnimation, m } from "framer-motion";

const NOISE_DATA_URI =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 240 240' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

// Design coordinate space — all node positions and sizes are defined here,
// then converted to percentages so the diagram scales fluidly with the card.
const CARD_W = 440;
const CARD_H = 260;

interface NodeDef {
  pos: { x: number; y: number };
  label: string;
  sub?: string;
  Icon: LucideIcon;
  result: string | null;
}

type FourNodes = [NodeDef, NodeDef, NodeDef, NodeDef];

const NODES: FourNodes = [
  { pos: { x: 90, y: 70 }, label: "Start", Icon: Play, result: null },
  {
    pos: { x: 350, y: 70 },
    label: "HTTP Request",
    sub: "GET /users",
    Icon: Circle,
    result: "200",
  },
  {
    pos: { x: 90, y: 190 },
    label: "Assertion",
    sub: "status == 200",
    Icon: CheckCircle2,
    result: "✓",
  },
  { pos: { x: 350, y: 190 }, label: "End", Icon: Square, result: "done" },
];

// Responsive card dimensions — scales from ~300px on small desktops to ~600px on 4K.
// Node width scales with the card via clamp(); positions use percentages of the card.
const CARD_STYLE: React.CSSProperties = {
  width: "clamp(300px, 40vw, 600px)",
  aspectRatio: `${CARD_W} / ${CARD_H}`,
};
// Node width scales with viewport so text stays readable at every size.
const NODE_W = "clamp(110px, 11vw, 175px)";

// Convert design-space px to percentage of the card.
const pxX = (n: number) => `${(n / CARD_W) * 100}%`;
const pxY = (n: number) => `${(n / CARD_H) * 100}%`;

// Run cycle: 0..3 = pulse at node N, 4 = passed (hold). Then resets to 0.
const STEP_MS = 820;
const HOLD_MS = 1500;
const TOTAL_STEPS = 4;

function useRunStep(): number {
  const [step, setStep] = useState(0);
  useEffect(() => {
    let step = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setStep(step);
      step += 1;
      if (step > TOTAL_STEPS) {
        step = 0;
        timer = setTimeout(tick, HOLD_MS);
      } else {
        timer = setTimeout(tick, STEP_MS);
      }
    };
    tick();
    return () => clearTimeout(timer);
  }, []);
  return step;
}

function RunDiagram({ step }: { step: number }) {
  const idx = Math.min(step, 3) as 0 | 1 | 2 | 3;
  const pulsePos = NODES[idx].pos;
  const pulseVisible = step <= 3;
  const passed = step === TOTAL_STEPS;
  // On reset (step === 0) the pulse teleports to Start instantly;
  // otherwise it glides to the next node over STEP_MS.
  const isReset = step === 0;

  return (
    <div
      className="relative w-full border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised rounded-sm overflow-hidden"
      style={CARD_STYLE}
    >
      {/* Faint canvas grid */}
      <div className="absolute inset-0 opacity-[0.05] dark:opacity-[0.07] bg-[linear-gradient(currentColor_1px,transparent_1px),linear-gradient(90deg,currentColor_1px,transparent_1px)] bg-[size:clamp(16px,1.6vw,28px)_clamp(10px,1vw,18px)] text-text-muted dark:text-text-muted-dark" />
      {/* Authentic film grain */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.06] dark:opacity-[0.09] pointer-events-none mix-blend-multiply dark:mix-blend-screen"
        style={{
          backgroundImage: NOISE_DATA_URI,
          backgroundSize: "240px 240px",
        }}
      />

      {/* Passed status pill */}
      <m.div
        className="absolute flex items-center gap-1.5 border border-status-success/30 bg-status-success/10 rounded-sm"
        style={{
          top: "clamp(6px,0.6vw,12px)",
          right: "clamp(6px,0.6vw,12px)",
          padding: "clamp(2px,0.25vw,5px) clamp(5px,0.5vw,9px)",
        }}
        animate={{ opacity: passed ? 1 : 0, scale: passed ? 1 : 0.9 }}
        transition={{ duration: 0.3 }}
      >
        <span
          className="rounded-full bg-status-success"
          style={{
            width: "clamp(4px,0.4vw,7px)",
            height: "clamp(4px,0.4vw,7px)",
          }}
        />
        <span
          className="font-mono text-status-success"
          style={{ fontSize: "clamp(8px,0.65vw,11px)" }}
        >
          passed
        </span>
      </m.div>

      {/* Edges */}
      <svg
        viewBox={`0 0 ${CARD_W} ${CARD_H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none"
      >
        <line
          x1={NODES[0].pos.x}
          y1={NODES[0].pos.y}
          x2={NODES[1].pos.x}
          y2={NODES[1].pos.y}
          stroke={step === 1 ? "var(--aw-primary)" : "var(--aw-border)"}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          strokeDasharray={step === 1 ? "5 5" : undefined}
        />
        <line
          x1={NODES[1].pos.x}
          y1={NODES[1].pos.y}
          x2={NODES[2].pos.x}
          y2={NODES[2].pos.y}
          stroke={step === 2 ? "var(--aw-primary)" : "var(--aw-border)"}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          strokeDasharray={step === 2 ? "5 5" : undefined}
        />
        <line
          x1={NODES[2].pos.x}
          y1={NODES[2].pos.y}
          x2={NODES[3].pos.x}
          y2={NODES[3].pos.y}
          stroke={step === 3 ? "var(--aw-primary)" : "var(--aw-border)"}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          strokeDasharray={step === 3 ? "5 5" : undefined}
        />
      </svg>

      {/* Run pulse — teleports to Start on reset (duration:0 for position),
          fades opacity separately (0.3s). Glides forward on all other steps. */}
      <m.div
        className="absolute rounded-full bg-primary dark:bg-primary-light pointer-events-none"
        style={{
          width: "clamp(7px,0.7vw,13px)",
          height: "clamp(7px,0.7vw,13px)",
          marginLeft: "calc(clamp(7px,0.7vw,13px) / -2)",
          marginTop: "calc(clamp(7px,0.7vw,13px) / -2)",
          boxShadow:
            "0 0 0 calc(clamp(7px,0.7vw,13px) * 0.45) var(--aw-primary)",
        }}
        animate={{
          left: pxX(pulsePos.x),
          top: pxY(pulsePos.y),
          opacity: pulseVisible ? 1 : 0,
        }}
        transition={{
          left: { duration: isReset ? 0 : STEP_MS / 1000, ease: "linear" },
          top: { duration: isReset ? 0 : STEP_MS / 1000, ease: "linear" },
          opacity: { duration: 0.3 },
        }}
      />

      {/* Nodes */}
      {NODES.map((node, i) => {
        const lit = step >= i + 1 || passed;
        return (
          <div
            key={i}
            className="absolute"
            style={{
              left: pxX(node.pos.x),
              top: pxY(node.pos.y),
              transform: "translate(-50%, -50%)",
            }}
          >
            <div
              className={`flex items-center bg-surface-raised dark:bg-surface-dark-raised border rounded-sm cursor-default ${
                lit
                  ? "border-primary ring-2 ring-primary"
                  : "border-border dark:border-border-dark"
              }`}
              style={{
                width: NODE_W,
                gap: "clamp(4px,0.4vw,8px)",
                padding: "clamp(5px,0.5vw,9px) clamp(7px,0.65vw,12px)",
              }}
            >
              <node.Icon
                className={`shrink-0 ${lit ? "text-primary dark:text-primary-light" : "text-text-muted dark:text-text-muted-dark"}`}
                strokeWidth={2}
                style={{
                  width: "clamp(11px,1vw,17px)",
                  height: "clamp(11px,1vw,17px)",
                }}
              />
              <span className="flex flex-col min-w-0">
                <span
                  className="font-semibold text-text-primary dark:text-text-primary-dark truncate leading-tight"
                  style={{ fontSize: "clamp(9px,0.8vw,14px)" }}
                >
                  {node.label}
                </span>
                {node.sub && (
                  <span
                    className="font-mono text-text-secondary dark:text-text-secondary-dark truncate leading-tight"
                    style={{ fontSize: "clamp(8px,0.65vw,11px)" }}
                  >
                    {node.sub}
                  </span>
                )}
              </span>
              {node.result && (
                <m.span
                  className="ml-auto font-mono text-status-success bg-status-success/10 border border-status-success/30 rounded-sm"
                  style={{
                    fontSize: "clamp(8px,0.65vw,11px)",
                    padding: "clamp(1px,0.15vw,3px) clamp(3px,0.3vw,6px)",
                  }}
                  animate={{ opacity: lit ? 1 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {node.result}
                </m.span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AuthInteractiveHero() {
  const step = useRunStep();

  return (
    <div
      data-testid="auth-hero"
      className="w-full h-full relative overflow-hidden"
      aria-hidden="true"
    >
      {/* Static (reduced-motion) version — a completed run snapshot */}
      <div
        data-testid="auth-hero-static"
        className="absolute inset-0 hidden motion-reduce:flex flex-col gap-6 p-8 md:p-10 lg:p-14"
      >
        <div className="flex flex-col gap-2">
          <h2 className="font-display font-extrabold tracking-tight text-text-primary dark:text-text-primary-dark text-[clamp(1.75rem,4vw,3.25rem)] leading-[0.95]">
            APIWeave
          </h2>
          <p className="font-mono text-sm text-text-secondary dark:text-text-secondary-dark">
            Visual API test workflows.
          </p>
        </div>
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <RunDiagramStatic />
        </div>
        <p className="font-mono text-[10px] text-text-muted dark:text-text-muted-dark">
          Open-source. Self-hosted.
        </p>
      </div>

      {/* Animated version */}
      <LazyMotion features={domAnimation}>
        <div
          data-testid="auth-hero-animated"
          className="absolute inset-0 flex motion-reduce:hidden flex-col gap-6 p-8 md:p-10 lg:p-14"
        >
          <m.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="flex flex-col gap-2"
          >
            <h2 className="font-display font-extrabold tracking-tight text-text-primary dark:text-text-primary-dark text-[clamp(1.75rem,4vw,3.25rem)] leading-[0.95]">
              APIWeave
            </h2>
            <p className="font-mono text-sm text-text-secondary dark:text-text-secondary-dark">
              Visual API test workflows.
            </p>
          </m.div>

          <m.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut", delay: 0.15 }}
            className="flex-1 min-h-0 flex items-center justify-center"
          >
            <RunDiagram step={step} />
          </m.div>

          <p className="font-mono text-[10px] text-text-muted dark:text-text-muted-dark">
            Open-source. Self-hosted.
          </p>
        </div>
      </LazyMotion>
    </div>
  );
}

function RunDiagramStatic() {
  return (
    <div
      className="relative w-full border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised rounded-sm overflow-hidden"
      style={CARD_STYLE}
    >
      <div className="absolute inset-0 opacity-[0.05] dark:opacity-[0.07] bg-[linear-gradient(currentColor_1px,transparent_1px),linear-gradient(90deg,currentColor_1px,transparent_1px)] bg-[size:clamp(16px,1.6vw,28px)_clamp(10px,1vw,18px)] text-text-muted dark:text-text-muted-dark" />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.06] dark:opacity-[0.09] pointer-events-none mix-blend-multiply dark:mix-blend-screen"
        style={{
          backgroundImage: NOISE_DATA_URI,
          backgroundSize: "240px 240px",
        }}
      />
      <div
        className="absolute flex items-center gap-1.5 border border-status-success/30 bg-status-success/10 rounded-sm"
        style={{
          top: "clamp(6px,0.6vw,12px)",
          right: "clamp(6px,0.6vw,12px)",
          padding: "clamp(2px,0.25vw,5px) clamp(5px,0.5vw,9px)",
        }}
      >
        <span
          className="rounded-full bg-status-success"
          style={{
            width: "clamp(4px,0.4vw,7px)",
            height: "clamp(4px,0.4vw,7px)",
          }}
        />
        <span
          className="font-mono text-status-success"
          style={{ fontSize: "clamp(8px,0.65vw,11px)" }}
        >
          passed
        </span>
      </div>
      <svg
        viewBox={`0 0 ${CARD_W} ${CARD_H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none"
      >
        <line
          x1={NODES[0].pos.x}
          y1={NODES[0].pos.y}
          x2={NODES[1].pos.x}
          y2={NODES[1].pos.y}
          stroke="var(--aw-border)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={NODES[1].pos.x}
          y1={NODES[1].pos.y}
          x2={NODES[2].pos.x}
          y2={NODES[2].pos.y}
          stroke="var(--aw-border)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={NODES[2].pos.x}
          y1={NODES[2].pos.y}
          x2={NODES[3].pos.x}
          y2={NODES[3].pos.y}
          stroke="var(--aw-border)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {NODES.map((node, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: pxX(node.pos.x),
            top: pxY(node.pos.y),
            transform: "translate(-50%, -50%)",
          }}
        >
          <div
            className="flex items-center bg-surface-raised dark:bg-surface-dark-raised border border-primary ring-2 ring-primary rounded-sm cursor-default"
            style={{
              width: NODE_W,
              gap: "clamp(4px,0.4vw,8px)",
              padding: "clamp(5px,0.5vw,9px) clamp(7px,0.65vw,12px)",
            }}
          >
            <node.Icon
              className="shrink-0 text-primary dark:text-primary-light"
              strokeWidth={2}
              style={{
                width: "clamp(11px,1vw,17px)",
                height: "clamp(11px,1vw,17px)",
              }}
            />
            <span className="flex flex-col min-w-0">
              <span
                className="font-semibold text-text-primary dark:text-text-primary-dark truncate leading-tight"
                style={{ fontSize: "clamp(9px,0.8vw,14px)" }}
              >
                {node.label}
              </span>
              {node.sub && (
                <span
                  className="font-mono text-text-secondary dark:text-text-secondary-dark truncate leading-tight"
                  style={{ fontSize: "clamp(8px,0.65vw,11px)" }}
                >
                  {node.sub}
                </span>
              )}
            </span>
            {node.result && (
              <span
                className="ml-auto font-mono text-status-success bg-status-success/10 border border-status-success/30 rounded-sm"
                style={{
                  fontSize: "clamp(8px,0.65vw,11px)",
                  padding: "clamp(1px,0.15vw,3px) clamp(3px,0.3vw,6px)",
                }}
              >
                {node.result}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
