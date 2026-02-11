# APIWeave UI/UX Refinement — Round 2 TODO

> **Created:** 2026-02-11
> **Context:** Additional polish and FlowTest-inspired improvements after initial bug fixes
> **Branch:** `ui-refactor/phase-1-design-foundation`

---

## Phase 1: HTTP Method Badge Spacing

Fix the HTTP method badge (POST, GET, etc.) being too close to the node label text in HTTPRequestNode. The badge needs breathing room on the right side.

- [ ] Add `mr-1.5` or `mr-2` spacing class to the method badge `<span>` element in HTTPRequestNode.jsx
- [ ] Ensure the badge-to-label spacing looks consistent across all method types (GET, POST, PUT, DELETE, PATCH)
- [ ] Verify spacing in both collapsed and expanded states

**File:** `frontend/src/components/nodes/HTTPRequestNode.jsx`

### Test & Commit
```bash
cd frontend && npm run dev
# Visual check: HTTP Request nodes show method badge with proper spacing
# Test: Check all methods (GET, POST, PUT, DELETE, PATCH) for consistent spacing
# Test: Collapse/expand node → badge spacing remains good
# Test: Both light and dark mode
npm run build
git add -A && git commit -m "fix: add spacing between method badge and node label"
```

---

## Phase 2: Button Redesign (FlowTest Style)

Replace DaisyUI button styling with FlowTest's button system: filled primary buttons, outlined secondary buttons, proper shadows for depth, and consistent `gap-2` for icon+text.

### Step 2.1: Update Button Atom
- [ ] Refactor `Button.jsx` to match FlowTest's button system:
  - **Base:** `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded transition px-4 py-2`
  - **Primary (filled):**
    - Default: `bg-primary dark:bg-[#22d3ee] text-white border border-primary dark:border-[#22d3ee] hover:bg-primary-hover dark:hover:bg-cyan-400 shadow-sm hover:shadow-md`
    - Success intent: `bg-green-600 border-green-600 text-white hover:bg-green-700 shadow-sm hover:shadow-md`
    - Error intent: `bg-red-600 border-red-600 text-white hover:bg-red-700 shadow-sm hover:shadow-md`
  - **Secondary (outlined):**
    - Default: `bg-primary/5 dark:bg-[#22d3ee]/10 text-primary dark:text-[#22d3ee] border border-primary dark:border-[#22d3ee] hover:bg-primary/10 dark:hover:bg-[#22d3ee]/20`
    - Success: `bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border border-green-600 dark:border-green-500 hover:bg-green-100 dark:hover:bg-green-900/30`
    - Error: `bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-600 dark:border-red-500 hover:bg-red-100 dark:hover:bg-red-900/30`
  - **Ghost (minimal):** `text-text-secondary dark:text-text-secondary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay`
- [ ] Add `intent` prop: `'default' | 'success' | 'error' | 'warning' | 'info'`
- [ ] Remove DaisyUI `btn` classes entirely (use custom Tailwind composition)

### Step 2.2: Update NodeModal Buttons
- [ ] Replace raw `<button class="btn btn-ghost">` with `<Button variant="ghost">`
- [ ] Replace raw `<button class="btn btn-primary">` with `<Button variant="primary">`
- [ ] Ensure shadow effects show on hover

### Step 2.3: Update Other Button Usages
- [ ] Check EnvironmentManager buttons (already using Button component — verify they use new styling)
- [ ] Check WorkflowJsonEditor Copy/Apply buttons
- [ ] Check CollectionManager buttons
- [ ] Check WebhookManager buttons

**Files:**
- `frontend/src/components/atoms/Button.jsx`
- `frontend/src/components/NodeModal.jsx`
- `frontend/src/components/WorkflowJsonEditor.jsx`

### Test & Commit
```bash
cd frontend && npm run dev
# Test: All primary buttons (Save, Create, Apply) have filled background + shadow on hover
# Test: All secondary/cancel buttons have outlined style + light tint background
# Test: Ghost buttons have no border, only hover background
# Test: Icon+text buttons have proper gap-2 spacing
# Test: Both light and dark mode for all button variants
# Test: NodeModal Save/Cancel buttons
# Test: EnvironmentManager buttons
# Test: JSON Editor Copy/Apply buttons
npm run build
git add -A && git commit -m "refactor: button styling to match FlowTest design system"
```

---

## Phase 3: Assertion Node Handle Positioning (Centered)

Reposition the assertion node's pass/fail handles to be vertically centered on the right edge (like normal nodes), instead of bottom-aligned. Labels should appear on hover only.

- [ ] Update `extraHandles` in AssertionNode.jsx:
  - **Pass handle:** `style={{ top: '50%', transform: 'translateY(-20px)' }}` (upper-center)
  - **Fail handle:** `style={{ top: '50%', transform: 'translateY(20px)' }}` (lower-center)
- [ ] Keep green/red colors: `!bg-green-500 dark:!bg-green-400` and `!bg-red-500 dark:!bg-red-400`
- [ ] Hide "Pass"/"Fail" text labels by default: add `opacity-0 group-hover:opacity-100 transition-opacity` to label divs
- [ ] Add `group` class to Handle elements so hover works: `className="group !bg-green-500..."`
- [ ] Alternatively, use Tooltip component on hover instead of inline labels

**File:** `frontend/src/components/nodes/AssertionNode.jsx`

### Test & Commit
```bash
cd frontend && npm run dev
# Visual check: Assertion node handles are centered vertically on right edge
# Test: Hover over pass handle → "Pass" label appears
# Test: Hover over fail handle → "Fail" label appears
# Test: Handles are still green/red colored
# Test: Connect edges from both handles → works correctly
# Test: Both light and dark mode
npm run build
git add -A && git commit -m "refactor: center assertion node handles with hover labels"
```

---

## Phase 4: Assertion Node Tips Text Contrast

Fix the tips section at the bottom of the assertion node where code text like `prev.*` and `variables.*` blends with the background, making it invisible unless selected.

- [ ] Update tips section in AssertionNode.jsx:
  - Change `<code>` from `bg-gray-200 dark:bg-gray-600` to `bg-blue-100 dark:bg-blue-800/50`
  - Add explicit text color: `text-blue-900 dark:text-blue-200` or `text-primary dark:text-[#22d3ee]`
  - Increase padding: `px-1.5 py-0.5` instead of `px-1`
  - Optionally increase font size from `text-[8px]` to `text-[9px]` for better readability
- [ ] Ensure all code snippets (`prev.*`, `variables.*`, `body.data[0].id`) are visible in both themes

**File:** `frontend/src/components/nodes/AssertionNode.jsx`

### Test & Commit
```bash
cd frontend && npm run dev
# Visual check: Assertion node tips section code text is clearly visible
# Test: Read "prev.*" and "variables.*" without selecting text
# Test: JSONPath example "body.data[0].id" is readable
# Test: Both light and dark mode
# Test: Code background has sufficient contrast with surrounding area
npm run build
git add -A && git commit -m "fix: assertion node tips code text contrast and visibility"
```

---

## Summary

| Phase | Issue | Status |
|-------|-------|--------|
| 1 | Method badge spacing | Not started |
| 2 | Button styling (FlowTest) | Not started |
| 3 | Assertion handles positioning | Not started |
| 4 | Tips section text contrast | Not started |

---

## Previous Rounds (Completed)

### Round 1: Initial Bug Fixes (All Done ✅)
1. ✅ Button text clipping with icons
2. ✅ Browser `prompt()` popup
3. ✅ Assertion node output placement (bottom-aligned)
4. ✅ Environment Manager switching
5. ✅ Text input dark mode
6. ✅ Node modal white background
7. ✅ Tab bar dark mode text
