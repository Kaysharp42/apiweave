import type { Scene } from "../scene";
import { agentRepair } from "./agent-repair";
import {
  assertionFailure,
  assertionRule,
  failingResponse,
  runTimeline,
} from "./assertion-failure";
import {
  checkoutRequestEditor,
  checkoutRunIdle,
  checkoutRunMobile,
  checkoutRunPassing,
} from "./checkout-run";
import { cloudConflictMerge } from "./cloud-conflict-merge";
import { mcpBridge } from "./mcp-bridge";
import { variableFlow } from "./variable-flow";

/**
 * Capture order is the order the landing page reads in, so a partial run still
 * produces a coherent set: hero and demo first, then features, steps, atlas.
 *
 * `cloud-boundary` (S06) has no entry: it is a responsive HTML/mono payload
 * rendered by the marketing site itself, so it has no raster output to capture.
 * See `scenes/cloud-boundary.ts` for why it stays that way.
 */
export const SCENES: readonly Scene[] = [
  checkoutRunPassing,
  checkoutRunMobile,
  checkoutRunIdle,
  checkoutRequestEditor,
  assertionFailure,
  assertionRule,
  failingResponse,
  runTimeline,
  variableFlow,
  mcpBridge,
  agentRepair,
  cloudConflictMerge,
];
