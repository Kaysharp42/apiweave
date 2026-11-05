import { Lock, LockOpen } from "lucide-react";
import { IconButton } from "../atoms/IconButton";
import useCanvasPrefsStore from "../../stores/CanvasPrefsStore";

/**
 * The camera lock.
 *
 * Icon-only at every density, and never in the overflow menu: this is reached
 * mid-drag, when the map has just slid out from under someone, and a lock two
 * clicks deep does not get used.
 */
export function CanvasToolbarCameraLock() {
  // Straight from the store rather than down a prop chain: the lock is one
  // boolean the canvas reads from the same place, and threading it through
  // `CanvasToolbarProps` would only give it a second name.
  const canvasLocked = useCanvasPrefsStore((s) => s.locked);
  const setCanvasPrefs = useCanvasPrefsStore((s) => s.setCanvasPrefs);

  return (
    <IconButton
      onClick={() => setCanvasPrefs({ locked: !canvasLocked })}
      tooltip={canvasLocked ? "Unlock camera" : "Lock camera"}
      aria-pressed={canvasLocked}
      aria-label={canvasLocked ? "Unlock camera" : "Lock camera"}
      variant={canvasLocked ? "primary" : "ghost"}
      size="sm"
    >
      {canvasLocked ? (
        <Lock className="w-4 h-4" />
      ) : (
        <LockOpen className="w-4 h-4" />
      )}
    </IconButton>
  );
}
