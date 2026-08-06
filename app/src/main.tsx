import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { BootGate } from "./components/BootGate";
import { UpdateStatusProvider } from "./contexts/UpdateStatusContext";
import { TitleBar } from "./components/layout/TitleBar";
// @ts-expect-error - CSS module type declaration handled by Vite
import "./index.css";
// @ts-expect-error - CSS module type declaration handled by Vite
import "tippy.js/dist/tippy.css";
import { isDesktopShell } from "./utils/isDesktopShell";

// The desktop shell (frameless window) draws its own title bar and reserves
// its height from the viewport via the .desktop-shell CSS in index.css. Web/
// Docker builds have no injected runtime, so this is a no-op there.
const isDesktop = isDesktopShell();
if (isDesktop) document.documentElement.classList.add("desktop-shell");

// UpdateStatusProvider sits above the router and outside App so the one IPC
// subscription survives navigation — the nav-bar dot, the ready-to-install
// banner and the Updates panel all read from it. Inside BootGate, so it does
// not start talking to main before the app is ready to.
const tree = (
  <BootGate>
    <UpdateStatusProvider>
      <App />
    </UpdateStatusProvider>
  </BootGate>
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
