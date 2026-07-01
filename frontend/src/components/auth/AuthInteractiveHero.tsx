import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Play,
  Square,
  type LucideIcon,
} from "lucide-react";
import {
  LazyMotion,
  domAnimation,
  m,
  useAnimationFrame,
  useMotionValue,
  useTransform,
} from "framer-motion";

const NOISE_DATA_URI =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 240 240' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

// Design coordinate space — node positions, edge curves and sampled comet
// points all live in this space, then convert to percentages so the diagram
// scales fluidly with the card.
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

// One bezier per workflow step. Top + bottom rails are straight; the middle
// edge weaves down-left (an S) so the lit trail reads as a woven thread.
const EDGES: [string, string, string] = [
  "M90 70 C 210 70, 230 70, 350 70",
  "M350 70 C 350 142, 90 118, 90 190",
  "M90 190 C 210 190, 230 190, 350 190",
];
const EDGE_COUNT = EDGES.length;

const CARD_STYLE: React.CSSProperties = {
  width: "clamp(300px, 40vw, 600px)",
  aspectRatio: `${CARD_W} / ${CARD_H}`,
};
const NODE_W = "clamp(110px, 11vw, 175px)";

const pxX = (n: number) => `${(n / CARD_W) * 100}%`;
const pxY = (n: number) => `${(n / CARD_H) * 100}%`;

// Cycle timing (ms): run weaves edge-by-edge, holds on "passed", then a short
// breath where everything clears before the next run.
const EDGE_MS = 900;
const RUN_MS = EDGE_MS * EDGE_COUNT;
const HOLD_MS = 1600;
const GAP_MS = 550;
const CYCLE_MS = RUN_MS + HOLD_MS + GAP_MS;

// Cubic ease so each hop accelerates out of one node and settles into the next.
const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

interface RunState {
  // progress 0..EDGE_COUNT — fractional position of the request along the route
  progress: ReturnType<typeof useMotionValue<number>>;
  reached: number; // count of nodes the request has reached (lit)
  passed: boolean;
}

function useWeaveRun(): RunState {
  const progress = useMotionValue(0);
  const [reached, setReached] = useState(1);
  const [passed, setPassed] = useState(false);

  useAnimationFrame((t) => {
    const tc = t % CYCLE_MS;

    let p: number;
    let nextReached: number;
    let nextPassed: boolean;

    if (tc < RUN_MS) {
      const edge = Math.floor(tc / EDGE_MS);
      const frac = easeInOut((tc - edge * EDGE_MS) / EDGE_MS);
      p = edge + frac;
      nextReached = Math.min(Math.floor(p) + 1, EDGE_COUNT + 1);
      nextPassed = false;
    } else if (tc < RUN_MS + HOLD_MS) {
      p = EDGE_COUNT;
      nextReached = EDGE_COUNT + 1;
      nextPassed = true;
    } else {
      // Breath: route + comet cleared before the next run starts.
      p = 0;
      nextReached = 0;
      nextPassed = false;
    }

    progress.set(p);
    setReached((prev) => (prev === nextReached ? prev : nextReached));
    setPassed((prev) => (prev === nextPassed ? prev : nextPassed));
  });

  return { progress, reached, passed };
}

function EdgeTrail({
  d,
  index,
  length,
  progress,
  pathRef,
}: {
  d: string;
  index: number;
  length: number;
  progress: RunState["progress"];
  pathRef: (el: SVGPathElement | null) => void;
}) {
  // Drive the dash from the edge's real length. `pathLength`/`non-scaling-stroke`
  // can't be used here: Chrome ignores pathLength for dash math under
  // non-scaling-stroke, turning the draw into a stray dotted line.
  // Until measured (length 0) we fall back to a large value so the offset still
  // resolves to "fully hidden" — no flash of solid edges on first paint.
  const len = length || 1000;
  const dashoffset = useTransform(
    progress,
    (p) => len * (1 - clamp01(p - index)),
  );
  return (
    <m.path
      ref={pathRef}
      d={d}
      fill="none"
      stroke="var(--aw-primary)"
      strokeWidth={2}
      strokeLinecap="round"
      strokeDasharray={len}
      style={{ strokeDashoffset: dashoffset }}
    />
  );
}

function RunDiagram({ progress, reached, passed }: RunState) {
  const edgeEls = useRef<Array<SVGPathElement | null>>([]);
  const cometRef = useRef<HTMLDivElement | null>(null);
  const [lengths, setLengths] = useState<number[]>([0, 0, 0]);

  // Measure each edge once mounted — feeds both the trail dash and comet sampling.
  useEffect(() => {
    setLengths(EDGES.map((_, i) => edgeEls.current[i]?.getTotalLength() ?? 0));
  }, []);

  // Position the comet imperatively from the sampled bezier point so the route
  // animates at 60fps without re-rendering the node tree every frame.
  useEffect(() => {
    return progress.on("change", (p) => {
      const comet = cometRef.current;
      if (!comet) return;
      const visible = p > 0 && p < EDGE_COUNT;
      comet.style.opacity = visible ? "1" : "0";
      if (!visible) return;
      const edge = Math.min(Math.floor(p), EDGE_COUNT - 1);
      const el = edgeEls.current[edge];
      if (!el) return;
      const len = lengths[edge] || el.getTotalLength();
      const pt = el.getPointAtLength((p - edge) * len);
      comet.style.left = pxX(pt.x);
      comet.style.top = pxY(pt.y);
    });
  }, [progress, lengths]);

  const activeNode = reached > 0 ? NODES[Math.min(reached - 1, 3)] : null;

  return (
    <div
      className="relative w-full border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised rounded-sm overflow-hidden"
      style={CARD_STYLE}
    >
      {/* Faint canvas grid */}
      <div className="absolute inset-0 opacity-[0.05] dark:opacity-[0.07] bg-[linear-gradient(currentColor_1px,transparent_1px),linear-gradient(90deg,currentColor_1px,transparent_1px)] bg-[size:clamp(16px,1.6vw,28px)_clamp(10px,1vw,18px)] text-text-muted dark:text-text-muted-dark" />
      {/* Soft primary spotlight for depth */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--aw-primary) 9%, transparent), transparent 60%)",
        }}
      />
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

      {/* Edges: faint static track + glowing animated weave on top */}
      <svg
        viewBox={`0 0 ${CARD_W} ${CARD_H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none"
      >
        {EDGES.map((d, i) => (
          <path
            key={`track-${i}`}
            d={d}
            fill="none"
            stroke="var(--aw-border)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <g style={{ filter: "drop-shadow(0 0 5px var(--aw-primary))" }}>
          {EDGES.map((d, i) => (
            <EdgeTrail
              key={`trail-${i}`}
              d={d}
              index={i}
              length={lengths[i] ?? 0}
              progress={progress}
              pathRef={(el) => {
                edgeEls.current[i] = el;
              }}
            />
          ))}
        </g>
      </svg>

      {/* Pulse ring emitted each time the request arrives at a node */}
      {activeNode && (
        <m.div
          key={reached}
          className="absolute rounded-full border border-primary dark:border-primary-light pointer-events-none"
          style={{
            left: pxX(activeNode.pos.x),
            top: pxY(activeNode.pos.y),
            width: "clamp(18px,1.8vw,34px)",
            height: "clamp(18px,1.8vw,34px)",
            marginLeft: "calc(clamp(18px,1.8vw,34px) / -2)",
            marginTop: "calc(clamp(18px,1.8vw,34px) / -2)",
          }}
          initial={{ scale: 0.4, opacity: 0.7 }}
          animate={{ scale: 2.2, opacity: 0 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
      )}

      {/* Request comet — positioned imperatively along the weave */}
      <div
        ref={cometRef}
        className="absolute rounded-full bg-primary dark:bg-primary-light pointer-events-none"
        style={{
          left: pxX(NODES[0].pos.x),
          top: pxY(NODES[0].pos.y),
          opacity: 0,
          width: "clamp(8px,0.8vw,14px)",
          height: "clamp(8px,0.8vw,14px)",
          marginLeft: "calc(clamp(8px,0.8vw,14px) / -2)",
          marginTop: "calc(clamp(8px,0.8vw,14px) / -2)",
          boxShadow:
            "0 0 0 calc(clamp(8px,0.8vw,14px) * 0.4) color-mix(in srgb, var(--aw-primary) 45%, transparent), 0 0 16px 2px var(--aw-primary)",
        }}
      />

      {/* Nodes */}
      {NODES.map((node, i) => {
        const lit = reached >= i + 1;
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
            <m.div
              className={`flex items-center bg-surface-raised dark:bg-surface-dark-raised border rounded-sm cursor-default ${
                lit
                  ? "border-primary ring-2 ring-primary"
                  : "border-border dark:border-border-dark"
              }`}
              animate={{ scale: lit ? 1 : 0.97 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
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
                  animate={{ opacity: lit ? 1 : 0, scale: lit ? 1 : 0.8 }}
                  transition={{ duration: 0.25 }}
                >
                  {node.result}
                </m.span>
              )}
            </m.div>
          </div>
        );
      })}
    </div>
  );
}

export function AuthInteractiveHero() {
  const run = useWeaveRun();

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
            <RunDiagram {...run} />
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
        <g style={{ filter: "drop-shadow(0 0 5px var(--aw-primary))" }}>
          {EDGES.map((d, i) => (
            <path
              key={i}
              d={d}
              fill="none"
              stroke="var(--aw-primary)"
              strokeWidth={2}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
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
