import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Pencil, Plus, RefreshCw, Star, Trash2 } from "lucide-react";
import type { AgentAvailabilityState } from "@shared/types/AgentAvailability";
import type { AgentDefinition } from "@shared/types/AgentDefinition";
import type { AgentRosterEntry } from "@shared/types/AgentsBridge";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { IconButton } from "../atoms/IconButton";
import { Spinner } from "../atoms/Spinner";
import { TextArea } from "../atoms/TextArea";
import { EmptyState } from "../molecules/EmptyState";
import { ConfirmDialog } from "../molecules/ConfirmDialog";
import { FormField } from "../molecules/FormField";
import { Modal } from "../molecules/Modal";
import { StatusBadge } from "../molecules/StatusBadge";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import useAgentRosterStore from "../../stores/AgentRosterStore";
import { agents } from "../../utils/apiweaveClient";
import type { StatusBadgeProps } from "../../types";

interface AgentsSettingsModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

/**
 * Availability is encoded three ways at once — badge colour, the badge's own
 * Lucide glyph, and a text label — per DESIGN.md's rule that state is never
 * carried by hue alone.
 */
const AVAILABILITY_BADGE: Record<
  AgentAvailabilityState,
  { readonly status: StatusBadgeProps["status"]; readonly label: string }
> = {
  ready: { status: "success", label: "Ready" },
  broken: { status: "error", label: "Broken" },
  "not-found": { status: "idle", label: "Not installed" },
  unsupported: { status: "skipped", label: "Unsupported" },
};

/**
 * The form state is strings, not an `AgentDefinition`: argv and MCP args are
 * edited space-separated and env as KEY=VALUE lines, all of which become real
 * values only in `submit` — and only there, because splitting and parsing is
 * where a user's text turns into an argv array and a record.
 */
interface AgentDraft {
  readonly agentKey: string;
  readonly name: string;
  readonly detectCmd: string;
  readonly argv: string;
  readonly promptMode: "none" | "argv" | "flag";
  readonly promptFlag: string;
  readonly mcpArgs: string;
  readonly env: string;
}

const EMPTY_DRAFT: AgentDraft = {
  agentKey: "",
  name: "",
  detectCmd: "",
  argv: "",
  promptMode: "none",
  promptFlag: "",
  mcpArgs: "",
  env: "",
};

// fallow-ignore-next-line complexity -- the modal coordinates roster loading, availability refresh, add/edit form state and delete confirmation; each concern is already a named helper or a sibling component (AgentRow, AgentDraftForm-shaped fields), and splitting the coordinator further would scatter one workflow across files
export function AgentsSettingsModal({
  isOpen,
  onClose,
}: AgentsSettingsModalProps) {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.workspaceId ?? null;

  const [roster, setRoster] = useState<readonly AgentRosterEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentDraft>(EMPTY_DRAFT);
  const [adding, setAdding] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentRosterEntry | null>(null);
  // Mounted *and* open, which are not the same thing here: `SettingsContent`
  // renders this once and only toggles `isOpen`, so a plain mounted check is
  // true for the life of the app and guards nothing. A probe of a missing CLI
  // takes seconds, and one settling after the user closed the panel wrote its
  // result anyway — an error arriving after the close-reset below survived to
  // the next open, blaming a refresh the user had already walked away from.
  const liveRef = useRef(false);
  const rosterChanged = useAgentRosterStore((state) => state.rosterChanged);

  useEffect(() => {
    liveRef.current = isOpen;
    return () => {
      liveRef.current = false;
    };
  }, [isOpen]);

  const load = useCallback(
    (refresh: boolean) => {
      if (workspaceId === null) return;
      setBusy(true);
      const request = refresh
        ? agents.refreshAvailability(workspaceId)
        : agents.listRoster(workspaceId);
      void request
        .then((next) => {
          if (!liveRef.current) return;
          setRoster(next);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (liveRef.current) setError(describe(cause));
        })
        .finally(() => {
          if (liveRef.current) setBusy(false);
        });
    },
    [workspaceId],
  );

  useEffect(() => {
    if (!isOpen) {
      // Closing is the only reset this form gets. Nothing unmounts it, so an
      // abandoned half-typed draft, the error that made the user give up, and an
      // open delete confirmation all survive until the next open — where they
      // reappear as a form the user did not ask for, over a roster that has since
      // been re-read. The roster itself is kept: it is a cache of main's list,
      // and dropping it would flash an empty panel on every reopen.
      setAdding(false);
      setEditingKey(null);
      setDraft(EMPTY_DRAFT);
      setError(null);
      setFormError(null);
      setDeleteTarget(null);
      return;
    }
    load(false);
  }, [isOpen, load]);

  const available = agents.isAvailable();
  const formOpen = adding || editingKey !== null;

  /**
   * What every committed roster change does afterwards.
   *
   * `rosterChanged` is the half that is not about this modal: the launch controls
   * in the canvas toolbar hold their own copy of the roster and nothing pushes
   * one to them, so a new default set here was invisible to the button that
   * launches it until the toolbar next remounted.
   */
  const afterRosterChange = (): void => {
    rosterChanged();
    if (liveRef.current) load(false);
  };

  /**
   * What every committed roster change runs through: busy while it is in
   * flight, then {@link afterRosterChange}, with the failure reported in the
   * panel rather than swallowed.
   */
  const runRosterAction = (action: Promise<unknown>): void => {
    setBusy(true);
    void action.then(afterRosterChange).catch((cause: unknown) => {
      if (!liveRef.current) return;
      setError(describe(cause));
      setBusy(false);
    });
  };

  const onSetDefault = (agentKey: string): void => {
    if (workspaceId === null) return;
    runRosterAction(agents.setDefaultAgentKey(workspaceId, agentKey));
  };

  const onConfirmDelete = (): void => {
    if (workspaceId === null || deleteTarget === null) return;
    const agentKey = deleteTarget.definition.agentKey;
    setDeleteTarget(null);
    runRosterAction(agents.deleteCustomAgent(workspaceId, agentKey));
  };

  const openAdd = (): void => {
    setDraft(EMPTY_DRAFT);
    setAdding(true);
    setEditingKey(null);
    setFormError(null);
  };

  const openEdit = (entry: AgentRosterEntry): void => {
    setDraft(toDraft(entry.definition));
    setAdding(false);
    setEditingKey(entry.definition.agentKey);
    setFormError(null);
  };

  const closeForm = (): void => {
    setAdding(false);
    setEditingKey(null);
    setFormError(null);
  };

  const submit = (): void => {
    if (workspaceId === null) return;
    const agentKey = draft.agentKey.trim();
    if (
      agentKey.length === 0 ||
      draft.name.trim().length === 0 ||
      draft.detectCmd.trim().length === 0
    ) {
      return;
    }
    const parsed = submissionEnv(draft);
    if (!parsed.ok) {
      setFormError(parsed.error);
      return;
    }
    setFormError(null);
    setBusy(true);
    const edited =
      editingKey === null
        ? null
        : (roster.find(
            (entry) => entry.definition.agentKey === editingKey,
          )?.definition ?? null);
    void agents
      .saveCustomAgent(workspaceId, savePayload(draft, agentKey, parsed.env, edited))
      .then(() => {
        if (liveRef.current) closeForm();
        afterRosterChange();
      })
      .catch((cause: unknown) => {
        if (!liveRef.current) return;
        setFormError(describe(cause));
        setBusy(false);
      });
  };

  const canSubmit =
    draft.agentKey.trim().length > 0 &&
    draft.name.trim().length > 0 &&
    draft.detectCmd.trim().length > 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Agents" size="lg">
      <div className="space-y-5 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
            Launch a coding agent in a project&apos;s folder. APIWeave runs the
            CLI you already have installed, under your own account — it never
            proxies or logs you in. Set a project&apos;s folder from Projects, or
            a workflow&apos;s from the canvas toolbar.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => load(true)}
            disabled={busy || !available}
            icon={<RefreshCw className="h-3.5 w-3.5" />}
          >
            Refresh
          </Button>
        </div>

        {!available && (
          <p className="text-xs text-status-warning">
            Agents are only available in the desktop app.
          </p>
        )}

        {error !== null && (
          <p className="text-xs text-status-error" role="alert">
            {error}
          </p>
        )}

        {/*
          Three states, not two. The first open has no roster and a probe in
          flight — every built-in agent is being looked for on PATH, which is
          slow enough to see — and the earlier version rendered an empty `<ul>`
          for it: a blank panel that looks like a broken modal rather than a
          loading one. The spinner is only for that first fetch; a Refresh over
          an existing list keeps the list on screen, because replacing rows the
          user is reading with a spinner is the worse trade.
        */}
        {available && busy && roster.length === 0 ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : available && roster.length === 0 && !busy ? (
          <EmptyState
            title="No agents configured"
            description="Install a supported CLI, or add your own command below."
          />
        ) : (
          <ul className="space-y-1">
            {roster.map((entry) => (
              <AgentRow
                key={entry.definition.agentKey}
                entry={entry}
                busy={busy}
                onSetDefault={onSetDefault}
                onEdit={openEdit}
                onDelete={setDeleteTarget}
              />
            ))}
          </ul>
        )}

        <div className="border-t border-border pt-4 dark:border-border-dark">
          {formOpen ? (
            <div className="space-y-3">
              {formError !== null && (
                <p className="text-xs text-status-error" role="alert">
                  {formError}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  label="Key"
                  hint="Stable identifier, e.g. my-agent"
                  required
                >
                  <Input
                    value={draft.agentKey}
                    onChange={(event) =>
                      setDraft({ ...draft, agentKey: event.target.value })
                    }
                    disabled={editingKey !== null}
                    size="sm"
                  />
                </FormField>
                <FormField label="Display name" required>
                  <Input
                    value={draft.name}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                    size="sm"
                  />
                </FormField>
              </div>
              <FormField
                label="Command"
                hint="The binary to look for on PATH"
                required
              >
                <Input
                  value={draft.detectCmd}
                  onChange={(event) =>
                    setDraft({ ...draft, detectCmd: event.target.value })
                  }
                  size="sm"
                />
              </FormField>
              <FormField
                label="Arguments"
                hint="Space-separated. Passed through as-is — no shell is involved."
              >
                <Input
                  value={draft.argv}
                  onChange={(event) =>
                    setDraft({ ...draft, argv: event.target.value })
                  }
                  size="sm"
                />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  label="Opening prompt"
                  hint="How a prompt is handed to the agent when a launch carries one."
                >
                  <select
                    value={draft.promptMode}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        promptMode: event.target.value as AgentDraft["promptMode"],
                      })
                    }
                    aria-label="Prompt mode"
                    className="w-full rounded-sm border border-border bg-surface-raised px-2 py-1.5 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark"
                  >
                    <option value="none">Not supported</option>
                    <option value="argv">As positional argument</option>
                    <option value="flag">As flag value</option>
                  </select>
                </FormField>
                <FormField
                  label="Prompt flag"
                  hint="Required when the prompt is a flag value"
                  {...(draft.promptMode === "flag" &&
                  draft.promptFlag.trim().length === 0
                    ? { error: "Needed in flag mode" }
                    : {})}
                >
                  <Input
                    value={draft.promptFlag}
                    onChange={(event) =>
                      setDraft({ ...draft, promptFlag: event.target.value })
                    }
                    disabled={draft.promptMode !== "flag"}
                    placeholder="--message"
                    size="sm"
                  />
                </FormField>
              </div>
              <FormField
                label="MCP config arguments"
                hint="Space-separated flags that point your CLI at a config file, using {path} where the file goes — e.g. --mcp-config {path}. Empty means the agent launches without MCP wiring."
              >
                <Input
                  value={draft.mcpArgs}
                  onChange={(event) =>
                    setDraft({ ...draft, mcpArgs: event.target.value })
                  }
                  placeholder="--mcp-config {path}"
                  size="sm"
                />
              </FormField>
              <FormField
                label="Environment"
                hint="One KEY=VALUE per line, added to the agent's launch environment."
              >
                <TextArea
                  value={draft.env}
                  onChange={(event) =>
                    setDraft({ ...draft, env: event.target.value })
                  }
                  placeholder={"FOO=bar"}
                  size="sm"
                  rows={3}
                />
              </FormField>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={closeForm}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={submit}
                  disabled={!canSubmit || busy}
                >
                  {editingKey === null ? "Add agent" : "Save agent"}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={openAdd}
              disabled={!available}
              icon={<Plus className="h-3.5 w-3.5" />}
            >
              Add custom agent
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={onConfirmDelete}
        title="Remove agent"
        message={`Remove ${deleteTarget?.definition.name ?? "this agent"}? The roster entry is deleted; sessions already launched keep their records.`}
        confirmLabel="Remove"
        intent="error"
      />
    </Modal>
  );
}

interface AgentRowProps {
  readonly entry: AgentRosterEntry;
  readonly busy: boolean;
  readonly onSetDefault: (agentKey: string) => void;
  readonly onEdit: (entry: AgentRosterEntry) => void;
  readonly onDelete: (entry: AgentRosterEntry) => void;
}

// fallow-ignore-next-line complexity -- one presentational branch per action an availability state earns (install, make default, edit, delete); the CRAP score is the estimated-coverage artifact, not real branch depth
function AgentRow({ entry, busy, onSetDefault, onEdit, onDelete }: AgentRowProps) {
  const badge = AVAILABILITY_BADGE[entry.availability.state];
  const installUrl = entry.definition.installUrl;
  const detail = entry.availability.detail ?? entry.definition.detectCmd;
  return (
    <li className="flex items-center gap-3 rounded border border-border px-3 py-2 dark:border-border-dark">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text-primary dark:text-text-primary-dark">
            {entry.definition.name}
          </span>
          {entry.isDefault && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary dark:text-primary-light">
              Default
            </span>
          )}
        </div>
        {/*
          The failure text goes on screen verbatim. An agent that resolves on
          PATH and then refuses to run is otherwise indistinguishable from one
          that works, and the reason is always in its own error message.

          Which is why `broken` is the one state that must not be truncated:
          the healthy details are short and interchangeable ("1.18.18",
          "installed"), but a failure names a path and a cause, and clipping it
          at one line leaves exactly the actionable half off screen. Measured:
          the Windows loader refusing a stub `opencode.exe` reads "This version
          of <200 chars of path> is not compatible with…" — everything past the
          ellipsis is the part that says what to do.
        */}
        <p
          title={detail}
          className={`mt-0.5 text-xs text-text-secondary dark:text-text-secondary-dark ${
            entry.availability.state === "broken" ? "break-words" : "truncate"
          }`}
        >
          {detail}
        </p>
      </div>
      <StatusBadge status={badge.status} label={badge.label} size="xs" />
      {entry.availability.state === "not-found" &&
        installUrl !== null &&
        installUrl !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openInstallUrl(installUrl)}
            icon={<ExternalLink className="h-3.5 w-3.5" />}
          >
            Install
          </Button>
        )}
      {!entry.isDefault && entry.availability.state === "ready" && (
        <IconButton
          tooltip="Make default"
          aria-label={`Make ${entry.definition.name} the default agent`}
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => onSetDefault(entry.definition.agentKey)}
        >
          <Star className="h-3.5 w-3.5" />
        </IconButton>
      )}
      {entry.isCustom && (
        <IconButton
          tooltip="Edit"
          aria-label={`Edit ${entry.definition.name}`}
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => onEdit(entry)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </IconButton>
      )}
      {entry.isCustom && (
        <IconButton
          tooltip="Remove"
          aria-label={`Remove ${entry.definition.name}`}
          size="sm"
          variant="error"
          disabled={busy}
          onClick={() => onDelete(entry)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      )}
    </li>
  );
}

function openInstallUrl(url: string): void {
  // The same path every other external link takes: main's
  // `setWindowOpenHandler` hands http(s) to the system browser. Checked here
  // too because the URL is data, not a constant.
  if (/^https?:\/\//i.test(url)) window.open(url, "_blank");
}

function toDraft(definition: AgentDefinition): AgentDraft {
  const mode: AgentDraft["promptMode"] =
    definition.promptMode === "argv" || definition.promptMode === "flag"
      ? definition.promptMode
      : "none";
  return {
    agentKey: definition.agentKey,
    name: definition.name,
    detectCmd: definition.detectCmd,
    argv: definition.argv.join(" "),
    promptMode: mode,
    promptFlag: definition.promptFlag ?? "",
    mcpArgs: definition.mcpConfigArgs.join(" "),
    env: Object.entries(definition.env)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
  };
}

function splitArgs(text: string): string[] {
  return text.split(/\s+/).filter((part) => part.length > 0);
}

/**
 * Validate the two parts of a draft that can fail in `submit` — the flag-mode
 * prompt flag, and the env text — and return either the parsed env or the
 * error the user should see.
 */
function submissionEnv(
  draft: AgentDraft,
): { readonly ok: true; readonly env: Record<string, string> } | { readonly ok: false; readonly error: string } {
  if (draft.promptMode === "flag" && draft.promptFlag.trim().length === 0) {
    return {
      ok: false,
      error: "A prompt flag is required when the prompt is passed as a flag value.",
    };
  }
  try {
    return { ok: true, env: parseEnvLines(draft.env) };
  } catch (cause) {
    return { ok: false, error: describe(cause) };
  }
}

/**
 * What the carry-over fields fall back to for a genuinely new agent — the same
 * "empty" values a fresh `AgentDefinition` would carry, in one place so
 * {@link savePayload} spreads them per field under the edited entry instead of
 * spelling a chain of per-field `??` decisions.
 */
const CARRIED_DEFAULTS: Pick<
  AgentDefinition,
  | "expectedProcess"
  | "briefingArgs"
  | "unsupportedPlatforms"
  | "installUrl"
  | "sessionIdMode"
  | "newSessionArgs"
  | "resumeArgs"
  | "sessionIdPattern"
> = {
  expectedProcess: null,
  briefingArgs: [],
  unsupportedPlatforms: [],
  installUrl: null,
  sessionIdMode: "none",
  newSessionArgs: [],
  resumeArgs: [],
  sessionIdPattern: null,
};

/**
 * The definition `submit` saves. The form owns only part of a definition —
 * `saveCustomAgent` is a full replacement — so every field that is not on it
 * is carried over from the entry being edited, or from
 * {@link CARRIED_DEFAULTS} for a genuinely new agent.
 *
 * Defaults spread *under* the edited entry, so each field falls back per
 * field rather than per object: an edited definition may legitimately omit an
 * optional field (a built-in roster entry simply has no `expectedProcess`
 * key), and an omitted field must reach the payload as the schema's null or
 * empty value, never as `undefined` — the modal normalises what it sends.
 *
 * `expectedProcess` names the process a shim actually spawns,
 * `unsupportedPlatforms` greys the agent out where it cannot run, `installUrl`
 * is the Install link: restating any of them as empty would silently delete
 * them from an agent the user was only renaming.
 *
 * The same carry-over matters more for the briefing and resume fields, which
 * are also not on the form. `briefingArgs` blanked would leave the agent
 * launching without the context that tells it which workflow it is working
 * on; the session-identity four are how a session is reopened later, so
 * resetting them would quietly make every future session of a renamed agent
 * unresumable. A new custom agent starts without them — resume flags differ
 * per CLI, and guessing one produces an agent that fails at the moment
 * someone tries to recover a conversation.
 */
function savePayload(
  draft: AgentDraft,
  agentKey: string,
  env: Record<string, string>,
  edited: AgentDefinition | null,
): AgentDefinition {
  const carried = { ...CARRIED_DEFAULTS, ...edited };
  return {
    agentKey,
    name: draft.name.trim(),
    detectCmd: draft.detectCmd.trim(),
    // Split on whitespace rather than shell-parsing: the value is an argv
    // array all the way down to `spawn`, and never reaches a shell.
    argv: splitArgs(draft.argv),
    expectedProcess: carried.expectedProcess,
    env,
    promptMode: draft.promptMode,
    promptFlag:
      draft.promptMode === "flag" ? draft.promptFlag.trim() : null,
    mcpConfigArgs: splitArgs(draft.mcpArgs),
    briefingArgs: carried.briefingArgs,
    unsupportedPlatforms: carried.unsupportedPlatforms,
    installUrl: carried.installUrl,
    sessionIdMode: carried.sessionIdMode,
    newSessionArgs: carried.newSessionArgs,
    resumeArgs: carried.resumeArgs,
    sessionIdPattern: carried.sessionIdPattern,
  };
}

/**
 * `KEY=VALUE` lines into a record. A line without `=` or with an empty key is
 * a mistake the user wants to hear about, not one to silently drop: the env
 * they thought they configured would be missing from the launch.
 */
function parseEnvLines(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      throw new Error(`Environment lines must be KEY=VALUE — got: ${trimmed}`);
    }
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
