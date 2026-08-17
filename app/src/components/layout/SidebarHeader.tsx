import { useReducer } from "react";
import { useShallow } from "zustand/react/shallow";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { Upload, Plus, FolderOpen, Download, Terminal } from "lucide-react";
import WorkflowExportImport from "../WorkflowExportImport";
import HARImport from "../HARImport";
import OpenAPIImport from "../OpenAPIImport";
import CurlImport from "../CurlImport";
import CollectionExportImport from "../CollectionExportImport";
import { Button } from "../atoms/Button";
import { Spinner } from "../atoms/Spinner";
import { SearchInput } from "../molecules/SearchInput";
import { OrgWorkspaceSwitcher } from "../organisms/OrgWorkspaceSwitcher";
import useSidebarStore from "../../stores/SidebarStore";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import type { SidebarHeaderProps } from "../../types";

type LucideIcon = React.ComponentType<React.SVGProps<SVGSVGElement>>;

interface ImportMenuItem {
  label: string;
  icon: LucideIcon;
  action: () => void;
}

interface SidebarHeaderState {
  showWorkflowImportExport: boolean;
  showHARImport: boolean;
  showOpenAPIImport: boolean;
  showCurlImport: boolean;
  showCollectionImportExport: boolean;
  collectionImportMode:
    | "export"
    | "import-collection"
    | "import-workflows"
    | "import-har"
    | "import-openapi"
    | "import-curl"
    | null;
}

type SidebarHeaderAction =
  | { type: "open-workflow-import-export" }
  | { type: "open-har-import" }
  | { type: "open-openapi-import" }
  | { type: "open-curl-import" }
  | {
      type: "open-collection-import";
      mode: SidebarHeaderState["collectionImportMode"];
    }
  | { type: "close-workflow-import-export" }
  | { type: "close-har-import" }
  | { type: "close-openapi-import" }
  | { type: "close-curl-import" }
  | { type: "close-collection-import" };

const initialState: SidebarHeaderState = {
  showWorkflowImportExport: false,
  showHARImport: false,
  showOpenAPIImport: false,
  showCurlImport: false,
  showCollectionImportExport: false,
  collectionImportMode: null,
};

function sidebarHeaderReducer(
  state: SidebarHeaderState,
  action: SidebarHeaderAction,
): SidebarHeaderState {
  switch (action.type) {
    case "open-workflow-import-export":
      return { ...state, showWorkflowImportExport: true };
    case "open-har-import":
      return { ...state, showHARImport: true };
    case "open-openapi-import":
      return { ...state, showOpenAPIImport: true };
    case "open-curl-import":
      return { ...state, showCurlImport: true };
    case "open-collection-import":
      return {
        ...state,
        collectionImportMode: action.mode,
        showCollectionImportExport: true,
      };
    case "close-workflow-import-export":
      return { ...state, showWorkflowImportExport: false };
    case "close-har-import":
      return { ...state, showHARImport: false };
    case "close-openapi-import":
      return { ...state, showOpenAPIImport: false };
    case "close-curl-import":
      return { ...state, showCurlImport: false };
    case "close-collection-import":
      return {
        ...state,
        showCollectionImportExport: false,
        collectionImportMode: null,
      };
    default:
      return state;
  }
}

export function SidebarHeader({
  selectedNav,
  onCreateNew,
  isRefreshing,
}: SidebarHeaderProps) {
  const [state, dispatch] = useReducer(sidebarHeaderReducer, initialState);

  // One selector rather than three; `useShallow` keeps re-renders identical
  // to the separate subscriptions it replaces.
  const { searchQuery, setSearchQuery, activeWorkspaceId } = useSidebarStore(
    useShallow((s) => ({
      searchQuery: s.searchQuery,
      setSearchQuery: s.setSearchQuery,
      activeWorkspaceId: s.activeWorkspaceId,
    })),
  );
  const { currentWorkspace } = useWorkspace();

  const getNavLabel = (): string => {
    switch (selectedNav) {
      case "workflows":
        return "Workflows";
      case "projects":
        return "Projects";
      case "agents":
        return "Agents";
      case "mcp":
        return "MCP";
      case "settings":
        return "Settings";
      default:
        return "APIWeave";
    }
  };

  const workflowImportItems: ImportMenuItem[] = [
    {
      label: "Workflow",
      icon: Download,
      action: () => dispatch({ type: "open-workflow-import-export" }),
    },
    {
      label: "HAR File",
      icon: Upload,
      action: () => dispatch({ type: "open-har-import" }),
    },
    {
      label: "OpenAPI",
      icon: Upload,
      action: () => dispatch({ type: "open-openapi-import" }),
    },
    {
      label: "cURL",
      icon: Terminal,
      action: () => dispatch({ type: "open-curl-import" }),
    },
  ];

  const collectionImportItems: ImportMenuItem[] = [
    {
      label: "Collection",
      icon: FolderOpen,
      action: () =>
        dispatch({ type: "open-collection-import", mode: "import-collection" }),
    },
    {
      label: "HAR File",
      icon: Upload,
      action: () =>
        dispatch({ type: "open-collection-import", mode: "import-har" }),
    },
    {
      label: "OpenAPI",
      icon: Upload,
      action: () =>
        dispatch({ type: "open-collection-import", mode: "import-openapi" }),
    },
    {
      label: "cURL",
      icon: Terminal,
      action: () =>
        dispatch({ type: "open-collection-import", mode: "import-curl" }),
    },
  ];

  const importItems =
    selectedNav === "projects" ? collectionImportItems : workflowImportItems;
  const showActions = selectedNav === "workflows" || selectedNav === "projects";
  const showSearch = selectedNav === "workflows" || selectedNav === "projects";

  return (
    <>
      <div className="flex flex-col border-b border-border bg-surface-raised dark:border-border-dark dark:bg-surface-dark-raised">
        {/* Workspace scope sits above the section it scopes; the section name is
            the panel heading right below it. */}
        <div className="px-2.5 pb-2 pt-2.5">
          <OrgWorkspaceSwitcher />
        </div>

        <div className="flex items-center gap-1.5 px-3 pb-1.5 min-w-0">
          <h2 className="truncate text-xxs font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
            {getNavLabel()}
          </h2>
          {isRefreshing && (
            <Spinner size="xs" className="motion-reduce:animate-none" />
          )}
        </div>

        {showActions && (
          <div className="flex items-center gap-1 px-2.5 pb-2">
            <Button
              variant="primary"
              intent="default"
              size="xs"
              onClick={onCreateNew}
              icon={<Plus className="w-3.5 h-3.5" />}
              className="flex-1"
            >
              <span>
                {selectedNav === "projects" ? "New Project" : "New Workflow"}
              </span>
            </Button>

            {/* MenuItems is anchored, so Headless UI renders it in a portal —
                the surrounding overflow-hidden panes can no longer clip it. */}
            <Menu as="div" className="flex-1">
              <MenuButton
                as={Button}
                variant="outline"
                size="xs"
                icon={<Upload className="w-3.5 h-3.5" />}
                className="w-full"
              >
                <span>Import</span>
              </MenuButton>

              <MenuItems
                anchor={{ to: "bottom start", gap: 4, padding: 8 }}
                className="z-50 min-w-[var(--button-width)] rounded border border-border bg-surface-raised p-1 shadow-overlay focus:outline-none dark:border-border-dark dark:bg-surface-dark-raised"
              >
                {importItems.map(({ label, icon: Icon, action }) => (
                  <MenuItem key={label}>
                    <button
                      type="button"
                      onClick={action}
                      className={[
                        "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs",
                        "text-text-primary dark:text-text-primary-dark",
                        "data-[focus]:bg-surface-overlay dark:data-[focus]:bg-surface-dark-overlay",
                        "cursor-pointer transition-colors motion-reduce:transition-none",
                      ].join(" ")}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0 text-text-muted dark:text-text-muted-dark" />
                      {label}
                    </button>
                  </MenuItem>
                ))}
              </MenuItems>
            </Menu>
          </div>
        )}

        {showSearch && (
          <div className="px-2.5 pb-2">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={`Filter ${getNavLabel().toLowerCase()}…`}
              size="xs"
            />
          </div>
        )}
      </div>

      {state.showWorkflowImportExport && (
        <WorkflowExportImport
          workspaceId={currentWorkspace?.workspaceId ?? activeWorkspaceId}
          onClose={() => dispatch({ type: "close-workflow-import-export" })}
          initialTab="import"
          onImportSuccess={() => {
            dispatch({ type: "close-workflow-import-export" });
            useSidebarStore.getState().signalWorkflowsRefresh();
          }}
        />
      )}
      {state.showHARImport && (
        <HARImport onClose={() => dispatch({ type: "close-har-import" })} />
      )}
      {state.showOpenAPIImport && (
        <OpenAPIImport
          onClose={() => dispatch({ type: "close-openapi-import" })}
        />
      )}
      {state.showCurlImport && (
        <CurlImport onClose={() => dispatch({ type: "close-curl-import" })} />
      )}
      {state.showCollectionImportExport && (
        <CollectionExportImport
          {...(state.collectionImportMode && {
            mode: state.collectionImportMode,
          })}
          isOpen={true}
          onClose={() => {
            dispatch({ type: "close-collection-import" });
          }}
          onImportSuccess={() => {
            dispatch({ type: "close-collection-import" });
            useSidebarStore.getState().signalCollectionsRefresh();
          }}
        />
      )}
    </>
  );
}
