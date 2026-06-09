import { useState, useEffect, useRef, useCallback } from 'react';
import { Globe, ChevronDown, Settings } from 'lucide-react';
import API_BASE_URL from '../utils/api';
import useSidebarStore from '../stores/SidebarStore';
import type { Environment } from '../types';
import { authenticatedFetch } from '../utils/authenticatedApi';
import type { EnvironmentSelectorProps } from '../types/EnvironmentSelectorProps';

export default function EnvironmentSelector({ onManageClick }: EnvironmentSelectorProps) {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchEnvironments = useCallback(async () => {
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/api/environments`);
      if (response.ok) {
        const data: Environment[] = await response.json();
        setEnvironments(data);
      }
    } catch {
      // Silently fail - environments will be fetched on next attempt
    }
  }, []);

  useEffect(() => {
    fetchEnvironments();

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [fetchEnvironments]);

  const environmentVersion = useSidebarStore((s) => s.environmentVersion);
  useEffect(() => {
    if (environmentVersion > 0) fetchEnvironments();
  }, [environmentVersion, fetchEnvironments]);

  const handleManage = () => {
    setIsOpen(false);
    onManageClick();
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-surface-overlay dark:bg-surface-dark-overlay text-text-secondary dark:text-text-secondary-dark rounded hover:bg-surface-raised dark:hover:bg-surface-dark-raised transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
        title="Manage environments"
      >
        <Globe className="w-4 h-4 flex-shrink-0" />
        <span className="max-w-[120px] truncate">
          Environments
        </span>
        <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-surface-raised dark:bg-surface-dark-raised rounded-lg shadow-popover border border-border dark:border-border-dark z-50 py-1">
          <div className="px-3 py-2 border-b border-border dark:border-border-dark">
            <p className="text-xs font-medium text-text-muted dark:text-text-muted-dark uppercase">
              Available Environments
            </p>
          </div>

          <div className="max-h-64 overflow-auto py-1">
            {environments.length === 0 ? (
              <div className="px-3 py-2 text-sm text-text-muted dark:text-text-muted-dark text-center">
                No environments yet
              </div>
            ) : (
              environments.map((env) => (
                <div
                  key={env.environmentId}
                  className="px-3 py-2 text-sm hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate text-text-primary dark:text-text-primary-dark">
                        {env.name}
                      </div>
                      <div className="text-xs text-text-muted dark:text-text-muted-dark">
                        {Object.keys(env.variables).length} variables
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-border dark:border-border-dark py-1">
            <button
              type="button"
              onClick={handleManage}
              className="w-full text-left px-3 py-2 text-sm text-primary dark:text-primary-light hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors font-medium cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
            >
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 flex-shrink-0" />
                Manage Environments
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
