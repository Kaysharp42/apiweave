import { useEffect, useRef, useState } from 'react';
import { Save, History, Play, Code, Upload, Loader2, RefreshCw, ChevronDown } from 'lucide-react';
import { Button } from '../atoms/Button';
import { IconButton } from '../atoms/IconButton';
import ButtonSelect from '../ButtonSelect';
import type { CanvasToolbarProps } from '../../types/CanvasToolbarProps';
import type { ToolbarButtonProps } from '../../types/ToolbarButtonProps';
import { buildEnvironmentOptions } from './canvasToolbarUtils';

const EMPTY_ENVIRONMENTS: Array<{ environmentId: string; name: string }> = [];
const EMPTY_RESUME_OPTIONS: NonNullable<CanvasToolbarProps['resumeOptions']> = [];

export function CanvasToolbar({
  onSave,
  onHistory,
  onJsonEditor,
  onImport,
  onRun,
  onRunFromLastFailed,
  onRunAllFailed,
  onRunFromFailedNode,
  isRunning = false,
  environments = EMPTY_ENVIRONMENTS,
  selectedEnvironment,
  onEnvironmentChange,
  onRefreshSwagger,
  isSwaggerRefreshing = false,
  workflowId,
  resumeOptions = EMPTY_RESUME_OPTIONS,
  isResumeLoading = false,
}: CanvasToolbarProps) {
  const [isRunMenuOpen, setIsRunMenuOpen] = useState(false);
  const runMenuRef = useRef<HTMLDivElement>(null);
  const safeResumeOptions = resumeOptions ?? EMPTY_RESUME_OPTIONS;

  const hasResumeOptions = safeResumeOptions.length > 0;

  useEffect(() => {
    if (!isRunMenuOpen) return undefined;

    const onDocClick = (event: MouseEvent) => {
      if (!runMenuRef.current?.contains(event.target as Node)) {
        setIsRunMenuOpen(false);
      }
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsRunMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEscape);
    };
  }, [isRunMenuOpen]);

  return (
    <div
      className="absolute top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-auto flex items-center gap-1.5 px-2 py-1.5 rounded-xl bg-surface-raised/95 dark:bg-surface-dark-raised/95 backdrop-blur-sm border border-border-default dark:border-border-default-dark shadow-lg"
      role="toolbar"
      aria-label="Workflow actions"
    >
      <div className="flex items-center">
        <ToolbarButton icon={Save} label="Save" onClick={onSave} tooltip="Save workflow (Ctrl+S)" />
        <ToolbarButton icon={History} label="History" onClick={onHistory} tooltip="Run history" />
        <ToolbarButton icon={Code} label="JSON" onClick={onJsonEditor} tooltip="JSON editor (Ctrl+J)" />
        <ToolbarButton icon={Upload} label="Import" onClick={onImport} tooltip="Import nodes" />
      </div>

      <div className="w-px h-6 bg-border-default dark:bg-border-default-dark mx-0.5" aria-hidden="true" />

      <ButtonSelect
        key={`env-select-${workflowId ?? ''}`}
        options={buildEnvironmentOptions(environments)}
        value={selectedEnvironment || ''}
        onChange={onEnvironmentChange}
        placeholder="No Environment"
        buttonClass="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium rounded-lg bg-surface-overlay dark:bg-surface-dark-overlay text-text-primary dark:text-text-primary-dark border border-border-default dark:border-border-default-dark hover:bg-border-default dark:hover:bg-border-default-dark transition-colors h-8 whitespace-nowrap"
      />

      <Button
        variant="ghost"
        size="sm"
        onClick={onRefreshSwagger}
        disabled={!onRefreshSwagger || isSwaggerRefreshing}
        className="h-8 whitespace-nowrap"
        icon={<RefreshCw className={`w-4 h-4 flex-shrink-0 ${isSwaggerRefreshing ? 'animate-spin' : ''}`} />}
        title={isSwaggerRefreshing ? 'Refreshing Swagger' : 'Refresh Swagger'}
      >
        <span className="hidden lg:inline">{isSwaggerRefreshing ? 'Refreshing' : 'Refresh'}</span>
      </Button>

      <div className="w-px h-6 bg-border-default dark:bg-border-default-dark mx-0.5" aria-hidden="true" />

      <div className="relative flex" ref={runMenuRef}>
        <Button
          intent={isRunning ? 'warning' : 'default'}
          size="sm"
          onClick={onRun}
          disabled={isRunning}
          className="rounded-r-none h-8 whitespace-nowrap font-semibold border-r border-surface-raised/30 dark:border-surface-dark-raised/30"
          icon={isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        >
          {isRunning ? 'Running…' : 'Run'}
        </Button>

        <IconButton
          onClick={() => setIsRunMenuOpen((prev) => !prev)}
          disabled={isRunning}
          tooltip="Run options"
          variant={isRunning ? 'warning' : 'primary'}
          size="sm"
          className={[
            'h-8 rounded-l-none rounded-r-lg transition-colors border-l border-surface-raised/30 dark:border-surface-dark-raised/30',
            isRunning
              ? 'cursor-wait'
              : 'hover:brightness-110',
          ].join(' ')}
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${isRunMenuOpen ? 'rotate-180' : ''}`} />
        </IconButton>

        {isRunMenuOpen && (
          <div className="absolute top-9 right-0 min-w-[280px] max-w-[360px] rounded-lg border border-border-default dark:border-border-default-dark bg-surface-raised dark:bg-surface-dark-raised shadow-lg overflow-hidden z-50">
            <Button
              onClick={() => {
                onRunFromLastFailed?.();
                setIsRunMenuOpen(false);
              }}
              disabled={isRunning || !hasResumeOptions || isResumeLoading}
              variant="ghost"
              className="w-full rounded-none justify-start px-3 py-2 text-sm"
            >
              Run from last failed node
            </Button>

            <Button
              onClick={() => {
                onRunAllFailed?.();
                setIsRunMenuOpen(false);
              }}
              disabled={isRunning || !hasResumeOptions || isResumeLoading}
              variant="ghost"
              className="w-full rounded-none justify-start px-3 py-2 text-sm"
            >
              Run all failed nodes and continue
            </Button>

            <div className="w-full h-px bg-border-default dark:bg-border-default-dark" />

            {isResumeLoading && (
              <div className="px-3 py-2 text-xs text-text-muted dark:text-text-muted-dark">
                Loading failed nodes…
              </div>
            )}

            {!isResumeLoading && !hasResumeOptions && (
              <div className="px-3 py-2 text-xs text-text-muted dark:text-text-muted-dark">
                No failed run available.
              </div>
            )}

            {!isResumeLoading && hasResumeOptions && safeResumeOptions.map((opt) => (
              <Button
                key={opt.nodeId}
                onClick={() => {
                  onRunFromFailedNode?.(opt.nodeId);
                  setIsRunMenuOpen(false);
                }}
                disabled={isRunning}
                variant="ghost"
                className="w-full rounded-none justify-start px-3 py-2 text-sm"
                title={opt.nodeId}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolbarButton({ icon: Icon, label, onClick, tooltip }: ToolbarButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-8 whitespace-nowrap text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark"
      title={tooltip || label}
      aria-label={label}
      icon={<Icon className="w-4 h-4 flex-shrink-0" />}
    >
      <span className="hidden lg:inline">{label}</span>
    </Button>
  );
}
