import { useFooterStatus } from "../../hooks/useFooterStatus";
import { openAbout } from "../../stores/AboutStore";
import type { FooterRunPhase } from "../../types";

/** The status token each run phase paints, as text colour; the dot follows it. */
const STATUS_COLOR: Readonly<Record<FooterRunPhase, string>> = {
  running: "text-status-info",
  completed: "text-status-success",
  failed: "text-status-error",
  cancelled: "text-status-warning",
  interrupted: "text-status-warning",
};

export function MainFooter() {
  const appVersion = import.meta.env.VITE_APP_VERSION ?? "0.0.0";
  const footerStatus = useFooterStatus();

  return (
    <footer className="flex h-footer min-h-0 items-center justify-between border-t border-border bg-surface-raised px-4 font-mono text-xs text-text-secondary transition-colors dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-secondary-dark">
      <div className="flex items-center gap-2">
        {/* The version is the way into About: it is the one piece of
            self-description the bar already carries. */}
        <button
          type="button"
          onClick={openAbout}
          aria-label="About APIWeave"
          className="cursor-pointer rounded-xs border border-border bg-surface-overlay px-2 py-0.5 text-2xs text-text-secondary transition-colors hover:border-(--aw-primary) hover:text-text-primary focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-2 dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-secondary-dark dark:hover:border-(--aw-primary) dark:hover:text-text-primary-dark"
        >
          v{appVersion}
        </button>
      </div>

      <div
        aria-live="polite"
        aria-atomic="true"
        className="flex items-center gap-1.5"
      >
        {footerStatus !== null ? (
          <div
            className={`flex items-center gap-1.5 ${STATUS_COLOR[footerStatus.phase]}`}
          >
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full bg-current ${
                footerStatus.phase === "running"
                  ? "animate-pulse motion-reduce:animate-none"
                  : ""
              }`}
            />
            <span>{footerStatus.label}</span>
          </div>
        ) : null}
      </div>

      {/* The GitHub link moved into About, which is where the project, its docs
          and the credits already are; this bar is status, not a directory. */}
      <div aria-hidden="true" />
    </footer>
  );
}
