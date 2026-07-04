import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { BootGate } from "./components/BootGate";
// @ts-expect-error - CSS module type declaration handled by Vite
import "./index.css";
// @ts-expect-error - CSS module type declaration handled by Vite
import "tippy.js/dist/tippy.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <BootGate>
      <App />
    </BootGate>
  </StrictMode>,
);
