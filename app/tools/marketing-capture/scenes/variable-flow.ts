/**
 * S03 `variable-flow` — an extracted response value can be traced from its
 * producer to every downstream consumer.
 *
 * The provenance map is computed by the canvas from the graph itself, so this
 * scene needs no run: the claim is about the *wiring*, and the product proves
 * it statically. `token` appears in the Variables panel because the workflow
 * declares it; `Login`'s extractor produces it and `Get cart`'s Authorization
 * header consumes it.
 */

import {
  MODAL_PANEL,
  collapseChrome,
  fitCanvas,
  openSidePanel,
  openWorkflow,
  waitForVisibleText,
} from "../harness";
import {
  CAPTURE_ENVIRONMENT,
  CAPTURE_SECRETS,
  CHECKOUT_WORKFLOW,
} from "../fixtures";
import type { Scene } from "../scene";

export const variableFlow: Scene = {
  id: "variable-flow",
  bridge: {
    workflow: CHECKOUT_WORKFLOW,
    environments: [CAPTURE_ENVIRONMENT],
    secrets: CAPTURE_SECRETS,
  },
  viewport: { width: 1600, height: 1000 },
  prepare: async (page) => {
    await openWorkflow(page, CHECKOUT_WORKFLOW.name);
    await collapseChrome(page);
    await fitCanvas(page);
    await openSidePanel(page, "Variables");
    await page
      .getByRole("button", { name: "Trace variable provenance" })
      .first()
      .click();
    await waitForVisibleText(page, "Produced by");
  },
  requiredStrings: ["Produced by", "Consumed by", "token"],
  stills: [
    {
      id: "atlas-variable-provenance",
      placement: "gallery",
      width: 1440,
      height: 900,
      claim: "Producer-to-consumer trace for one extracted variable.",
      alt: "The APIWeave variable provenance view: token is produced by the Login extractor and consumed by the Get cart Authorization header.",
      caption: "Variables — traced from producer to consumer.",
      subjects: [MODAL_PANEL],
      pad: 8,
      byteBudget: 160_000,
    },
  ],
};
