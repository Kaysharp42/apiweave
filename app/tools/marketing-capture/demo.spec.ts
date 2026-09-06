/**
 * The one long-form demo: author → run → green, in a single take.
 *
 * Frames come from CDP's screencast rather than Playwright's `recordVideo`, for
 * two reasons that both matter to a marketing asset: the take starts and stops
 * exactly where the script says, so nothing has to be trimmed by guesswork, and
 * every frame carries its own timestamp, so `encode.mjs` can rebuild the real
 * timeline instead of assuming a constant frame rate. Screencast only emits on
 * change, which is why a hold costs one frame and a long duration rather than
 * hundreds of identical ones.
 *
 * The beat table written next to the frames is the same table the chapter list
 * and the WebVTT track are generated from, so the captions cannot drift from
 * what is on screen.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "@playwright/test";
import {
  collapseChrome,
  fitCanvas,
  installCaptureBridge,
  openNodeModal,
  openWorkflow,
  playRun,
  waitForFieldValue,
  waitForVisibleText,
} from "./harness";
import {
  CAPTURE_ENVIRONMENT,
  CAPTURE_SECRETS,
  CHECKOUT_WORKFLOW,
  PASSING_RUN,
} from "./fixtures";
import { PASSING_BEATS } from "./scenes/checkout-run";

/** Absolute, for the same reason as in `capture.spec.ts`. */
function framesDir(): string {
  return join(test.info().project.testDir, "output", "frames", "checkout-demo");
}

type Beat = { readonly at: number; readonly title: string; readonly caption: string };

test("demo checkout-run", async ({ page }, testInfo) => {
  testInfo.setTimeout(180_000);
  const FRAMES_DIR = framesDir();
  await rm(FRAMES_DIR, { recursive: true, force: true });
  await mkdir(FRAMES_DIR, { recursive: true });

  // 1920x1080 at DPR 1: the destination is a 1080p video, so a retina capture
  // would only be resampled back down.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installCaptureBridge(page, {
    workflow: CHECKOUT_WORKFLOW,
    run: PASSING_RUN,
    environments: [CAPTURE_ENVIRONMENT],
    secrets: CAPTURE_SECRETS,
  });

  // Everything before the first frame: the establishing state is the first
  // thing the viewer sees, never a blank canvas or a loading pane.
  await openWorkflow(page, CHECKOUT_WORKFLOW.name);
  await collapseChrome(page);
  await fitCanvas(page);
  await page.waitForTimeout(600);

  const cdp = await page.context().newCDPSession(page);
  const frames: { data: string; ts: number }[] = [];
  cdp.on("Page.screencastFrame", (frame) => {
    frames.push({ data: frame.data, ts: frame.metadata.timestamp ?? 0 });
    void cdp
      .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
      .catch(() => undefined);
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 95,
    maxWidth: 1920,
    maxHeight: 1080,
    everyNthFrame: 1,
  });

  const start = Date.now();
  const beats: Beat[] = [];
  const beat = (title: string, caption: string) => {
    beats.push({ at: (Date.now() - start) / 1000, title, caption });
  };

  beat("The workflow", "A checkout regression: login, read the cart, check the total.");
  await page.waitForTimeout(2000);

  beat("The request", "Real request config — and a secret reference, never a secret.");
  await openNodeModal(page, "login", "Body");
  await waitForVisibleText(page, "{{secrets.QA_PASSWORD}}");
  await page.waitForTimeout(3400);

  beat("The extractor", "Login's response gives up a token into a workflow variable.");
  // Not `exact`: the tab carries an extractor-count badge, so its accessible
  // name is "Settings 1" once the request has an extractor.
  await page.getByRole("tab", { name: "Settings" }).first().click();
  await page.waitForTimeout(3600);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);

  beat("The consumer", "Downstream, that variable is the Authorization header.");
  await openNodeModal(page, "get-cart", "Headers");
  await waitForFieldValue(page, "{{variables.token}}");
  await page.waitForTimeout(3600);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(900);

  beat("Run it", "Both branches execute locally, on your machine.");
  await fitCanvas(page);
  await playRun(page, {
    runId: PASSING_RUN.runId,
    finishedRun: PASSING_RUN,
    beats: PASSING_BEATS,
    settleMs: 1200,
  });

  beat("Green", "Every node carries its own status, timing and size.");
  await fitCanvas(page);
  await page.waitForTimeout(5000);

  await cdp.send("Page.stopScreencast");
  const durationSeconds = (Date.now() - start) / 1000;

  if (frames.length < 30) {
    throw new Error(`demo: only ${frames.length} frames captured`);
  }

  // Frame timestamps are seconds on the browser's clock; store them relative to
  // the first frame so `encode.mjs` never has to know about that clock.
  const t0 = frames[0]!.ts;
  const index: { file: string; at: number }[] = [];
  for (const [position, frame] of frames.entries()) {
    const file = `${String(position).padStart(5, "0")}.jpg`;
    await writeFile(`${FRAMES_DIR}/${file}`, Buffer.from(frame.data, "base64"));
    index.push({ file, at: Math.max(0, frame.ts - t0) });
  }

  await writeFile(
    `${FRAMES_DIR}/take.json`,
    `${JSON.stringify(
      {
        id: "checkout-demo",
        sceneId: "checkout-run",
        width: 1920,
        height: 1080,
        durationSeconds,
        byteBudget: 3_500_000,
        alt: "A full APIWeave run: the login request and its secret reference, the token extractor, the downstream Authorization header, then both branches executing to green.",
        caption: "Author a checkout regression, run it locally, watch it go green.",
        beats,
        frames: index,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
});
