# Marketing capture

Generates every image and video that `apiweave.app` ships, by driving the real
desktop renderer and cropping each frame for the place it will be used.

It lives in this repository, not in the Cloud one, because it renders **this**
app. The reviewed output is copied into
`apiweave-cloud/apps/web/public/media/`; nothing here is served.

## Why this exists

The media it replaces was recorded as whole 16:9 desktop windows and then
cropped by CSS at the destination. At the size a feature card actually renders,
that leaves the product detail tiny and the frame mostly empty canvas, and it
clips whichever node happens to fall at the edge.

So each output declares its destination size and its subject, and the tool
computes the crop from the subject's real geometry. If the subject cannot fit
without being cut, the capture **fails** rather than shipping a clipped frame.

## How it works

The renderer runs under Playwright against the Vite dev server with
`window.__APIWEAVE_IPC__` installed before navigation — the same technique as
`app/e2e/`, widened to the domains the scenes need. Everything on screen is
rendered by the shipping renderer from the fixtures in `fixtures.ts`; no text,
badge or state is ever composited in afterwards.

- `fixtures.ts` — the one synthetic workflow (`Checkout API regression` against
  `api.shop.dev`), its Staging environment, its named secret *reference*, and
  three recorded runs: passing, failing, and failing before the repair.
- `harness.ts` — the scripted IPC/MCP bridges, the `window.__CAPTURE__` control
  channel, `safeCrop`, and the helpers that drive product controls (`playRun`,
  `applyAgentWrite`, `openNodeModal`, `fitCanvas`, …).
- `scene.ts` / `scenes/*` — one file per scene: the product state, the strings
  the renderer must show, and each output's destination size, camera and subject.
- `capture.spec.ts` — renders every scene, asserts its required strings, writes
  one PNG plus a JSON sidecar per output into `output/stills/`.
- `demo.spec.ts` — the single long-form take, captured as a timestamped CDP
  screencast frame sequence into `output/frames/`.
- `encode.mjs` — resamples each still to its destination size (WebP + AVIF, plus
  a PNG for OG), rebuilds the demo at a constant 30fps into H.264 MP4 and VP9
  WebM, and writes the poster and the WebVTT chapter track.
- `validate.mjs` — the gate: manifest completeness, exact dimensions, byte
  budgets, codecs, caption ordering, and a forbidden-string scan over the text
  that was actually on screen in each frame.

Runs are driven through the product's own path — press Run, let the renderer
subscribe, then release `node.status` events on the scene's clock — so the
traversal, the dwell and the camera follow are the shipping behaviour in
`utils/runChoreography.ts`, not an animation this tool invents.

### Sharpness

Stills capture at `deviceScaleFactor: 2`, and every crop is authored in CSS
pixels at *at least* half its destination size, so it lands at 1:1 or better and
is only ever resampled down. `encode.mjs` re-checks that and refuses to upscale.

## Requirements

- Playwright's Chromium: `npx playwright install chromium`
  (on a bare Linux host also `npx playwright install-deps chromium`).
- **FFmpeg with `ffprobe`** on `PATH`. Playwright's bundled minimal FFmpeg
  cannot encode or probe these files.
- Nothing else. No display: the whole pipeline runs headless.

## Running it

From `app/`:

```bash
npm run capture:all        # stills, demo, encode, validate
```

or one stage at a time:

```bash
npm run capture:media      # scenes  -> output/stills/
npm run capture:demo       # the take -> output/frames/
npm run capture:encode     # both     -> output/media/
npm run capture:validate   # gate
```

A single scene, while iterating on it:

```bash
npx playwright test --config=tools/marketing-capture/playwright.config.ts \
  capture.spec.ts --grep "assertion-failure"
```

`output/` is generated and git-ignored. To encode straight into the Cloud repo's
served directory instead:

```bash
node tools/marketing-capture/encode.mjs --out ../apiweave-cloud/apps/web/public/media
node tools/marketing-capture/validate.mjs --media ../apiweave-cloud/apps/web/public/media
```

## Adding an output

1. Pick the scene whose product state already proves the claim; add a new scene
   only if the state is genuinely different.
2. Add a `StillOutput`: destination `width`/`height`, the `claim` it proves, its
   `alt` and `caption`, and the `subjects` the crop must contain.
3. Run that scene. If `safeCrop` says the subject does not fit, change the
   `camera` (`fit`, `zoom`) or pick fewer subjects — do not widen the crop past
   the point where the subject is legible.
4. Add any string the frame must show to `requiredStrings`, so a future product
   change that removes it fails the capture instead of shipping a frame that no
   longer proves the claim.

## Rules that are enforced, not remembered

- Nothing on screen is composited; only the camera and the crop are authored.
- No secret value, real endpoint, real account or machine path may appear —
  `validate.mjs` scans the text each frame was taken from.
- Every output declares a claim, alt text, a caption and a byte budget.
- No frame is upscaled, and no subject is clipped.
- MCP tool counts come from `core/mcp/tools.ts`, never from a fixture.
