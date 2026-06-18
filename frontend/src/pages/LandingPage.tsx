import { useContext } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, ArrowRight, BookOpen, Boxes, Brain, CheckCircle2,
  Database, FileCode2, GitBranch, Github, Globe, KeyRound,
  Lock, Moon, Network, Play, Server, Shield, Square, Sun, Terminal, Webhook, Workflow, Zap,
} from 'lucide-react';
import { Button } from '../components/atoms/Button';
import { AppContext, type AppContextValue } from '../App';

const NOISE_DATA_URI =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 240 240' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

function NoiseOverlay() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 opacity-[0.05] dark:opacity-[0.08] pointer-events-none mix-blend-multiply dark:mix-blend-screen"
      style={{ backgroundImage: NOISE_DATA_URI, backgroundSize: '240px 240px' }}
    />
  );
}

function GridBg({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`absolute inset-0 opacity-[0.04] dark:opacity-[0.06] bg-[linear-gradient(currentColor_1px,transparent_1px),linear-gradient(90deg,currentColor_1px,transparent_1px)] bg-[size:clamp(20px,2vw,32px)_clamp(20px,2vw,32px)] text-text-muted dark:text-text-muted-dark ${className ?? ''}`}
    />
  );
}

// ─── Hero canvas mockup (static, authentic) ──────────────────────────────
const CW = 440;
const CH = 260;
const NODES = [
  { x: 90, y: 70, label: 'Start', Icon: Play, sub: undefined, result: undefined },
  { x: 350, y: 70, label: 'HTTP Request', Icon: Globe, sub: 'GET /users', result: '200' },
  { x: 90, y: 190, label: 'Assertion', Icon: CheckCircle2, sub: 'status == 200', result: '✓' },
  { x: 350, y: 190, label: 'End', Icon: Square, sub: undefined, result: 'done' },
] as const;
const pxX = (n: number) => `${(n / CW) * 100}%`;
const pxY = (n: number) => `${(n / CH) * 100}%`;

function HeroCanvas() {
  return (
    <div
      className="relative w-full border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised rounded-sm overflow-hidden"
      style={{ width: 'clamp(300px, 42vw, 560px)', aspectRatio: `${CW} / ${CH}` }}
    >
      <GridBg />
      <NoiseOverlay />
      <div className="absolute flex items-center gap-1.5 border border-status-success/30 bg-status-success/10 rounded-sm" style={{ top: 'clamp(6px,0.6vw,12px)', right: 'clamp(6px,0.6vw,12px)', padding: 'clamp(2px,0.25vw,5px) clamp(5px,0.5vw,9px)' }}>
        <span className="rounded-full bg-status-success" style={{ width: 'clamp(4px,0.4vw,7px)', height: 'clamp(4px,0.4vw,7px)' }} />
        <span className="font-mono text-status-success" style={{ fontSize: 'clamp(8px,0.65vw,11px)' }}>passed</span>
      </div>
      <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
        <line x1={NODES[0].x} y1={NODES[0].y} x2={NODES[1].x} y2={NODES[1].y} stroke="var(--aw-primary)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeDasharray="5 5" />
        <line x1={NODES[1].x} y1={NODES[1].y} x2={NODES[2].x} y2={NODES[2].y} stroke="var(--aw-border)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <line x1={NODES[2].x} y1={NODES[2].y} x2={NODES[3].x} y2={NODES[3].y} stroke="var(--aw-border)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      {NODES.map((node, i) => {
        const Icon = node.Icon;
        const lit = i >= 1;
        return (
          <div key={i} className="absolute" style={{ left: pxX(node.x), top: pxY(node.y), transform: 'translate(-50%, -50%)' }}>
            <div
              className={`flex items-center bg-surface-raised dark:bg-surface-dark-raised border rounded-sm ${lit ? 'border-primary ring-2 ring-primary' : 'border-border dark:border-border-dark'}`}
              style={{ width: 'clamp(110px,11vw,165px)', gap: 'clamp(4px,0.4vw,8px)', padding: 'clamp(5px,0.5vw,9px) clamp(7px,0.65vw,12px)' }}
            >
              <Icon className={`shrink-0 ${lit ? 'text-primary dark:text-primary-light' : 'text-text-muted dark:text-text-muted-dark'}`} strokeWidth={2} style={{ width: 'clamp(11px,1vw,16px)', height: 'clamp(11px,1vw,16px)' }} />
              <span className="flex flex-col min-w-0">
                <span className="font-semibold text-text-primary dark:text-text-primary-dark truncate leading-tight" style={{ fontSize: 'clamp(9px,0.8vw,13px)' }}>{node.label}</span>
                {node.sub && <span className="font-mono text-text-secondary dark:text-text-secondary-dark truncate leading-tight" style={{ fontSize: 'clamp(8px,0.65vw,11px)' }}>{node.sub}</span>}
              </span>
              {node.result && <span className="ml-auto font-mono text-status-success bg-status-success/10 border border-status-success/30 rounded-sm" style={{ fontSize: 'clamp(8px,0.65vw,11px)', padding: 'clamp(1px,0.15vw,3px) clamp(3px,0.3vw,6px)' }}>{node.result}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Sections ─────────────────────────────────────────────────────────────

function Nav() {
  const { darkMode, setDarkMode } = useContext(AppContext) as AppContextValue;

  return (
    <header className="sticky top-0 z-50 bg-surface/90 dark:bg-surface-dark/90 backdrop-blur-sm border-b border-border dark:border-border-dark">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-4 sm:px-6 lg:px-8 h-14">
        <Link to="/" className="font-display font-extrabold tracking-tight text-text-primary dark:text-text-primary-dark text-lg">
          APIWeave
        </Link>
        <nav className="flex items-center gap-2 sm:gap-4">
          <a href="https://github.com" target="_blank" rel="noreferrer" className="hidden sm:inline-flex items-center gap-1.5 text-sm text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark transition-colors">
            <Github className="w-4 h-4" /> <span className="hidden md:inline">GitHub</span>
          </a>
          <a href="#docs" className="hidden sm:inline-flex text-sm text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark transition-colors">Docs</a>
          <button
            type="button"
            onClick={() => setDarkMode(!darkMode)}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            className="inline-flex items-center justify-center w-9 h-9 rounded-sm border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-2"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <Link to="/login">
            <Button variant="outline" size="sm">Sign in</Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border dark:border-border-dark">
      <GridBg />
      <NoiseOverlay />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24 lg:py-32">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div className="flex flex-col gap-6">
            <h1 className="font-display font-extrabold tracking-tight text-text-primary dark:text-text-primary-dark text-[clamp(2.25rem,6vw,4.5rem)] leading-[0.95]">
              Visual API test workflows.
            </h1>
            <p className="text-base md:text-lg text-text-secondary dark:text-text-secondary-dark max-w-lg leading-relaxed">
              Assemble test flows on a canvas from drag-and-drop nodes. Chain requests with extracted variables. Run against scoped environments. Self-hosted, open-source.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <a href="#self-host">
                <Button variant="primary" size="lg" icon={<Terminal className="w-4 h-4" />}>Self-host</Button>
              </a>
              <a href="https://github.com" target="_blank" rel="noreferrer">
                <Button variant="outline" size="lg" icon={<Github className="w-4 h-4" />}>View on GitHub</Button>
              </a>
            </div>
            <div className="flex items-center gap-4 pt-4 text-xs font-mono text-text-muted dark:text-text-muted-dark">
              <span className="flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" /> MIT licensed</span>
              <span className="flex items-center gap-1.5"><Server className="w-3.5 h-3.5" /> Self-hostable</span>
              <span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Write-only secrets</span>
            </div>
          </div>
          <div className="flex items-center justify-center">
            <HeroCanvas />
          </div>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    n: '01',
    Icon: Workflow,
    title: 'Assemble on the canvas',
    body: 'Drag HTTP Request, Assertion, Delay, Merge, Start, and End nodes onto a ReactFlow canvas. Connect them visually — branches, parallel paths, and merges all work.',
    code: 'Start → HTTP GET /users → Assertion status==200 → End',
  },
  {
    n: '02',
    Icon: Zap,
    title: 'Run with variables & secrets',
    body: 'Chain requests with {{variables.name}}, {{env.NAME}}, {{secrets.NAME}}, and dynamic functions like uuid() and randomEmail(). Secrets resolve through a GitHub-like scoped override chain.',
    code: 'POST /login  {{secrets.API_KEY}}\n→ {{variables.token}}',
  },
  {
    n: '03',
    Icon: Activity,
    title: 'Inspect results node-by-node',
    body: 'See every response, assertion pass/fail, and extracted variable. Export JUnit XML and HTML reports for CI. Resume from the failed node after fixing.',
    code: '✓ 200 OK  ✓ status==200  ✓ token extracted',
  },
] as const;

function HowItWorks() {
  return (
    <section className="border-b border-border dark:border-border-dark">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
        <div className="mb-12 md:mb-16">
          <h2 className="font-display font-bold tracking-tight text-text-primary dark:text-text-primary-dark text-[clamp(1.75rem,4vw,2.75rem)] leading-tight">
            How it works
          </h2>
          <p className="mt-3 text-text-secondary dark:text-text-secondary-dark max-w-2xl">
            Three steps from a blank canvas to a passing CI report.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
          {STEPS.map((step) => (
            <div key={step.n} className="flex flex-col gap-4 min-w-0">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-text-muted dark:text-text-muted-dark">{step.n}</span>
                <div className="w-8 h-8 flex items-center justify-center border border-border dark:border-border-dark rounded-sm text-primary dark:text-primary-light">
                  <step.Icon className="w-4 h-4" strokeWidth={2} />
                </div>
              </div>
              <h3 className="font-display font-semibold text-lg text-text-primary dark:text-text-primary-dark leading-tight">
                {step.title}
              </h3>
              <p className="text-sm text-text-secondary dark:text-text-secondary-dark leading-relaxed">
                {step.body}
              </p>
              <pre className="mt-auto font-mono text-[11px] leading-relaxed text-text-secondary dark:text-text-secondary-dark bg-surface-overlay dark:bg-surface-dark-overlay border border-border dark:border-border-dark rounded-sm p-3 overflow-x-auto max-w-full"><code>{step.code}</code></pre>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  { Icon: Globe, title: 'HTTP Request nodes', body: 'All methods, headers, body, extractors, and file uploads. JSONPath variable extraction from responses.' },
  { Icon: CheckCircle2, title: 'Assertions', body: '10 operators, 5 sources, nested paths with array indexing. Pass/fail tracked per node.' },
  { Icon: Network, title: 'Branches & merges', body: 'Parallel branches run concurrently. Merge nodes sync them with an asyncio lock.' },
  { Icon: KeyRound, title: 'Scoped secrets', body: 'Libsodium sealed-box ingress, write-only through every layer. User, org, workspace, and environment scopes.' },
  { Icon: Webhook, title: 'Webhooks', body: 'Token + HMAC auth, idempotency, rate limiting. Trigger runs from CI/CD with scoped service tokens.' },
  { Icon: Boxes, title: 'MCP server', body: '40+ scoped tools across 8 domains over stdio and Streamable HTTP. AI agents create, run, and inspect workflows end-to-end.' },
  { Icon: FileCode2, title: 'OpenAPI / HAR / cURL import', body: 'Turn a spec into reusable request nodes. Import a cURL command straight onto the canvas.' },
  { Icon: Database, title: 'Collections & projects', body: 'Group workflows into ordered runs. Export and import .awecollection bundles — secrets sanitized.' },
] as const;

function Features() {
  return (
    <section className="border-b border-border dark:border-border-dark">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
        <div className="mb-12 md:mb-16">
          <h2 className="font-display font-bold tracking-tight text-text-primary dark:text-text-primary-dark text-[clamp(1.75rem,4vw,2.75rem)] leading-tight">
            Everything you need to test APIs
          </h2>
          <p className="mt-3 text-text-secondary dark:text-text-secondary-dark max-w-2xl">
            A complete, self-hostable workspace — not a thin wrapper around curl.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border dark:bg-border-dark border border-border dark:border-border-dark rounded-sm overflow-hidden">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-surface-raised dark:bg-surface-dark-raised p-6 flex flex-col gap-3">
              <div className="w-9 h-9 flex items-center justify-center border border-border dark:border-border-dark rounded-sm text-primary dark:text-primary-light">
                <f.Icon className="w-4 h-4" strokeWidth={2} />
              </div>
              <h3 className="font-semibold text-sm text-text-primary dark:text-text-primary-dark">{f.title}</h3>
              <p className="text-xs text-text-secondary dark:text-text-secondary-dark leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const MCP_DOMAINS = [
  { name: 'Workflows', count: 9 },
  { name: 'Environments', count: 7 },
  { name: 'Collections', count: 12 },
  { name: 'Runs', count: 7 },
  { name: 'Projects', count: 5 },
  { name: 'Imports', count: 6 },
  { name: 'Secrets', count: 4 },
  { name: 'Webhooks', count: 5 },
] as const;

function McpSection() {
  return (
    <section className="border-b border-border dark:border-border-dark relative overflow-hidden">
      <GridBg />
      <NoiseOverlay />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
        <div className="mb-12 md:mb-16 max-w-3xl">
          <div className="flex items-center gap-2 mb-4">
            <span className="font-mono text-xs text-primary dark:text-primary-light border border-primary/30 dark:border-primary-light/30 rounded-sm px-2 py-0.5">MCP</span>
            <span className="font-mono text-xs text-text-muted dark:text-text-muted-dark">Model Context Protocol</span>
          </div>
          <h2 className="font-display font-bold tracking-tight text-text-primary dark:text-text-primary-dark text-[clamp(1.75rem,4vw,2.75rem)] leading-tight">
            Automate everything with MCP
          </h2>
          <p className="mt-3 text-text-secondary dark:text-text-secondary-dark leading-relaxed">
            AI agents create, run, and inspect API test workflows programmatically. 40+ scoped tools across 8 domains, over stdio or Streamable HTTP. Point Claude, Cursor, or any MCP client at your instance — they do the rest.
          </p>
        </div>

        {/* Flow diagram: Agent → MCP Server → APIWeave */}
        <div className="grid md:grid-cols-3 gap-4 md:gap-2 items-stretch mb-12">
          <div className="flex flex-col items-center justify-center gap-3 border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised rounded-sm p-6 text-center">
            <div className="w-12 h-12 flex items-center justify-center border border-border dark:border-border-dark rounded-sm text-text-primary dark:text-text-primary-dark">
              <Brain className="w-5 h-5" strokeWidth={2} />
            </div>
            <div>
              <div className="font-semibold text-sm text-text-primary dark:text-text-primary-dark">AI Agent</div>
              <div className="font-mono text-xs text-text-muted dark:text-text-muted-dark mt-1">Claude · Cursor · custom</div>
            </div>
          </div>
          <div className="flex flex-col items-center justify-center gap-3 border border-primary ring-2 ring-primary bg-surface-raised dark:bg-surface-dark-raised rounded-sm p-6 text-center relative">
            <div className="w-12 h-12 flex items-center justify-center border border-primary rounded-sm text-primary dark:text-primary-light">
              <Boxes className="w-5 h-5" strokeWidth={2} />
            </div>
            <div>
              <div className="font-semibold text-sm text-primary dark:text-primary-light">MCP Server</div>
              <div className="font-mono text-xs text-text-muted dark:text-text-muted-dark mt-1">40+ scoped tools</div>
            </div>
          </div>
          <div className="flex flex-col items-center justify-center gap-3 border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised rounded-sm p-6 text-center">
            <div className="w-12 h-12 flex items-center justify-center border border-border dark:border-border-dark rounded-sm text-text-primary dark:text-text-primary-dark">
              <Workflow className="w-5 h-5" strokeWidth={2} />
            </div>
            <div>
              <div className="font-semibold text-sm text-text-primary dark:text-text-primary-dark">APIWeave</div>
              <div className="font-mono text-xs text-text-muted dark:text-text-muted-dark mt-1">workflows · runs · secrets</div>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          {/* Tool domains + transports */}
          <div className="flex flex-col gap-6">
            <div>
              <h3 className="font-semibold text-sm text-text-primary dark:text-text-primary-dark mb-4">Tool domains</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border dark:bg-border-dark border border-border dark:border-border-dark rounded-sm overflow-hidden">
                {MCP_DOMAINS.map((d) => (
                  <div key={d.name} className="bg-surface-raised dark:bg-surface-dark-raised p-3 flex flex-col gap-1">
                    <span className="font-mono text-lg font-bold text-text-primary dark:text-text-primary-dark leading-none">{d.count}</span>
                    <span className="text-xs text-text-secondary dark:text-text-secondary-dark">{d.name}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-sm text-text-primary dark:text-text-primary-dark mb-4">Transports</h3>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3 border border-border dark:border-border-dark rounded-sm p-3">
                  <Terminal className="w-4 h-4 text-primary dark:text-primary-light shrink-0" />
                  <div className="min-w-0">
                    <span className="font-mono text-xs font-semibold text-text-primary dark:text-text-primary-dark">stdio</span>
                    <span className="text-xs text-text-secondary dark:text-text-secondary-dark ml-2">local CLI &amp; desktop agents — service-token auth</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 border border-border dark:border-border-dark rounded-sm p-3">
                  <Globe className="w-4 h-4 text-primary dark:text-primary-light shrink-0" />
                  <div className="min-w-0">
                    <span className="font-mono text-xs font-semibold text-text-primary dark:text-text-primary-dark">Streamable HTTP</span>
                    <span className="text-xs text-text-secondary dark:text-text-secondary-dark ml-2">IDE, browser &amp; remote agents — mounted at /mcp</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Code example: AI agent automating a workflow via MCP */}
          <div className="bg-surface-raised dark:bg-surface-dark-raised border border-border dark:border-border-dark rounded-sm overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay">
              <Brain className="w-3.5 h-3.5 text-text-muted dark:text-text-muted-dark" />
              <span className="font-mono text-xs text-text-secondary dark:text-text-secondary-dark">agent → mcp</span>
            </div>
            <pre className="p-4 sm:p-6 font-mono text-xs leading-relaxed text-text-primary dark:text-text-primary-dark overflow-x-auto max-w-full"><code>{`User: "Test the /login endpoint
       and assert the token comes back"

agent calls:
  → workflow_create(name="login-test")
  → workflow_update(nodes=[
      HTTP POST /login,
      Assertion status==200,
      Assertion body.token exists
    ])
  → workflow_run(workflow_id="wf_...")

  ← run_get_status → "completed"
  ← run_get_results →
      ✓ POST /login    200 OK
      ✓ status == 200
      ✓ token extracted
      run artifacts: JUnit + HTML`}</code></pre>
          </div>
        </div>
      </div>
    </section>
  );
}

function SelfHost() {
  return (
    <section id="self-host" className="border-b border-border dark:border-border-dark">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div className="flex flex-col gap-6">
            <h2 className="font-display font-bold tracking-tight text-text-primary dark:text-text-primary-dark text-[clamp(1.75rem,4vw,2.75rem)] leading-tight">
              Self-host in two commands
            </h2>
            <p className="text-text-secondary dark:text-text-secondary-dark leading-relaxed">
              Python 3.13+, Node.js 20+, MongoDB 7+. The first sign-in becomes your instance owner. No telemetry, no cloud dependency.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="#docs">
                <Button variant="outline" size="md" icon={<BookOpen className="w-4 h-4" />}>Read the docs</Button>
              </a>
              <Link to="/login">
                <Button variant="ghost" size="md" icon={<ArrowRight className="w-4 h-4" />}>Try it now</Button>
              </Link>
            </div>
          </div>
          <div className="bg-surface-raised dark:bg-surface-dark-raised border border-border dark:border-border-dark rounded-sm overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay">
              <Terminal className="w-3.5 h-3.5 text-text-muted dark:text-text-muted-dark" />
              <span className="font-mono text-xs text-text-secondary dark:text-text-secondary-dark">quick-start</span>
            </div>
            <pre className="p-4 sm:p-6 font-mono text-xs sm:text-sm leading-relaxed text-text-primary dark:text-text-primary-dark overflow-x-auto"><code>{`# Clone
git clone https://github.com/your-org/apiweave
cd apiweave

# Setup + start (one-time setup, then dev server)
./setup.sh && ./start-dev.sh

# Open the app
# http://localhost:3000`}</code></pre>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-surface-raised dark:bg-surface-dark-raised">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="flex flex-col gap-1">
            <span className="font-display font-extrabold tracking-tight text-text-primary dark:text-text-primary-dark">APIWeave</span>
            <span className="font-mono text-xs text-text-muted dark:text-text-muted-dark">Visual API test workflows. Open-source, MIT.</span>
          </div>
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <a href="#docs" className="text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark transition-colors">Docs</a>
            <a href="https://github.com" target="_blank" rel="noreferrer" className="text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark transition-colors">GitHub</a>
            <a href="#self-host" className="text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark transition-colors">Self-host</a>
            <Link to="/login" className="text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark transition-colors">Sign in</Link>
          </nav>
        </div>
        <div className="mt-8 pt-6 border-t border-border dark:border-border-dark flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <span className="font-mono text-[10px] text-text-muted dark:text-text-muted-dark">© {new Date().getFullYear()} APIWeave. MIT licensed.</span>
          <span className="font-mono text-[10px] text-text-muted dark:text-text-muted-dark flex items-center gap-1.5"><GitBranch className="w-3 h-3" /> Self-hosted. No telemetry.</span>
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-surface dark:bg-surface-dark text-text-primary dark:text-text-primary-dark flex flex-col overflow-x-hidden">
      <Nav />
      <main className="flex-1">
        <Hero />
        <HowItWorks />
        <Features />
        <McpSection />
        <SelfHost />
      </main>
      <Footer />
    </div>
  );
}
