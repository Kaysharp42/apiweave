import { useState } from "react";
import { ExternalLink, Map as MapIcon, X } from "lucide-react";
import { Button } from "../atoms/Button";
import { IconButton } from "../atoms/IconButton";
import { Card } from "../molecules/Card";
import { TutorialCodeBlock } from "../molecules/TutorialCodeBlock";
import type { TutorialExample } from "../../types";

const STORAGE_KEY = "apiweave.codeMapCard.dismissed";
const GRAPHIFY_URL = "https://github.com/Graphify-Labs/graphify";
const CODEBASE_MEMORY_URL = "https://github.com/DeusData/codebase-memory-mcp";

const INSTALL_PROMPT: TutorialExample = {
  caption: "Paste this into your agent",
  language: "text",
  code: "Install graphify for this repository: run `uv tool install graphifyy` (or `pipx install graphifyy`), then `graphify install --project`, then build the graph with `/graphify .`. Ask me whether to commit or gitignore `graphify-out/`.",
};

// Same guarded-storage pattern as `useCanvasTip`: storage being unavailable
// (private mode, a locked-down profile) must not break the page or make the
// dismiss button lie — the card just comes back next time.
function wasDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistDismissal(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // See above.
  }
}

function openExternal(url: string): void {
  // The same path every other external link takes: main's
  // `setWindowOpenHandler` hands http(s) to the system browser.
  window.open(url, "_blank");
}

/**
 * A dismissible nudge in Settings → Agents: give the launched agent a graph of
 * the user's code so it queries instead of grepping. APIWeave only detects an
 * existing `graphify-out/` at launch; installing it is the user's (or their
 * agent's) decision, which is why this is a prompt to copy, not a button.
 */
export function CodeMapCard() {
  const [dismissed, setDismissed] = useState(wasDismissed);
  if (dismissed) return null;

  const dismiss = (): void => {
    setDismissed(true);
    persistDismissal();
  };

  return (
    <Card
      title="Give your agent a map of your code"
      icon={MapIcon}
      headerActions={
        <IconButton
          tooltip="Dismiss"
          aria-label="Dismiss code map tip"
          size="xs"
          variant="ghost"
          onClick={dismiss}
        >
          <X className="h-3.5 w-3.5" />
        </IconButton>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
          An agent that can query a graph of your repository reads far less than
          one that greps it, which means fewer tokens spent learning the API
          under test. APIWeave detects a{" "}
          <code className="font-mono">graphify-out/</code> folder in the
          project&apos;s folder and tells launched agents to use it.
        </p>
        <TutorialCodeBlock example={INSTALL_PROMPT} />
        <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
          The official PyPI package is{" "}
          <code className="font-mono">graphifyy</code> (double y). Other
          graphify* packages are not affiliated.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openExternal(GRAPHIFY_URL)}
            icon={<ExternalLink className="h-3.5 w-3.5" />}
          >
            graphify on GitHub
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openExternal(CODEBASE_MEMORY_URL)}
            icon={<ExternalLink className="h-3.5 w-3.5" />}
          >
            Alternative: codebase-memory-mcp
          </Button>
        </div>
      </div>
    </Card>
  );
}
