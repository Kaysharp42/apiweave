import { ToggleSetting } from "../molecules/ToggleSetting";
import { Input } from "../atoms/Input";
import ButtonSelect from "../ButtonSelect";
import useCanvasPrefsStore from "../../stores/CanvasPrefsStore";
import type { CanvasDragMode } from "../../stores/CanvasPrefsStore";
import type { SelectOption } from "../../types";

const DRAG_MODE_OPTIONS: SelectOption[] = [
  { value: "pan", label: "Pan the canvas" },
  { value: "select", label: "Box-select nodes" },
];

const GRID_MIN = 8;
const GRID_MAX = 96;

const selectButtonClass =
  "flex w-full min-w-0 items-center justify-between gap-1.5 rounded-sm border border-border bg-surface-raised px-2.5 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-overlay dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark dark:hover:bg-surface-dark-overlay motion-reduce:transition-none h-9 whitespace-nowrap";

/**
 * Canvas interaction preferences. The camera lock is deliberately not here —
 * it is a mid-work gesture and lives on the canvas toolbar, where it is
 * reachable without leaving the workflow.
 */
export function CanvasSettingsPanel() {
  const { dragMode, snapToGrid, gridSize, wheelZoom, setCanvasPrefs } =
    useCanvasPrefsStore();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
            Left-drag on empty canvas
          </p>
          <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
            Holding space always pans, whichever of these is chosen — so this is
            about which one you get without a modifier. Middle-drag pans either
            way.
          </p>
        </div>
        <ButtonSelect
          options={DRAG_MODE_OPTIONS}
          value={dragMode}
          onChange={(value: string) =>
            setCanvasPrefs({ dragMode: value as CanvasDragMode })
          }
          containerClass="w-48 flex-shrink-0"
          buttonClass={selectButtonClass}
        />
      </div>

      <ToggleSetting
        title="Wheel zooms"
        description={
          "On, the scroll wheel zooms the canvas. Off, it pans and zooming " +
          "moves to Ctrl+wheel — which is what a trackpad wants."
        }
        checked={wheelZoom}
        onToggle={() => setCanvasPrefs({ wheelZoom: !wheelZoom })}
      />

      <ToggleSetting
        title="Snap to grid"
        description="Dragged nodes land on the canvas grid instead of anywhere."
        checked={snapToGrid}
        onToggle={() => setCanvasPrefs({ snapToGrid: !snapToGrid })}
      />

      {snapToGrid && (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
              Grid size
            </p>
            <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
              In canvas pixels. 24 matches the dots you can see.
            </p>
          </div>
          <div className="w-24 flex-shrink-0">
            <Input
              type="number"
              size="sm"
              min={GRID_MIN}
              max={GRID_MAX}
              value={gridSize}
              aria-label="Grid size in pixels"
              onChange={(e) => {
                const next = Number(e.target.value);
                // A blank or nonsense box would otherwise snap every node to
                // NaN, which puts the whole graph on top of itself.
                if (!Number.isFinite(next)) return;
                setCanvasPrefs({
                  gridSize: Math.min(GRID_MAX, Math.max(GRID_MIN, next)),
                });
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
