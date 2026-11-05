import { lazy, Suspense, type ComponentType } from "react";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { Settings, Sparkles, Package, PanelRightClose } from "lucide-react";
import { WorkflowProvider } from "../../contexts/WorkflowContext";
import { Spinner } from "../atoms/Spinner";
import { Panel } from "../molecules/Panel";
import { PanelTabs } from "../molecules/PanelTabs";
import { IconButton } from "../atoms/IconButton";
import type { TabItem, WorkspaceCanvasPaneProps } from "../../types";

// The canvas is the screen, but it is not the launch screen: a session with no
// tab open shows the workflow list and never mounts it. Keeping it (and the
// right-panel inspectors) behind its own chunk means the shell can paint before
// ReactFlow and the node family are parsed.
const WorkflowCanvas = lazy(() => import("../WorkflowCanvas"));

const panelTabs: TabItem[] = [
  { key: "variables", icon: Package, label: "Variables" },
  { key: "dynamic", icon: Sparkles, label: "Functions" },
  { key: "settings", icon: Settings, label: "Settings" },
];

// One body per panel tab, keyed like `panelTabs`.
const PANEL_BODIES: Readonly<Record<string, ComponentType>> = {
  variables: lazy(() => import("../VariablesPanel")),
  dynamic: lazy(() => import("../DynamicFunctionsHelper")),
  settings: lazy(() => import("../WorkflowSettingsPanel")),
};

/**
 * The canvas of the active tab and its resizable right panel.
 *
 * Split from `Workspace` so the tab shell — the tab bar, the launch screen and
 * the dialogs — is not also a wall of Allotment and panel layout.
 */
export function WorkspaceCanvasPane({
  tab,
  showVariablesPanel,
  onShowVariablesPanel,
  activePanelTab,
  onActivePanelTabChange,
}: WorkspaceCanvasPaneProps) {
  const PanelBody = PANEL_BODIES[activePanelTab];

  return (
    <WorkflowProvider
      key={tab.id}
      workflowId={tab.id}
      initialWorkflow={tab.draft ?? tab.workflow}
    >
      <div className="flex-1 overflow-hidden">
        <Allotment className="h-full">
          <Allotment.Pane>
            <div className="h-full w-full">
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center">
                    <Spinner size="lg" />
                  </div>
                }
              >
                <WorkflowCanvas
                  workflowId={tab.id}
                  workflow={tab.workflow}
                  draft={tab.draft}
                  isPanelOpen={showVariablesPanel}
                  showVariablesPanel={showVariablesPanel}
                  onShowVariablesPanel={onShowVariablesPanel}
                />
              </Suspense>
            </div>
          </Allotment.Pane>

          {showVariablesPanel && (
            <Allotment.Pane preferredSize={320} minSize={280}>
              <Panel
                className="h-full rounded-none border-l border-border dark:border-border-dark"
                title=""
                collapsible={false}
                headerActions={
                  <IconButton
                    tooltip="Collapse panel"
                    size="xs"
                    onClick={() => onShowVariablesPanel(false)}
                  >
                    <PanelRightClose className="w-4 h-4" />
                  </IconButton>
                }
              >
                {/* Column: the tab bar keeps its intrinsic height and the
                    active panel takes the rest. Without this the panel's own
                    `h-full` stacked below the tab bar and its footer was
                    clipped out of reach by the shell's overflow. */}
                <div className="flex h-full min-h-0 flex-col">
                  <div className="shrink-0">
                    <PanelTabs
                      tabs={panelTabs}
                      activeTab={activePanelTab}
                      onTabChange={onActivePanelTabChange}
                    />
                  </div>

                  <div className="min-h-0 flex-1">
                    <Suspense
                      fallback={
                        <div className="flex justify-center p-4">
                          <Spinner />
                        </div>
                      }
                    >
                      {PanelBody !== undefined && <PanelBody />}
                    </Suspense>
                  </div>
                </div>
              </Panel>
            </Allotment.Pane>
          )}
        </Allotment>
      </div>
    </WorkflowProvider>
  );
}
