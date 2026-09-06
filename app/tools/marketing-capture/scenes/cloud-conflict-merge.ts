/**
 * S07 `cloud-conflict-merge` — concurrent Cloud and Local structural changes
 * are compared field by field and merged explicitly instead of silently
 * overwriting.
 *
 * The two payloads are the same workflow diverged on two fields: one that both
 * sides changed differently (the residual path, which the UI makes you pick)
 * and one only Cloud changed (which the server keeps automatically). Structure
 * only — no secret values, no run history, no response bodies, which is the
 * same boundary Cloud enforces on the wire.
 */

import { openCapture, waitForVisibleText } from "../harness";
import { CAPTURE_IDS, CHECKOUT_WORKFLOW } from "../fixtures";
import type { Scene } from "../scene";

const CONFLICT_ID = "conflict-checkout-0031";
const RESIDUAL_PATH = "description";

function payload(description: string, tags: readonly string[]) {
  return {
    workflowId: CHECKOUT_WORKFLOW.workflowId,
    workspaceId: CAPTURE_IDS.workspaceId,
    name: CHECKOUT_WORKFLOW.name,
    description,
    tags,
  };
}

const CONFLICT = {
  id: CONFLICT_ID,
  workspace_id: CAPTURE_IDS.workspaceId,
  kind: "workflow",
  record_id: CHECKOUT_WORKFLOW.workflowId,
  name: CHECKOUT_WORKFLOW.name,
  local_rev: 8,
  cloud_rev: 9,
  winner: null,
  created_at: "2026-03-02T09:20:00.000Z",
  resolved_at: null,
  cloud_writer: {
    userId: "user-teammate",
    deviceId: "device-ci",
    name: "Teammate",
    deviceLabel: "CI runner",
  },
  auto_mergeable: true,
  merge_residual_paths: [RESIDUAL_PATH],
  local_payload: payload(
    "Login, read the cart, and check the total against staging.",
    ["checkout"],
  ),
  cloud_payload: payload(
    "Login, read the cart, and check the total against the staging fixture.",
    ["checkout", "nightly"],
  ),
} as const;

export const cloudConflictMerge: Scene = {
  id: "cloud-conflict-merge",
  bridge: {
    workflow: CHECKOUT_WORKFLOW,
    conflict: CONFLICT,
    conflicts: [CONFLICT],
  },
  // Narrower than the canvas scenes on purpose: the three-pane merge grows to
  // the window width, and a 16:10 crop of a 1568px-wide table is 980 rows tall
  // — far more than the table needs, which is where dead space comes from.
  viewport: { width: 1280, height: 900 },
  prepare: async (page) => {
    await openCapture(page, `/cloud/conflicts/${CONFLICT_ID}`);
    await waitForVisibleText(page, "Merge changes");
  },
  requiredStrings: [
    "Merge changes",
    "Cloud copy",
    "Merge result",
    "Local copy",
    "Pick a side using the arrows",
    "Included automatically.",
  ],
  stills: [
    {
      id: "atlas-cloud-conflict",
      placement: "gallery",
      width: 1440,
      height: 900,
      claim: "Cloud and Local are compared field by field and merged explicitly.",
      alt: "The APIWeave conflict merge view: Cloud copy, Merge result and Local copy side by side, with one field still to pick.",
      caption: "Conflicts — three panes, one explicit decision.",
      subjects: ['section[aria-labelledby="merge-workspace-heading"]'],
      pad: 12,
      byteBudget: 160_000,
    },
  ],
};
