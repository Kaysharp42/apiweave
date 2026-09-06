import { useEffect, useState } from "react";
import { isEditableKeyboardTarget } from "../utils/shortcutGuards";

/**
 * True while the space bar is held outside a text field.
 *
 * Space temporarily pans the canvas whatever the drag mode is — see
 * `canvasInteractionProps`. Cleared on `blur` as well as `keyup`, because a
 * space held through an alt-tab never sends its keyup and the canvas would
 * stay stuck in pan mode with nothing on screen saying why.
 */
export function useSpacePan(): boolean {
  const [spacePan, setSpacePan] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      if (isEditableKeyboardTarget(e.target)) return;
      setSpacePan(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpacePan(false);
    };
    const clear = () => setSpacePan(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clear);
    };
  }, []);

  return spacePan;
}

export default useSpacePan;
