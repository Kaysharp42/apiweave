# AGENTS.md — APIWeave Project Rules

> This file defines the rules that ALL AI agents MUST follow when working on this project.
> Violating these rules will result in rejected changes.

---

## Before Starting Any Work

1. **Read `apiweave-context.md`** — this is the single source of truth for project standards
2. **Read `todo.md`** — understand the current phase and checklist items
3. **Read `frontend/DESIGN_SYSTEM.md`** — understand design tokens and component guidelines
4. **Explore the codebase** — understand existing patterns before making changes

---

## MANDATORY Rules

### TypeScript (STRICT)
- ALL frontend files MUST be `.ts` or `.tsx` — no `.js` or `.jsx` allowed
- `tsconfig.json` strict mode is enabled — `any` is FORBIDDEN
- ALL props, state, hooks, stores, contexts, API calls MUST have explicit types
- Shared types live in `src/types/` — ONE type per file, NEVER duplicate type definitions
- **ONE type per file rule**: Every type, interface, or union MUST be in its own file named after the type (e.g., `Workflow.ts`, `ButtonProps.ts`). Barrel export `index.ts` re-exports all types.
- Use `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`

### DRY — Never Repeat Patterns
- **Buttons**: always use `Button` or `IconButton` atoms — NEVER raw `<button>` with Tailwind classes
- **Panels**: always use `Panel` molecule — NEVER duplicate panel layouts
- **Form Fields**: always use `FormField` molecule — NEVER duplicate label+input+hint patterns
- **Cards**: always use `Card` molecule — NEVER duplicate card shells
- **Tabs**: always use `PanelTabs` molecule — NEVER duplicate tab bars
- **Empty States**: always use `EmptyState` molecule
- **Status Badges**: always use `StatusBadge` molecule
- If a visual pattern appears **2+ times**, extract it into a reusable component
- All reusable components accept **props for customization** — no hardcoded content

### Component Props Pattern
```typescript
export interface ComponentProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  intent?: 'default' | 'success' | 'error' | 'warning' | 'info';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export function Component({
  variant = 'primary',
  intent = 'default',
  size = 'md',
  loading = false,
  children,
  className = '',
  ...rest
}: ComponentProps) {
  // implementation
}
```

### Atomic Design Structure
| Layer | Purpose | Examples |
|-------|---------|----------|
| `atoms/` | Basic UI elements, no business logic | Button, Input, Badge, Spinner |
| `molecules/` | Compositions of atoms | Modal, FormField, Panel, Card |
| `organisms/` | Complex UI sections | CanvasToolbar, TabBar |
| `layout/` | Page structure | MainLayout, Sidebar, MainHeader |
| `nodes/` | ReactFlow node components | HTTPRequestNode, AssertionNode |

### Styling
- Tailwind utility classes ONLY — no CSS-in-JS, no styled-components
- Design tokens ONLY — NEVER hardcoded hex values
- Dark mode via `dark:` prefix ONLY — no separate dark files
- Consistent spacing: Tailwind scale (1, 1.5, 2, 2.5, 3, 4, 5, 6)
- Focus states: `focus:outline-none focus:ring-2 focus:ring-primary`

### Naming Conventions
| Type | Pattern | Example |
|------|---------|---------|
| Components | PascalCase | `Button.tsx`, `FormField.tsx` |
| Props | PascalCase + `Props` | `ButtonProps`, `PanelProps` |
| Types | PascalCase | `Workflow`, `NodeConfig` |
| Hooks | `use` + camelCase | `useWorkflowPolling.ts` |
| Stores | PascalCase + `Store` | `SidebarStore.ts` |
| Utils | camelCase | `sidebarItemLabel.ts` |
| Constants | PascalCase | `AppNavBar.ts` |

### Testing
After every phase:
1. Write/update tests for changed components
2. `cd frontend && npm test` — all passing
3. `cd frontend && npx tsc --noEmit` — zero errors
4. `cd frontend && npm run build` — successful build

### Commits
After every phase:
1. Stage only source code changes
2. **NEVER** stage: `todo.md`, `progress/learnings.md`, or anything under `progress/`
3. Use the commit message from `todo.md` for that phase
4. Verify with `git status`

---

## Questions?

If anything is ambiguous, ask the user before proceeding. Do not guess or assume.
