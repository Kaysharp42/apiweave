import React, { useEffect, useRef, useState } from 'react';
import { Save, History, Play, Code, Upload, Loader2, RefreshCw, ChevronDown } from 'lucide-react';
import ButtonSelect from '../ButtonSelect';

export default function CanvasToolbar({
  onSave,
  onHistory,
  onJsonEditor,
  onImport,
  onRun,
  onRunFromLastFailed,
  onRunAllFailed,
  onRunFromFailedNode,
  isRunning = false,
  environments = [],
  selectedEnvironment,
  onEnvironmentChange,
  onRefreshSwagger,
  isSwaggerRefreshing = false,
  workflowId,
  resumeOptions = [],
  isResumeLoading = false,
}) {
  const [isRunMenuOpen, setIsRunMenuOpen] = useState(false);
  const runMenuRef = useRef(null);

  const hasResumeOptions = resumeOptions.length > 0;

  useEffect(() => {
    if (!isRunMenuOpen) return undefined;

    const onDocClick = (event) => {
      if (!runMenuRef.current?.contains(event.target)) {
        setIsRunMenuOpen(false);
      }
    };

    const onEscape = (event) => {
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
        key={`env-select-${workflowId}`}
        options={[
          { value: '', label: 'No Environment' },
          ...environments.map((e) => ({ value: e.environmentId, label: e.name })),
        ]}
        value={selectedEnvironment || ''}
        onChange={onEnvironmentChange}
        placeholder="No Environment"
        buttonClass="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium rounded-lg bg-surface-overlay dark:bg-surface-dark-overlay text-text-primary dark:text-text-primary-dark border border-border-default dark:border-border-default-dark hover:bg-border-default dark:hover:bg-border-default-dark transition-colors h-8 whitespace-nowrap"
      />

      <button
        onClick={onRefreshSwagger}
        disabled={!onRefreshSwagger || isSwaggerRefreshing}
        className={[
          'flex items-center gap-1 px-2 py-1.5 text-sm font-medium rounded-lg transition-colors h-8 whitespace-nowrap',
          !onRefreshSwagger || isSwaggerRefreshing
            ? 'text-text-muted dark:text-text-muted-dark bg-surface dark:bg-surface-dark cursor-not-allowed'
            : 'text-text-secondary dark:text-text-secondary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay hover:text-text-primary dark:hover:text-text-primary-dark',
        ].join(' ')}
        title="Refresh Swagger templates now"
        aria-label={isSwaggerRefreshing ? 'Refreshing Swagger templates' : 'Refresh Swagger templates'}
      >
        <RefreshCw className={`w-4 h-4 flex-shrink-0 ${isSwaggerRefreshing ? 'animate-spin' : ''}`} />
        <span className="hidden lg:inline">{isSwaggerRefreshing ? 'Refreshing' : 'Refresh'}</span>
      </button>

      <div className="w-px h-6 bg-border-default dark:bg-border-default-dark mx-0.5" aria-hidden="true" />

      <div className="relative flex" ref={runMenuRef}>
        <button
          onClick={onRun}
          disabled={isRunning}
          className={[
            'flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-l-lg transition-colors h-8 whitespace-nowrap border-r border-black/10',
            isRunning
              ? 'bg-status-running/20 text-status-running cursor-wait'
              : 'bg-status-success text-white hover:brightness-110',
          ].join(' ')}
          aria-label={isRunning ? 'Workflow running' : 'Run workflow'}
          title="Run workflow (Ctrl+R)"
        >
          {isRunning ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          <span>{isRunning ? 'Running…' : 'Run'}</span>
        </button>

        <button
          onClick={() => setIsRunMenuOpen((prev) => !prev)}
          disabled={isRunning}
          className={[
            'flex items-center justify-center px-2 py-1.5 h-8 rounded-r-lg transition-colors',
            isRunning
              ? 'bg-status-running/20 text-status-running cursor-wait'
              : 'bg-status-success text-white hover:brightness-110',
          ].join(' ')}
          aria-label="Run options"
          title="Run options"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${isRunMenuOpen ? 'rotate-180' : ''}`} />
        </button>

        {isRunMenuOpen && (
          <div className="absolute top-9 right-0 min-w-[280px] max-w-[360px] rounded-lg border border-border-default dark:border-border-default-dark bg-surface-raised dark:bg-surface-dark-raised shadow-lg overflow-hidden z-50">
            <button
              onClick={() => {
                onRunFromLastFailed?.();
                setIsRunMenuOpen(false);
              }}
              disabled={isRunning || !hasResumeOptions || isResumeLoading}
              className="w-full text-left px-3 py-2 text-sm hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay disabled:text-text-muted dark:disabled:text-text-muted-dark disabled:cursor-not-allowed"
            >
              Run from last failed node
            </button>

            <button
              onClick={() => {
                onRunAllFailed?.();
                setIsRunMenuOpen(false);
              }}
              disabled={isRunning || !hasResumeOptions || isResumeLoading}
              className="w-full text-left px-3 py-2 text-sm hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay disabled:text-text-muted dark:disabled:text-text-muted-dark disabled:cursor-not-allowed"
            >
              Run all failed nodes and continue
            </button>

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

            {!isResumeLoading && hasResumeOptions && resumeOptions.map((opt) => (
              <button
                key={opt.nodeId}
                onClick={() => {
                  onRunFromFailedNode?.(opt.nodeId);
                  setIsRunMenuOpen(false);
                }}
                disabled={isRunning}
                className="w-full text-left px-3 py-2 text-sm hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay disabled:text-text-muted dark:disabled:text-text-muted-dark disabled:cursor-not-allowed"
                title={opt.nodeId}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolbarButton({ icon: Icon, label, onClick, tooltip }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-1.5 text-sm font-medium rounded-lg text-text-secondary dark:text-text-secondary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay hover:text-text-primary dark:hover:text-text-primary-dark transition-colors h-8 whitespace-nowrap"
      title={tooltip || label}
      aria-label={label}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}
