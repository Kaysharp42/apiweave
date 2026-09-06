/**
 * Capture pass: renders every scene and writes one PNG per still output, at the
 * destination pixel size, into `output/stills/`.
 *
 * Nothing is cropped after the fact and nothing is upscaled. Each output's
 * `safeCrop` either contains its whole subject or the capture fails, which is
 * what keeps "no clipped primary content" a property of the tool rather than a
 * thing someone has to notice in review.
 *
 * A sidecar `<id>.json` records the crop, the viewport and the page text the
 * frame was taken from; `validate.mjs` reads those for the required- and
 * forbidden-string checks.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "@playwright/test";
import { fitCanvas, installCaptureBridge, safeCrop, zoomCanvas } from "./harness";
import { SCENES } from "./scenes";

/**
 * Absolute, from the project's own testDir, so the pass writes into the tool
 * directory whether it was started from here, from `app/`, or from CI.
 */
function stillsDir(): string {
  return join(test.info().project.testDir, "output", "stills");
}

for (const scene of SCENES) {
  test(`capture ${scene.id}`, async ({ page }) => {
    const STILLS_DIR = stillsDir();
    await mkdir(STILLS_DIR, { recursive: true });
    if (scene.viewport) await page.setViewportSize(scene.viewport);
    await installCaptureBridge(page, scene.bridge);
    await scene.prepare(page);

    // `innerText` plus the value of every field: a URL or a JSON body lives in
    // an input or textarea, so it is on screen but not in the text nodes.
    const text = await page.evaluate(() => {
      const fields = Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          "input, textarea",
        ),
      ).map((element) => element.value);
      return [document.body.innerText, ...fields].join("\n");
    });
    // Two normalisations, both about what a reader sees rather than what the
    // DOM holds: the renderer splits `200`/`OK` across elements, so whitespace
    // collapses; and section labels are CSS-uppercased, which `innerText`
    // reports transformed, so the match is case-insensitive.
    const flat = text.replace(/\s+/g, " ");
    // Word-bounded, not `includes`: a case-insensitive substring match would
    // have accepted "Inactive" as proof that the MCP transport reads "Active".
    const missing = scene.requiredStrings.filter((needle) => {
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const left = /^\w/.test(needle) ? "\\b" : "";
      const right = /\w$/.test(needle) ? "\\b" : "";
      return !new RegExp(`${left}${escaped}${right}`, "i").test(flat);
    });
    if (missing.length > 0) {
      throw new Error(
        `scene ${scene.id}: the renderer never showed ${missing.join(", ")}`,
      );
    }

    for (const still of scene.stills) {
      if (still.camera) {
        if (still.camera.fit !== false) await fitCanvas(page);
        if (still.camera.zoom) await zoomCanvas(page, still.camera.zoom);
      }
      if (still.before) await still.before(page);
      const clip = await safeCrop(page, still.subjects, {
        aspect: still.width / still.height,
        cssWidth: still.width / 2,
        ...(still.pad !== undefined ? { pad: still.pad } : {}),
      });
      await page.screenshot({ path: `${STILLS_DIR}/${still.id}.png`, clip });
      await writeFile(
        `${STILLS_DIR}/${still.id}.json`,
        `${JSON.stringify(
          {
            id: still.id,
            sceneId: scene.id,
            placement: still.placement,
            width: still.width,
            height: still.height,
            alsoAt: still.alsoAt ?? [],
            claim: still.claim,
            alt: still.alt,
            caption: still.caption,
            byteBudget: still.byteBudget,
            viewport: scene.viewport ?? page.viewportSize(),
            deviceScaleFactor: 2,
            clip,
            pageText: text,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }
  });
}
