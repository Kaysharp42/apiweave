import type { UpdatePolicy, UpdateStatus } from "@shared/types/UpdateStatus";

export interface UpdateStatusContextValue {
  readonly status: UpdateStatus | null;
  /** True while an explicit check is in flight, including the spinner floor.
   * Distinct from `status.state === "checking"`, which main also sets. */
  readonly checking: boolean;
  readonly pending: boolean;
  readonly checkNow: () => Promise<void>;
  readonly download: () => Promise<void>;
  readonly setPolicy: (policy: UpdatePolicy) => Promise<void>;
  readonly restartAndInstall: () => Promise<void>;
  readonly openReleasePage: () => Promise<void>;
  readonly openLogFile: () => Promise<void>;
  /** False outside the desktop shell, where there is no updater to talk to. */
  readonly isAvailable: boolean;
}
