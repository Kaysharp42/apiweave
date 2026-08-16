import { useEffect, useRef } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
// xterm's own stylesheet, which owns the parts of the terminal it draws itself
// (the layered canvases, the offscreen textarea, the selection layer). Ours is
// `styles/agent-terminal.css`, imported from `index.css` beside the other app
// stylesheets — it only sets tokens and chrome, and never fights this one.
import "@xterm/xterm/css/xterm.css";
import { agents } from "../../utils/apiweaveClient";

/**
 * How much un-parsed output is allowed to pile up before the PTY is told to
 * stop, and how far it has to drain before it is told to continue.
 *
 * xterm.js parses far slower than a PTY can produce — a `npm test` in a large
 * repo outruns it easily — and without a limit the excess queues in the
 * renderer's heap until the tab dies. The gap between the two marks is
 * deliberate: one threshold would pause and resume on alternating chunks.
 */
const PAUSE_ABOVE_BYTES = 128 * 1024;
const RESUME_BELOW_BYTES = 16 * 1024;

interface AgentTerminalProps {
  readonly sessionId: string;
  /** Announced when the child exits, so the owner can settle its own chrome. */
  readonly onExit?: (exitCode: number) => void;
  /**
   * An exited session reopened for its scrollback: the replay plays, but there
   * is no process behind the PTY any more, so keystrokes must not pretend to
   * go anywhere. xterm swallows stdin entirely in this mode.
   */
  readonly readOnly?: boolean;
  readonly className?: string;
}

/**
 * One agent session, rendered as a real terminal.
 *
 * A terminal and not a log view, because the agents this launches assume one:
 * Claude Code draws a TUI, emits OSC 8 hyperlinks, and *queries* the terminal
 * with DA1 and XTVERSION — questions xterm.js answers and a `<pre>` would leave
 * hanging. It reads its own colours from the `--aw-term-*` tokens rather than
 * carrying a palette, so the one place a terminal colour is decided stays
 * `agent-terminal.css`.
 *
 * Output does not arrive through React state. Chunks come over a `MessagePort`
 * straight from the PTY host and go straight into xterm's parser; putting them
 * through a `useState` would re-render the tree once per chunk to update a
 * canvas React does not own.
 */
export function AgentTerminal({
  sessionId,
  onExit,
  readOnly = false,
  className,
}: AgentTerminalProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  // Kept in a ref so the effect below can stay keyed on `sessionId` alone: a
  // caller passing a fresh closure each render must not tear down the PTY.
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const viewport = viewportRef.current;
    if (wrapper === null || viewport === null) return undefined;

    const terminal = new Terminal({
      allowProposedApi: true,
      convertEol: false,
      cursorBlink: true,
      // xterm's screen-reader live region: terminal content is otherwise a
      // canvas no assistive technology can read.
      screenReaderMode: true,
      fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.35,
      // Deep enough to scroll back through a test run, bounded because every
      // line is retained in the renderer's heap.
      scrollback: 5_000,
      theme: themeFromTokens(wrapper),
      linkHandler: {
        // `window.open` rather than an IPC call: main already answers
        // `setWindowOpenHandler` by handing http(s) to the system browser and
        // denying the window, so this is the same path every other external
        // link in the app takes. The protocol is checked here as well because
        // the URL comes from whatever the agent printed.
        activate: (_event, text) => {
          if (/^https?:\/\//i.test(text)) window.open(text, "_blank");
        },
      },
    });

    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(viewport);
    terminalRef.current = terminal;

    // Tab is the escape hatch out of the terminal: xterm would otherwise send
    // it to the agent's stdin, leaving keyboard users no way past the last
    // control in the dock. Returning false hands the keypress back to the
    // browser, so focus moves with the normal Tab order; the agent's own tab
    // completion stays reachable as Ctrl+I, which is the same convention the
    // terminal emulators use.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        return false;
      }
      return true;
    });

    // WebGL is the difference between a readable and a stuttering terminal
    // under fast output, but it is also the one addon that can fail outright —
    // no WebGL2 context, or a driver that drops it later. Both fall back to the
    // DOM renderer, which is slower and always works.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      terminal.loadAddon(webgl);
    } catch {
      // DOM renderer it is.
    }

    let disposed = false;

    // ── backpressure ────────────────────────────────────────────────────
    let queuedBytes = 0;
    let paused = false;
    const writeChunk = (data: string): void => {
      queuedBytes += data.length;
      if (!paused && queuedBytes > PAUSE_ABOVE_BYTES) {
        paused = true;
        void agents.setPaused(sessionId, true);
      }
      terminal.write(data, () => {
        queuedBytes -= data.length;
        if (paused && queuedBytes < RESUME_BELOW_BYTES && !disposed) {
          paused = false;
          void agents.setPaused(sessionId, false);
        }
      });
    };

    // ── input ───────────────────────────────────────────────────────────
    const input = terminal.onData((data) => {
      void agents.write(sessionId, data);
    });

    // ── geometry ────────────────────────────────────────────────────────
    // The PTY is told the size after the fit, never before: the child renders
    // to whatever geometry it was last given, and a stale one is a TUI drawn to
    // the wrong width.
    const syncSize = (): void => {
      if (disposed) return;
      try {
        fit.fit();
      } catch {
        // Fit throws while the element has no layout — a collapsed dock, a
        // hidden tab. The observer fires again when it gets one.
        return;
      }
      void agents.resize(sessionId, terminal.cols, terminal.rows);
    };
    const observer = new ResizeObserver(syncSize);
    observer.observe(wrapper);
    syncSize();

    // ── output ──────────────────────────────────────────────────────────
    let detach: (() => void) | null = null;
    void agents
      .attachOutput(sessionId, (event) => {
        if (event.sessionId !== sessionId) return;
        if (event.kind === "output") {
          writeChunk(event.data);
          return;
        }
        // Written into the terminal rather than shown as chrome beside it: the
        // exit belongs at the end of the output it ends, where the user is
        // already looking.
        terminal.write(`\r\n\x1b[2m[process exited with code ${String(event.exitCode)}]\x1b[0m\r\n`);
        onExitRef.current?.(event.exitCode);
      })
      .then((unsubscribe) => {
        if (unsubscribe === null) {
          terminal.write(
            "\x1b[2mThis session's output is no longer available.\x1b[0m\r\n",
          );
          return;
        }
        if (disposed) {
          unsubscribe();
          return;
        }
        detach = unsubscribe;
        terminal.focus();
      })
      .catch((cause: unknown) => {
        terminal.write(
          `\r\n\x1b[31m${cause instanceof Error ? cause.message : String(cause)}\x1b[0m\r\n`,
        );
      });

    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      detach?.();
      // The pause protects this terminal's heap, and this terminal is gone. A
      // PTY left paused with no consumer would wedge the process for ever —
      // the output would stop flowing and, with it, any agent blocked on its
      // stdout. The host's attach-side resume covers the same for a renderer
      // that died without ever running this cleanup.
      if (paused) {
        paused = false;
        void agents.setPaused(sessionId, false);
      }
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [sessionId]);

  // Read-only is applied as an option update rather than a rebuild: a session
  // that exits while its terminal is open flips to read-only without throwing
  // away the scrollback the user is still reading. `disableStdin` is what makes
  // keystrokes stop at xterm instead of travelling to a process that is gone.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal !== null) terminal.options.disableStdin = readOnly;
  }, [readOnly]);

  return (
    <div
      ref={wrapperRef}
      className={`aw-agent-terminal ${className ?? ""}`}
      data-testid="agent-terminal"
      role="group"
      aria-label="Agent terminal"
    >
      <div ref={viewportRef} className="aw-agent-terminal__viewport" />
    </div>
  );
}

/** The `--aw-term-*` suffixes, paired with the xterm theme key each one fills. */
const THEME_TOKENS: readonly (readonly [keyof ITheme, string])[] = [
  ["background", "bg"],
  ["foreground", "fg"],
  ["cursor", "cursor"],
  ["cursorAccent", "cursor-accent"],
  ["selectionBackground", "selection"],
  ["selectionInactiveBackground", "selection-inactive"],
  ["black", "black"],
  ["red", "red"],
  ["green", "green"],
  ["yellow", "yellow"],
  ["blue", "blue"],
  ["magenta", "magenta"],
  ["cyan", "cyan"],
  ["white", "white"],
  ["brightBlack", "bright-black"],
  ["brightRed", "bright-red"],
  ["brightGreen", "bright-green"],
  ["brightYellow", "bright-yellow"],
  ["brightBlue", "bright-blue"],
  ["brightMagenta", "bright-magenta"],
  ["brightCyan", "bright-cyan"],
  ["brightWhite", "bright-white"],
];

/**
 * Read the terminal palette out of the `--aw-term-*` tokens on the element.
 *
 * Reading the tokens rather than restating them is what keeps the scoped
 * exception in `agent-terminal.css` honest: a colour changed there changes here,
 * and there is no second copy of the palette to forget — which is also why there
 * are no fallback values in this file. A slot whose token is missing is left
 * unset for xterm to default, because the alternative is twenty-two hex literals
 * living in a component, which is the thing the token family exists to prevent.
 */
function themeFromTokens(element: HTMLElement): ITheme {
  const styles = getComputedStyle(element);
  const theme: Record<string, string> = {};
  for (const [key, suffix] of THEME_TOKENS) {
    const value = styles.getPropertyValue(`--aw-term-${suffix}`).trim();
    if (value.length > 0) theme[key] = value;
  }
  return theme as ITheme;
}
