import type { NodeModalNodeType } from '../../types/NodeModalNodeType';
import { getNodeIcon } from './nodeModalUtils';
import { Button } from '../atoms/Button';
import { X } from 'lucide-react';
import type { ChangeEvent } from 'react';

interface NodeModalHeaderProps {
  nodeType: NodeModalNodeType;
  nodeLabel: string;
  onLabelChange: (newLabel: string) => void;
  onClose: () => void;
}

export function NodeModalHeader({ nodeType, nodeLabel, onLabelChange, onClose }: NodeModalHeaderProps) {
  const Icon = getNodeIcon(nodeType);
  const typeName = nodeType === 'http-request' ? 'HTTP Request'
    : nodeType === 'assertion' ? 'Assertion'
    : nodeType === 'delay' ? 'Delay'
    : nodeType === 'merge' ? 'Merge'
    : nodeType === 'start' ? 'Start'
    : 'End';

  return (
    <div className="mb-4 flex items-start justify-between">
      <div className="flex flex-col gap-2 w-full pr-4">
        <div className="flex items-center gap-2 text-xs font-medium text-text-muted dark:text-text-muted-dark uppercase tracking-widest">
          <Icon className="w-6 h-6" />
          <span>{typeName}</span>
        </div>
        <label htmlFor="node-modal-name" className="text-xs font-medium text-text-muted dark:text-text-muted-dark">Node Name</label>
        <input
          id="node-modal-name"
          type="text"
          defaultValue={nodeLabel || ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onLabelChange(e.target.value)}
          className="text-lg font-semibold border-transparent bg-transparent hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay focus:bg-surface-overlay dark:focus:bg-surface-dark-overlay px-2 py-1 focus:ring-0 shadow-none -ml-2 w-full transition-colors rounded-md outline-none focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
          placeholder="Enter node name"
        />
      </div>
      <Button
        onClick={onClose}
        variant="ghost"
        size="sm"
        className="!p-1.5 !min-w-0 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
        title="Close"
      >
        <X className="w-5 h-5" />
      </Button>
    </div>
  );
}