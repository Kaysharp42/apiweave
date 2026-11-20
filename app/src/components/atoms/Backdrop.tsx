import { DialogBackdrop } from "@headlessui/react";
import { useDimsWindow } from "../../stores/WindowChromeStore";

/**
 * The veil behind every dialog: render it inside the `Dialog`. It fades with
 * the dialog's transition, and while it is mounted it also dims the native
 * window controls, which sit above the page out of its reach: main mixes this
 * same colour and opacity over them (`BACKDROP` in electron/window_chrome.ts),
 * so change both together.
 */
export function Backdrop() {
  useDimsWindow();
  return (
    <DialogBackdrop
      transition
      className="fixed inset-0 bg-text-primary/40 transition-opacity duration-200 ease-out data-closed:opacity-0 data-leave:duration-150 data-leave:ease-in motion-reduce:transition-none dark:bg-surface-dark/80"
    />
  );
}
