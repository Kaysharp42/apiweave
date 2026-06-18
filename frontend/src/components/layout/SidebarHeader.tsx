import { useEffect, useReducer, useRef } from 'react';
import {
  Upload,
  Plus,
  FolderOpen,
  Download,
  Terminal,
  ChevronRight,
  User,
} from 'lucide-react';
import WorkflowExportImport from '../WorkflowExportImport';
import HARImport from '../HARImport';
import OpenAPIImport from '../OpenAPIImport';
import CurlImport from '../CurlImport';
import CollectionExportImport from '../CollectionExportImport';
import { Button } from '../atoms/Button';
import { Spinner } from '../atoms/Spinner';
import { SearchInput } from '../molecules/SearchInput';
import useSidebarStore from '../../stores/SidebarStore';
import type { SidebarHeaderProps } from '../../types';

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
  showImportMenu: boolean;
  showCollectionImportExport: boolean;
  collectionImportMode: 'export' | 'import-collection' | 'import-workflows' | 'import-har' | 'import-openapi' | 'import-curl' | null;
}

type SidebarHeaderAction =
  | { type: 'toggle-import-menu' }
  | { type: 'close-import-menu' }
  | { type: 'open-workflow-import-export' }
  | { type: 'open-har-import' }
  | { type: 'open-openapi-import' }
  | { type: 'open-curl-import' }
  | { type: 'open-collection-import'; mode: SidebarHeaderState['collectionImportMode'] }
  | { type: 'close-workflow-import-export' }
  | { type: 'close-har-import' }
  | { type: 'close-openapi-import' }
  | { type: 'close-curl-import' }
  | { type: 'close-collection-import' };

const initialState: SidebarHeaderState = {
  showWorkflowImportExport: false,
  showHARImport: false,
  showOpenAPIImport: false,
  showCurlImport: false,
  showImportMenu: false,
  showCollectionImportExport: false,
  collectionImportMode: null,
};

function sidebarHeaderReducer(state: SidebarHeaderState, action: SidebarHeaderAction): SidebarHeaderState {
  switch (action.type) {
    case 'toggle-import-menu':
      return { ...state, showImportMenu: !state.showImportMenu };
    case 'close-import-menu':
      return { ...state, showImportMenu: false };
    case 'open-workflow-import-export':
      return { ...state, showWorkflowImportExport: true, showImportMenu: false };
    case 'open-har-import':
      return { ...state, showHARImport: true, showImportMenu: false };
    case 'open-openapi-import':
      return { ...state, showOpenAPIImport: true, showImportMenu: false };
    case 'open-curl-import':
      return { ...state, showCurlImport: true, showImportMenu: false };
    case 'open-collection-import':
      return {
        ...state,
        collectionImportMode: action.mode,
        showCollectionImportExport: true,
        showImportMenu: false,
      };
    case 'close-workflow-import-export':
      return { ...state, showWorkflowImportExport: false };
    case 'close-har-import':
      return { ...state, showHARImport: false };
    case 'close-openapi-import':
      return { ...state, showOpenAPIImport: false };
    case 'close-curl-import':
      return { ...state, showCurlImport: false };
    case 'close-collection-import':
      return { ...state, showCollectionImportExport: false, collectionImportMode: null };
    default:
      return state;
  }
}

export function SidebarHeader({ selectedNav, onCreateNew, isRefreshing }: SidebarHeaderProps) {
  const [state, dispatch] = useReducer(sidebarHeaderReducer, initialState);
  const importMenuRef = useRef<HTMLDivElement>(null);

  const searchQuery = useSidebarStore((s) => s.searchQuery);
  const setSearchQuery = useSidebarStore((s) => s.setSearchQuery);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (importMenuRef.current && !importMenuRef.current.contains(event.target as Node)) {
        dispatch({ type: 'close-import-menu' });
      }
    };

    if (state.showImportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [state.showImportMenu]);

  const getNavLabel = (): string => {
    switch (selectedNav) {
      case 'workflows': return 'Workflows';
      case 'projects': return 'Projects';
      case 'webhooks': return 'Webhooks';
      case 'mcp': return 'MCP';
      case 'settings': return 'Settings';
      default: return 'APIWeave';
    }
  };

  const workflowImportItems: ImportMenuItem[] = [
    { label: 'Workflow', icon: Download, action: () => dispatch({ type: 'open-workflow-import-export' }) },
    { label: 'HAR File', icon: Upload, action: () => dispatch({ type: 'open-har-import' }) },
    { label: 'OpenAPI', icon: Upload, action: () => dispatch({ type: 'open-openapi-import' }) },
    { label: 'cURL', icon: Terminal, action: () => dispatch({ type: 'open-curl-import' }) },
  ];

  const collectionImportItems: ImportMenuItem[] = [
    { label: 'Collection', icon: FolderOpen, action: () => dispatch({ type: 'open-collection-import', mode: 'import-collection' }) },
    { label: 'HAR File', icon: Upload, action: () => dispatch({ type: 'open-collection-import', mode: 'import-har' }) },
    { label: 'OpenAPI', icon: Upload, action: () => dispatch({ type: 'open-collection-import', mode: 'import-openapi' }) },
    { label: 'cURL', icon: Terminal, action: () => dispatch({ type: 'open-collection-import', mode: 'import-curl' }) },
  ];

  const importItems = selectedNav === 'projects' ? collectionImportItems : workflowImportItems;
  const showActions = selectedNav === 'workflows' || selectedNav === 'projects';
  const showSearch = selectedNav === 'workflows' || selectedNav === 'projects';

  return (
    <>
      <div className="flex flex-col border-b border-[var(--aw-border)] bg-surface-raised dark:bg-surface-dark-raised">
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-1 text-sm min-w-0">
            <User className="w-3.5 h-3.5 text-text-muted dark:text-text-muted-dark flex-shrink-0" />
            <span className="text-text-secondary dark:text-text-secondary-dark truncate">My Workspace</span>
            <ChevronRight className="w-3 h-3 text-text-muted dark:text-text-muted-dark flex-shrink-0" />
            <span className="font-semibold text-text-primary dark:text-text-primary-dark truncate">
              {getNavLabel()}
            </span>
            {isRefreshing && <Spinner size="xs" className="ml-1.5 motion-reduce:animate-none" />}
          </div>
        </div>

        {showActions && (
          <div className="flex items-center gap-1 px-3 pb-2">
            <Button
              variant="ghost"
              intent="default"
              size="sm"
              onClick={onCreateNew}
              icon={<Plus className="w-4 h-4" />}
              className="flex-1"
            >
              <span>{selectedNav === 'projects' ? 'New Project' : 'New Workflow'}</span>
            </Button>

            <div className="relative flex-1" ref={importMenuRef}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => dispatch({ type: 'toggle-import-menu' })}
                icon={<Upload className="w-4 h-4" />}
                className="w-full"
              >
                <span>Import</span>
              </Button>

              {state.showImportMenu && (
                <ul className="bg-surface-raised dark:bg-surface-dark-raised border border-[var(--aw-border)] rounded-lg shadow-[var(--aw-shadow-popover)] absolute top-full left-0 mt-1 z-20 min-w-[140px] p-1">
                  {importItems.map(({ label, icon: Icon, action }) => (
                    <li key={label}>
                      <button
                        type="button"
                        onClick={action}
                        className={[
                          'flex items-center gap-2 text-sm w-full px-3 py-1.5 rounded-md text-left',
                          'text-text-primary dark:text-text-primary-dark',
                          'hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay',
                          'focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]',
                          'cursor-pointer transition-colors',
                        ].join(' ')}
                      >
                        <Icon className="w-4 h-4 text-text-muted dark:text-text-muted-dark" />
                        {label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {showSearch && (
          <div className="px-3 pb-2.5">
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
          onClose={() => dispatch({ type: 'close-workflow-import-export' })}
          initialTab="import"
          onImportSuccess={() => {
            dispatch({ type: 'close-workflow-import-export' });
            useSidebarStore.getState().signalWorkflowsRefresh();
          }}
        />
      )}
      {state.showHARImport && <HARImport onClose={() => dispatch({ type: 'close-har-import' })} />}
      {state.showOpenAPIImport && <OpenAPIImport onClose={() => dispatch({ type: 'close-openapi-import' })} />}
      {state.showCurlImport && <CurlImport onClose={() => dispatch({ type: 'close-curl-import' })} />}
      {state.showCollectionImportExport && (
        <CollectionExportImport
          {...(state.collectionImportMode && { mode: state.collectionImportMode })}
          isOpen={true}
          onClose={() => {
            dispatch({ type: 'close-collection-import' });
          }}
          onImportSuccess={() => {
            dispatch({ type: 'close-collection-import' });
            useSidebarStore.getState().signalCollectionsRefresh();
          }}
        />
      )}
    </>
  );
}