import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { UpdateStatusProvider } from "./contexts/UpdateStatusContext";
import { TitleBar } from "./components/layout/TitleBar";
// @ts-expect-error - CSS module type declaration handled by Vite
import "./index.css";
// @ts-expect-error - CSS module type declaration handled by Vite
import "tippy.js/dist/tippy.css";
import { isDesktopShell } from "./utils/isDesktopShell";
import { desktop } from "./utils/apiweaveClient";
import { confirmCloseAll } from "./stores/PendingEditsStore";
import { ErrorBoundary } from "./components/molecules/ErrorBoundary";

// The desktop shell (frameless window) draws its own title bar and reserves
// its height from the viewport via the .desktop-shell CSS in index.css. Web/
// Docker builds have no injected runtime, so this is a no-op there.
const isDesktop = isDesktopShell();
if (isDesktop) document.documentElement.classList.add("desktop-shell");

// Main asks before the window closes or the app quits. Registered here, outside
// React, so it answers even when the tree failed to render.
desktop.onCloseRequested(confirmCloseAll);

// UpdateStatusProvider sits above the router and outside App so the one IPC
// subscription survives navigation — the nav-bar dot, the ready-to-install
// banner and the Updates panel all read from it. Main creates the window only
// after its services are up (a failed start ends in a native error box), so
// there is no "still booting" state for the renderer to wait out.
// The boundary keeps one render error from blanking the window; the title bar
// stays outside it so the window can still be moved and closed.
const tree = (
  <ErrorBoundary name="app">
    <UpdateStatusProvider>
      <App />
    </UpdateStatusProvider>
  </ErrorBoundary>
);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    {isDesktop ? (
      <div className="flex flex-col" style={{ height: "100vh" }}>
        <TitleBar />
        <div className="min-h-0 flex-1 overflow-auto">{tree}</div>
      </div>
    ) : (
      tree
    )}
  </StrictMode>,
);
