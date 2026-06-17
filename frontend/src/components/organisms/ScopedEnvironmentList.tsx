import { Pencil, Trash2, ChevronRight } from 'lucide-react';
import { IconButton } from '../atoms/IconButton';
import { EmptyState } from '../molecules/EmptyState';
import { EnvironmentScopeBadge } from '../atoms/EnvironmentScopeBadge';
import type { ScopedEnvironmentListProps } from '../../types';

export function ScopedEnvironmentList({
  environments,
  scopeType,
  title,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
  selectedId,
  className = '',
}: ScopedEnvironmentListProps) {
  const sectionTitle = title ?? `${scopeType.charAt(0).toUpperCase() + scopeType.slice(1)} Environments`;

  if (environments.length === 0) {
    return (
      <div className={className}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">
            {sectionTitle}
          </h3>
          {onCreate && (
            <button
              type="button"
              onClick={onCreate}
              className="text-xs text-primary dark:text-primary-light hover:underline cursor-pointer font-medium"
            >
              + Add
            </button>
          )}
        </div>
        <EmptyState
          title={`No ${scopeType} environments`}
          description={`Create a ${scopeType}-scoped environment to get started.`}
          className="py-6"
        />
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">
          {sectionTitle}
          <span className="ml-2 text-xs font-normal text-text-muted dark:text-text-muted-dark">
            ({environments.length})
          </span>
        </h3>
        {onCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="text-xs text-primary dark:text-primary-light hover:underline cursor-pointer font-medium"
          >
            + Add
          </button>
        )}
      </div>

      <div className="space-y-1">
        {environments.map((env) => {
          const isSelected = env.environmentId === selectedId;

          return (
            <div
              key={env.environmentId}
              className={[
                'group flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors cursor-pointer',
                isSelected
                  ? 'border-[var(--aw-primary)] bg-[var(--aw-primary)]/5 dark:bg-[var(--aw-primary)]/10'
                  : 'border-transparent hover:border-border dark:hover:border-border-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay',
              ].join(' ')}
              onClick={() => onSelect(env)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(env);
                }
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary dark:text-text-primary-dark truncate">
                    {env.name}
                  </span>
                  <EnvironmentScopeBadge scopeType={env.scopeType} isDefault={env.isDefault} size="xs" />
                </div>
                {env.description && (
                  <p className="text-xs text-text-secondary dark:text-text-secondary-dark truncate mt-0.5">
                    {env.description}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                <IconButton
                  tooltip="Edit"
                  size="xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(env);
                  }}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </IconButton>
                <IconButton
                  tooltip="Delete"
                  size="xs"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(env);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </IconButton>
              </div>

              <ChevronRight
                className={`w-4 h-4 flex-shrink-0 transition-colors ${
                  isSelected
                    ? 'text-[var(--aw-primary)]'
                    : 'text-text-muted dark:text-text-muted-dark'
                }`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
