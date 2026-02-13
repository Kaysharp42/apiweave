import React from 'react';
import { Save, History, Play, Code, Upload, Loader2, RefreshCw } from 'lucide-react';
import ButtonSelect from '../ButtonSelect';

/**
 * CanvasToolbar — floating horizontal toolbar for the workflow canvas.
 *
 * Renders centered-top over the canvas with design-token styling.
 * Actions: Save, History, JSON, Import | Environment selector | Run.
 */
export default function CanvasToolbar({
  onSave,
  onHistory,
  onJsonEditor,
  onImport,
  onRun,
  isRunning = false,
  environments = [],
  selectedEnvironment,
  onEnvironmentChange,
  onRefreshSwagger,
  isSwaggerRefreshing = false,
  workflowId,
}) {
  return (
    <div
      className="absolute top-3 left-1/2 -translate-x-1/2 z-50 pointer-events-auto flex items-center gap-1.5 px-2 py-1.5 rounded-xl bg-surface-raised/95 dark:bg-surface-dark-raised/95 backdrop-blur-sm border border-border-default dark:border-border-default-dark shadow-lg"
      role="toolbar"
      aria-label="Workflow actions"
    >
      {/* Action group */}
      <div className="flex items-center">
        <ToolbarButton icon={Save} label="Save" onClick={onSave} tooltip="Save workflow (Ctrl+S)" />
        <ToolbarButton icon={History} label="History" onClick={onHistory} tooltip="Run history" />
        <ToolbarButton icon={Code} label="JSON" onClick={onJsonEditor} tooltip="JSON editor (Ctrl+J)" />
        <ToolbarButton icon={Upload} label="Import" onClick={onImport} tooltip="Import nodes" />
      </div>

      {/* Separator */}
      <div className="w-px h-6 bg-border-default dark:bg-border-default-dark mx-0.5" aria-hidden="true" />

      {/* Environment selector */}
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

      {/* Separator */}
      <div className="w-px h-6 bg-border-default dark:bg-border-default-dark mx-0.5" aria-hidden="true" />

      {/* Run button */}
      <button
        onClick={onRun}
        disabled={isRunning}
        className={[
          'flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors h-8 whitespace-nowrap',
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
    </div>
  );
}

/** Small toolbar button with icon and optional label */
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
