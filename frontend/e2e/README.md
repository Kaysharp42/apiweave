# E2E Test Evidence — APIWeave Redesign QA

## Running Tests

```bash
# Run all E2E smoke tests
npm run qa:ui

# Run a specific test file
npx playwright test e2e/redesign-smoke.spec.ts

# Run with the Chromium project only
npx playwright test --project=chromium

# Run in headed mode (visible browser)
npx playwright test --headed

# Debug a specific test
npx playwright test --debug e2e/redesign-smoke.spec.ts
```

## Evidence Naming Convention

All screenshots and traces follow this naming pattern:

```
.omo/evidence/task-{N}-{slug}-{viewport}-{theme}.png
```

| Segment      | Description                                      | Examples                     |
| ------------ | ------------------------------------------------ | ---------------------------- |
| `{N}`        | Task number from the redesign plan               | `2`                          |
| `{slug}`     | Descriptive slug for the route or feature tested | `login`, `setup`, `canvas`   |
| `{viewport}` | Viewport width in pixels                         | `375`, `768`, `1024`, `1440` |
| `{theme}`    | Theme at time of capture                         | `light`, `dark`              |

### Examples

- `.omo/evidence/task-2-login-375-light.png` — Login page on mobile, light theme
- `.omo/evidence/task-2-setup-1440-dark.png` — Setup page on desktop, dark theme
- `.omo/evidence/task-5-canvas-1024-dark.png` — Canvas view at laptop width, dark theme

## Screenshot & Trace Conventions

- **Screenshots**: Full-page PNGs captured via `page.screenshot({ fullPage: true })`
- **Traces**: Playwright traces saved on first retry (`.omo/evidence/playwright-results/`)
- **Videos**: Retained only on failure (`.omo/evidence/playwright-results/`)
- **HTML Report**: Generated on every run (`.omo/evidence/playwright-results/`)

## Adding New Tests

1. Create a new spec file in `e2e/` named descriptively (e.g., `workspace-smoke.spec.ts`)
2. Use the `captureEvidence()` helper from `redesign-smoke.spec.ts` for consistent naming
3. Increment the task number `{N}` to match the redesign plan task
4. Protected routes require the dev stack running with seeded data — mark those tests with `.skip()` until the harness supports auth

## Viewport Breakpoints

| Name | Width  | Height | Target Device      |
| ---- | ------ | ------ | ------------------ |
| 375  | 375px  | 812px  | iPhone SE / mobile |
| 768  | 768px  | 1024px | iPad / tablet      |
| 1024 | 1024px | 768px  | Small laptop       |
| 1440 | 1440px | 900px  | Desktop            |
