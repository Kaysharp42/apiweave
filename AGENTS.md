# APIWeave — OpenCode Agent Instructions

> **Stop and Read**: `apiweave-context.md` is the single source of truth for detailed architecture, design tokens, and UI components. Read it before starting any feature work.

## Critical Development Commands

### Frontend (React/Vite)
Run these commands after every phase to verify changes:
```bash
cd frontend
npm test                 # Run unit tests
npx tsc --noEmit         # Typecheck (zero errors allowed)
npm run lint             # Linting
npm run build            # Verify production build
```

### Backend (Python/FastAPI)
Run these commands to verify backend and MCP changes:
```bash
cd backend
python -m pytest               # Run tests
python -m mypy app             # Typecheck
python -m ruff check app tests # Linting
```

### Dev Services
- **Start**: `start-dev.bat` (Windows) or `./start-dev.sh` (macOS/Linux)
- **Stop**: `stop-dev.bat` (Windows) or `./stop-dev.sh` (macOS/Linux)

## Architecture & Code Quirks (Do Not Violate)

### Frontend
- **WorkflowContext is Sacred**: `frontend/src/contexts/WorkflowContext.jsx` is the single source of truth for canvas state. Bypassing it for variables or settings will cause sync bugs.
- **Auto-Save Only**: State changes trigger a 700ms debounced auto-save. NEVER implement manual "Save" buttons.
- **TypeScript STRICT**: `.ts`/`.tsx` ONLY. `any` is strictly forbidden.
- **ONE Type Per File**: Every interface/type MUST be in its own file under `src/types/` and exported via `index.ts`.
- **UI Reusability**: Never use raw HTML elements with Tailwind classes when a component exists. Always use `Button`, `IconButton`, `Panel`, `FormField`, `Card`, etc. (See `apiweave-context.md`).

### Backend
- **Repository Pattern**: All DB access MUST go through `backend/app/repositories/`. NEVER write raw Motor/Beanie queries in route handlers or the workflow executor.
- **MCP Server Rules**: MCP tools in `backend/app/mcp/tools/` MUST NOT call FastAPI routes or make HTTP calls back to the backend. Shared logic lives in `backend/app/services/`.
- **No Secrets in Exports**: Ensure environment secrets are sanitized and never exposed in `.awecollection` exports or read tools.

## Design Context

- **PRODUCT.md** (root): Strategic product register, users, brand personality, design principles, and anti-references.
- **DESIGN.md** (root): Visual design system — colors, typography, elevation, components, do's and don'ts. Follows Google Stitch DESIGN.md format.
- **frontend/DESIGN_SYSTEM.md**: Full component inventory, atomic design architecture, DaisyUI themes, CSS custom properties, and the redesign contract.
- **`.impeccable/` directory**: Design tooling config for `/impeccable` commands.

## Commits & Work Tracking
- Check `todo.md` for current phase tasks and the required commit message format.
- **NEVER stage or commit**: `todo.md`, `progress/learnings.md`, or any file in the `progress/` directory.
