# Desktop Renderer E2E

The Playwright suite runs the Vite renderer with a mocked Electron IPC bridge.
It does not start a web backend and does not intercept legacy `/api/*` routes.
Desktop tests must install the bridge before navigation and use hash routes.

## Running Tests

```bash
# Run all desktop renderer tests
npm run qa:ui

# Run a specific test file
npx playwright test e2e/desktop-smoke.spec.ts

# Run with the Chromium project only
npx playwright test --project=chromium

# Run in headed mode (visible browser)
npx playwright test --headed

# Debug a specific test
npx playwright test --debug e2e/node-modal.spec.ts
```

## Test Fixtures

Use `fixtures/desktop.ts` for canonical workspaces, workflows, IPC setup, hash
navigation, and screenshot capture. Unknown IPC operations fail with
`not_found`; add an explicit fixture response when a new screen needs another
desktop operation.

## Evidence

- **Screenshots**: `.omo/evidence/*.png`
- **Traces**: Playwright traces saved on first retry (`.omo/evidence/playwright-results/`)
- **Videos**: Retained only on failure (`.omo/evidence/playwright-results/`)
- **HTML report**: `.omo/evidence/playwright-report/`

## Adding New Tests

1. Create a descriptive `*.spec.ts` file under `e2e/`.
2. Call `installDesktopIpc(page)` before the first navigation.
3. Navigate with `navigateDesktop(page, "/path")`.
4. Seed current shared-contract shapes, not ReactFlow or retired web API shapes.
5. Assert feature-specific landmarks rather than only checking for a non-empty body.

## Viewport Breakpoints

| Name | Width  | Height | Target Device      |
| ---- | ------ | ------ | ------------------ |
| 375  | 375px  | 812px  | iPhone SE / mobile |
| 768  | 768px  | 1024px | iPad / tablet      |
| 1024 | 1024px | 768px  | Small laptop       |
| 1440 | 1440px | 900px  | Desktop            |
