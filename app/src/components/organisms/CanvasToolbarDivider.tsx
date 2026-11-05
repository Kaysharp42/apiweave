import { Divider } from "../atoms/Divider";

/** The hairline between the toolbar's action groups. */
export function CanvasToolbarDivider() {
  return (
    <Divider
      direction="vertical"
      role="separator"
      aria-orientation="vertical"
      data-testid="toolbar-divider"
      className="mx-1 self-stretch"
    />
  );
}
