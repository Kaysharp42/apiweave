import { useEffect } from "react";
import { onRunInputsMissing } from "../utils/apiweaveClient";
import useMissingRunInputsStore from "../stores/MissingRunInputsStore";

/**
 * Show what an agent's refused run was missing. The agent gets the refusal as
 * its error, but it cannot add a secret, so the user has to see it too —
 * wherever they are in the app. Mounted once for the app shell.
 */
export function useRunInputsMissingNotice(): void {
  useEffect(
    () =>
      onRunInputsMissing((event) => {
        useMissingRunInputsStore.getState().show(event.refusal, event.agent);
      }),
    [],
  );
}
