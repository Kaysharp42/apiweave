import { useContext } from "react";
import { AppContext } from "../../App";
import { ToggleSetting } from "../molecules/ToggleSetting";
import { Input } from "../atoms/Input";
import ButtonSelect from "../ButtonSelect";
import useCanvasPrefsStore from "../../stores/CanvasPrefsStore";
import type { AppContextType } from "../../types/AppContextType";
import type { CanvasDragMode } from "../../types/CanvasDragMode";
import type { SelectOption, ThemePreference } from "../../types";

const DRAG_MODE_OPTIONS: SelectOption[] = [
  { value: "pan", label: "Pan the canvas" },
  { value: "select", label: "Box-select nodes" },
];

const THEME_OPTIONS: SelectOption[] = [
  { value: "system", label: "Follow system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const GRID_MIN = 8;
const GRID_MAX = 96;

const selectButtonClass =
  "flex w-full min-w-0 items-center justify-between gap-1.5 rounded-xs border border-border bg-surface-raised px-2.5 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-overlay dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark dark:hover:bg-surface-dark-overlay motion-reduce:transition-none h-9 whitespace-nowrap";

/**
 * Editing and canvas interaction preferences, plus the app's appearance.
 * Auto-save belongs here because it is about the editor writing your work as
 * you go, not about the graph itself. The camera lock is deliberately not here
 * — it is a mid-work gesture and lives on the canvas toolbar, where it is
 * reachable without leaving the workflow.
 */
export function CanvasSettingsPanel() {
  const {
    autoSaveEnabled,
    setAutoSaveEnabled,
    themePreference,
    setThemePreference,
  } = useContext(AppContext) as AppContextType;
  const {
    dragMode,
    snapToGrid,
    gridSize,
    wheelZoom,
    tipsEnabled,
    minimapVisible,
    setCanvasPrefs,
  } = useCanvasPrefsStore();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
            Theme
          </p>
          <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
            Follow system switches with your OS appearance; Light and Dark stay
            put. The header toggle always picks one of the two explicit themes.
          </p>
        </div>
        <ButtonSelect
          options={THEME_OPTIONS}
          value={themePreference}
          onChange={(value: string) =>
            setThemePreference(value as ThemePreference)
          }
          containerClass="w-48 shrink-0"
          buttonClass={selectButtonClass}
        />
      </div>

      <ToggleSetting
        title="Auto-save"
        description="Save changes automatically about 700 ms after you stop editing."
        checked={autoSaveEnabled}
        onToggle={() => setAutoSaveEnabled(!autoSaveEnabled)}
      />

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
          containerClass="w-48 shrink-0"
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

      <ToggleSetting
        title="Contextual canvas tips"
        description="Show a shortcut when the current selection unlocks an action."
        checked={tipsEnabled}
        onToggle={() => setCanvasPrefs({ tipsEnabled: !tipsEnabled })}
      />

      <ToggleSetting
        title="Show minimap"
        description="An overview of the graph in the bottom-right corner. Off keeps the canvas clear."
        checked={minimapVisible}
        onToggle={() =>
          setCanvasPrefs({ minimapVisible: !minimapVisible })
        }
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
          <div className="w-24 shrink-0">
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
