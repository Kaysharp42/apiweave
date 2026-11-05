import { useEffect, useState } from "react";
import { BookOpen, Check, Copy, FolderOpen } from "lucide-react";
import type { AppInfo } from "@shared/types/AppInfo";
import { Modal } from "../molecules/Modal";
import { Button } from "../atoms/Button";
import { Spinner } from "../atoms/Spinner";
import { apiweave } from "../../utils/apiweaveClient";
import { diagnosticsText, platformLabel } from "../../utils/aboutInfo";
import {
  ABOUT_DOCS_URL,
  ABOUT_LICENCE,
  ABOUT_REPO_URL,
} from "../../constants/AboutLinks";
import useAboutStore from "../../stores/AboutStore";

type Copied = "diagnostics" | "path" | null;

/** lucide dropped brand marks; this is the GitHub logo at the links' icon size. */
function GithubMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className="h-4 w-4"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function InfoRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-text-muted dark:text-text-muted-dark">{label}</dt>
      <dd className="min-w-0 break-words font-mono text-xs text-text-primary dark:text-text-primary-dark">
        {children}
      </dd>
    </>
  );
}

/**
 * About APIWeave — the one place the app describes itself: versions, platform,
 * data folder and where its source and docs live. Opened by the footer's
 * version pill or the command palette, mounted once by the shell.
 *
 * Everything it reports comes from main over the `app` IPC domain; the dialog
 * never guesses an Electron or Node version from the bundle it is running in.
 */
export function AboutDialog() {
  const isOpen = useAboutStore((state) => state.isOpen);
  const close = useAboutStore((state) => state.close);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState<Copied>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setInfo(null);
    setLoadError(null);
    setCopied(null);
    apiweave.app
      .info()
      .then((loaded) => {
        if (!cancelled) setInfo(loaded);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "The app details could not be read.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const copy = (text: string, kind: Exclude<Copied, null>) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(kind))
      .catch(() => undefined);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="About APIWeave"
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={close}>
            Close
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={info === null}
            onClick={() => {
              if (info !== null) copy(diagnosticsText(info), "diagnostics");
            }}
          >
            {copied === "diagnostics" ? "Copied" : "Copy diagnostics"}
          </Button>
        </>
      }
    >
      <div className="space-y-5 p-5 text-sm text-text-secondary dark:text-text-secondary-dark">
        <div className="flex items-center gap-4">
          <img
            src="/apiweave.png"
            alt=""
            className="h-12 w-12 rounded-sm object-cover"
          />
          <div className="min-w-0">
            <p className="text-lg font-extrabold tracking-tight text-text-primary dark:text-text-primary-dark">
              APIWeave
            </p>
            <p className="text-xs text-text-muted dark:text-text-muted-dark">
              {info === null ? "…" : `v${info.version}`} · local-first API
              workflows
            </p>
          </div>
        </div>

        {loadError !== null ? (
          <p role="alert" className="text-status-error dark:text-(--aw-status-error)">
            {loadError}
          </p>
        ) : info === null ? (
          <div className="flex items-center gap-2 text-text-muted dark:text-text-muted-dark">
            <Spinner size="sm" />
            <span>Reading app details…</span>
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-[7.5rem_1fr] gap-x-4 gap-y-1.5">
              <InfoRow label="Electron">{info.electron}</InfoRow>
              <InfoRow label="Chromium">{info.chromium}</InfoRow>
              <InfoRow label="Node">{info.node}</InfoRow>
              <InfoRow label="Platform">{platformLabel(info)}</InfoRow>
              <InfoRow label="Licence">{ABOUT_LICENCE}</InfoRow>
            </dl>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-muted-dark">
                Data folder
              </p>
              <div className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-xs border border-border bg-surface-overlay px-2 py-1 font-mono text-xs text-text-primary dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-primary-dark">
                  {info.dataFolder}
                </code>
                <Button
                  variant="outline"
                  size="xs"
                  icon={<FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />}
                  onClick={() => {
                    void apiweave.app.revealDataFolder().catch(() => undefined);
                  }}
                >
                  Reveal
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  icon={
                    copied === "path" ? (
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    )
                  }
                  aria-label="Copy data folder path"
                  onClick={() => copy(info.dataFolder, "path")}
                >
                  {copied === "path" ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          </>
        )}

        <div className="space-y-2 border-t border-border pt-4 dark:border-border-dark">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-muted-dark">
            Links
          </p>
          <div className="flex flex-wrap gap-4">
            <a
              href={ABOUT_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-primary hover:underline dark:text-primary-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--aw-primary)"
            >
              <GithubMark />
              GitHub repository
            </a>
            <a
              href={ABOUT_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-primary hover:underline dark:text-primary-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--aw-primary)"
            >
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              Documentation
            </a>
          </div>
        </div>

        <div className="border-t border-border pt-4 text-xs text-text-muted dark:border-border-dark dark:text-text-muted-dark">
          <p className="font-semibold uppercase tracking-wide">
            Acknowledgements
          </p>
          <p className="mt-1">
            Built with Electron, React and React Flow. React Flow is © its
            contributors and used under the MIT licence.
          </p>
        </div>
      </div>
    </Modal>
  );
}
