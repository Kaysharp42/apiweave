import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Info, ShieldAlert } from "lucide-react";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { Spinner } from "../atoms/Spinner";
import { FormField } from "../molecules/FormField";
import { Modal } from "../molecules/Modal";
import { WorkspaceSelect } from "./WorkspaceSelect";
import { useAsyncOptions } from "../../hooks/useAsyncOptions";
import { apiweave } from "../../utils/apiweaveClient";
import type { Workspace } from "../../types";

/** What the copy of an item kind gets — the notice the dialog shows. */
interface DuplicateNotice {
  readonly icon: ReactNode;
  readonly title: string;
  readonly items: readonly ReactNode[];
  /** Appended only when the chosen destination is another workspace. */
  readonly crossWorkspaceItem?: ReactNode;
}

/** The per-kind wording, defaults and notice of the duplicate dialog. */
interface DuplicateKindConfig {
  /** Appended to the source name for the copy's default name. */
  readonly copyNameSuffix: string;
  /** Shown under the name field when the name is referenced verbatim elsewhere. */
  readonly nameHint?: string;
  readonly nameMono: boolean;
  readonly notice: DuplicateNotice;
}

/**
 * Everything the two duplicate flows genuinely differ on.
 *
 * Environment: the destination defaults to the source, because duplicating in
 * place is the common case — a variant of an environment you already have.
 * Choosing a different workspace is the same operation, and the server drops
 * what cannot cross the border (see `EnvironmentService.duplicate`): the
 * `isDefault` claim always, and the base-environment link on a cross-workspace
 * copy, since a base must live in the same workspace as the environment
 * extending it. The secrets notice is the honest part. Secrets are never
 * copied — the copy gets the variables and nothing sealed — so an environment
 * whose requests authenticate through a secret will not work until those are
 * re-entered. Saying so here beats a duplicate that looks complete and fails at
 * run time.
 *
 * Secret: the VALUE comes along. That is the difference from duplicating an
 * environment (which deliberately leaves secrets behind) and it is the whole
 * reason this dialog exists — a secret cannot be read back, so "duplicate" that
 * copied only the name would leave the user with nothing to retype from. The
 * notice says so plainly: a copy into another workspace means the credential
 * now works in two places, and deleting it from one does not revoke the other.
 */
const KIND_CONFIG: {
  environment: DuplicateKindConfig;
  secret: DuplicateKindConfig;
} = {
  environment: {
    copyNameSuffix: " (copy)",
    nameMono: false,
    notice: {
      icon: (
        <Info
          className="h-3.5 w-3.5 flex-shrink-0 text-text-secondary dark:text-text-secondary-dark"
          aria-hidden="true"
        />
      ),
      title: "What the copy gets",
      items: [
        <>Variables and description are copied.</>,
        <>
          Secrets are not — re-enter them on the copy before running against
          it.
        </>,
        <>The copy is never the workspace default.</>,
      ],
      crossWorkspaceItem: (
        <>
          It leaves its base environment behind — a base must live in the same
          workspace.
        </>
      ),
    },
  },
  secret: {
    copyNameSuffix: "_COPY",
    nameHint:
      "Letters, digits, underscores — this is the {{secrets.NAME}} the copy answers to.",
    nameMono: true,
    notice: {
      icon: (
        <ShieldAlert
          className="h-3.5 w-3.5 flex-shrink-0 text-text-secondary dark:text-text-secondary-dark"
          aria-hidden="true"
        />
      ),
      title: "The value is copied",
      items: [
        <>The copy holds the same credential, still encrypted at rest.</>,
        <>
          A name already taken in the destination is refused rather than
          overwritten; nothing can read a secret back to undo that.
        </>,
      ],
      crossWorkspaceItem: (
        <>
          It will work in the destination workspace too — deleting one of the
          two does not revoke the other.
        </>
      ),
    },
  },
};

interface DuplicateItemDialogProps {
  readonly open: boolean;
  readonly kind: "environment" | "secret";
  /** Name of the row being copied — the title names it, the copy starts from it. */
  readonly sourceName: string;
  /** The workspace the item currently lives in — the default destination. */
  readonly sourceWorkspaceId: string;
  readonly onClose: () => void;
  readonly onConfirm: (name: string, targetWorkspaceId: string) => Promise<void>;
}

/**
 * The dialog both duplicate actions open: name the copy, pick the destination
 * workspace, and read the notice about what does and does not come along. The
 * item-specific wording and defaults live in {@link KIND_CONFIG}.
 */
export function DuplicateItemDialog({
  open,
  kind,
  sourceName,
  sourceWorkspaceId,
  onClose,
  onConfirm,
}: DuplicateItemDialogProps) {
  const config = KIND_CONFIG[kind];
  const [name, setName] = useState("");
  const [targetWorkspaceId, setTargetWorkspaceId] = useState("");
  const [isCopying, setIsCopying] = useState(false);

  const { options: workspaces, isLoading: isLoadingWorkspaces } =
    useAsyncOptions<Workspace>(open ? "all" : null, () =>
      apiweave.workspaces.list(),
    );

  // Reset on open so the previous row's name and destination never carry over.
  useEffect(() => {
    if (!open) return;
    setName(sourceName + config.copyNameSuffix);
    setTargetWorkspaceId(sourceWorkspaceId);
    setIsCopying(false);
  }, [open, sourceName, sourceWorkspaceId, config.copyNameSuffix]);

  const handleConfirm = async (): Promise<void> => {
    setIsCopying(true);
    try {
      await onConfirm(name.trim(), targetWorkspaceId);
    } finally {
      setIsCopying(false);
    }
  };

  const crossWorkspace =
    targetWorkspaceId !== "" && targetWorkspaceId !== sourceWorkspaceId;
  const { notice } = config;

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={`Duplicate ${kind} "${sourceName}"`}
      size="sm"
      footer={() => (
        <>
          <Button variant="ghost" onClick={onClose} disabled={isCopying}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={isCopying}
            disabled={name.trim() === "" || targetWorkspaceId === ""}
            onClick={() => void handleConfirm()}
          >
            Duplicate
          </Button>
        </>
      )}
    >
      <div className="space-y-4 p-5">
        <FormField
          label="Name of the copy"
          {...(config.nameHint !== undefined ? { hint: config.nameHint } : {})}
        >
          <Input
            aria-label="Name of the copy"
            className={config.nameMono ? "font-mono" : undefined}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={isCopying}
            autoFocus
          />
        </FormField>

        <FormField
          label="Destination workspace"
          hint={`Defaults to the workspace this ${kind} is already in.`}
        >
          {isLoadingWorkspaces ? (
            <div className="flex items-center gap-2 py-2 text-xs text-text-secondary dark:text-text-secondary-dark">
              <Spinner size="xs" /> Loading workspaces…
            </div>
          ) : (
            <WorkspaceSelect
              workspaces={workspaces}
              value={targetWorkspaceId}
              onChange={setTargetWorkspaceId}
              disabled={isCopying}
              sourceWorkspaceId={sourceWorkspaceId}
              sourceSuffix=" (same workspace)"
            />
          )}
        </FormField>

        <div className="rounded-sm border border-border bg-surface-overlay p-3 dark:border-border-dark dark:bg-surface-dark-overlay">
          <div className="flex items-center gap-2">
            {notice.icon}
            <span className="text-xs font-semibold text-text-primary dark:text-text-primary-dark">
              {notice.title}
            </span>
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-8 text-xs text-text-secondary dark:text-text-secondary-dark">
            {notice.items.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
            {crossWorkspace && notice.crossWorkspaceItem && (
              <li>{notice.crossWorkspaceItem}</li>
            )}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
