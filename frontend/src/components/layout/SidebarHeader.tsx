import { useState, useEffect, useRef } from 'react';
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
import { Spinner, Button } from '../atoms';
import { SearchInput } from '../molecules';
import useSidebarStore from '../../stores/SidebarStore';
import type { SidebarHeaderProps } from '../../types/SidebarHeaderProps';

type LucideIcon = React.ComponentType<React.SVGProps<SVGSVGElement>>;

interface ImportMenuItem {
  label: string;
  icon: LucideIcon;
  action: () => void;
}

export function SidebarHeader({ selectedNav, onCreateNew, isRefreshing }: SidebarHeaderProps) {
  const [showWorkflowImportExport, setShowWorkflowImportExport] = useState(false);
  const [showHARImport, setShowHARImport] = useState(false);
  const [showOpenAPIImport, setShowOpenAPIImport] = useState(false);
  const [showCurlImport, setShowCurlImport] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showCollectionImportExport, setShowCollectionImportExport] = useState(false);
  const [collectionImportMode, setCollectionImportMode] = useState<'export' | 'import-collection' | 'import-workflows' | 'import-har' | 'import-openapi' | 'import-curl' | null>(null);
  const importMenuRef = useRef<HTMLDivElement>(null);

  const searchQuery = useSidebarStore((s) => s.searchQuery);
  const setSearchQuery = useSidebarStore((s) => s.setSearchQuery);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (importMenuRef.current && !importMenuRef.current.contains(event.target as Node)) {
        setShowImportMenu(false);
      }
    };

    if (showImportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showImportMenu]);

  const getNavLabel = (): string => {
    switch (selectedNav) {
      case 'workflows': return 'Workflows';
      case 'collections': return 'Collections';
      case 'webhooks': return 'Webhooks';
      case 'settings': return 'Settings';
      default: return 'APIWeave';
    }
  };

  const workflowImportItems: ImportMenuItem[] = [
    { label: 'Workflow', icon: Download, action: () => { setShowWorkflowImportExport(true); setShowImportMenu(false); } },
    { label: 'HAR File', icon: Upload, action: () => { setShowHARImport(true); setShowImportMenu(false); } },
    { label: 'OpenAPI', icon: Upload, action: () => { setShowOpenAPIImport(true); setShowImportMenu(false); } },
    { label: 'cURL', icon: Terminal, action: () => { setShowCurlImport(true); setShowImportMenu(false); } },
  ];

  const collectionImportItems: ImportMenuItem[] = [
    { label: 'Collection', icon: FolderOpen, action: () => { setCollectionImportMode('import-collection'); setShowCollectionImportExport(true); setShowImportMenu(false); } },
    { label: 'HAR File', icon: Upload, action: () => { setCollectionImportMode('import-har'); setShowCollectionImportExport(true); setShowImportMenu(false); } },
    { label: 'OpenAPI', icon: Upload, action: () => { setCollectionImportMode('import-openapi'); setShowCollectionImportExport(true); setShowImportMenu(false); } },
    { label: 'cURL', icon: Terminal, action: () => { setCollectionImportMode('import-curl'); setShowCollectionImportExport(true); setShowImportMenu(false); } },
  ];

  const importItems = selectedNav === 'collections' ? collectionImportItems : workflowImportItems;
  const showActions = selectedNav === 'workflows' || selectedNav === 'collections';
  const showSearch = selectedNav === 'workflows' || selectedNav === 'collections';

  return (
    <>
      <div className="flex flex-col border-b border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised">
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-1 text-sm min-w-0">
            <User className="w-3.5 h-3.5 text-text-muted dark:text-text-muted-dark flex-shrink-0" />
            <span className="text-text-secondary dark:text-text-secondary-dark truncate">My Workspace</span>
            <ChevronRight className="w-3 h-3 text-text-muted dark:text-text-muted-dark flex-shrink-0" />
            <span className="font-semibold text-text-primary dark:text-text-primary-dark truncate">
              {getNavLabel()}
            </span>
            {isRefreshing && <Spinner size="xs" className="ml-1.5" />}
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
              <span>{selectedNav === 'collections' ? 'Create' : 'New'}</span>
            </Button>

            <div className="relative flex-1" ref={importMenuRef}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowImportMenu(!showImportMenu)}
                icon={<Upload className="w-4 h-4" />}
                className="w-full"
              >
                <span>Import</span>
              </Button>

              {showImportMenu && (
                <ul className="menu menu-sm bg-surface-raised dark:bg-surface-dark-raised border border-border dark:border-border-dark rounded-lg shadow-lg absolute top-full left-0 mt-1 z-20 min-w-[140px] p-1">
                  {importItems.map(({ label, icon: Icon, action }) => (
                    <li key={label}>
                      <button onClick={action} className="flex items-center gap-2 text-sm">
                        <Icon className="w-4 h-4" />
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

      {showWorkflowImportExport && (
        <WorkflowExportImport
          onClose={() => setShowWorkflowImportExport(false)}
          initialTab="import"
          onImportSuccess={() => {
            setShowWorkflowImportExport(false);
            useSidebarStore.getState().signalWorkflowsRefresh();
          }}
        />
      )}
      {showHARImport && <HARImport onClose={() => setShowHARImport(false)} />}
      {showOpenAPIImport && <OpenAPIImport onClose={() => setShowOpenAPIImport(false)} />}
      {showCurlImport && <CurlImport onClose={() => setShowCurlImport(false)} />}
      {showCollectionImportExport && (
        <CollectionExportImport
          {...(collectionImportMode && { mode: collectionImportMode })}
          isOpen={true}
          onClose={() => {
            setShowCollectionImportExport(false);
            setCollectionImportMode(null);
          }}
          onImportSuccess={() => {
            setShowCollectionImportExport(false);
            setCollectionImportMode(null);
            useSidebarStore.getState().signalCollectionsRefresh();
          }}
        />
      )}
    </>
  );
}
