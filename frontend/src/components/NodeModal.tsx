import { useRef } from 'react';
import { Modal } from './molecules/Modal';
import { HTTPRequestConfigPanel, HttpRequestOutputPanel, NodeOutputPanel, AssertionConfigPanel, DelayConfigPanel, MergeConfigPanel } from './node-modal';
import { NodeModalHeader } from './node-modal/NodeModalHeader';
import { NodeModalFooter } from './node-modal/NodeModalFooter';
import type { NodeModalProps } from '../types/NodeModalProps';
import type { NodeModalNodeType } from '../types/NodeModalNodeType';
import type { NodeModalHTTPRequestConfig } from '../types/NodeModalHTTPRequestConfig';
import type { NodeModalMergeConfig } from '../types/NodeModalMergeConfig';

const NO_CONFIG_TYPES: NodeModalNodeType[] = ['start', 'end'];

export function NodeModal({ open, node, onClose, onSave }: NodeModalProps) {
  const workingDataRef = useRef<Record<string, unknown>>({ ...node.data });
  const nameLabelRef = useRef<HTMLInputElement | null>(null);

  const handleClose = () => {
    onClose();
  };

  const handleSave = () => {
    onSave({ ...node, data: workingDataRef.current as unknown as typeof node.data });
    handleClose();
  };

  const handleLabelChange = (newLabel: string) => {
    workingDataRef.current = { ...workingDataRef.current, label: newLabel };
  };

  return (
    <Modal
      isOpen={open}
      onClose={handleClose}
      title=""
      size="fullscreen"
      scrollable={false}
      showClose={false}
      initialFocus={nameLabelRef}
      className="!max-w-[1800px] !rounded-2xl !shadow-[var(--aw-shadow-modal)]"
    >
      <div className="flex h-full w-full flex-col xl:flex-row backdrop-blur-md">
        <div className="flex h-full min-h-0 flex-col xl:basis-[56%] xl:min-w-0 border-r border-border/40 dark:border-border-dark/40 bg-surface-raised/60 dark:bg-surface-dark-raised/60">
          <div className="flex h-full min-h-0 flex-col p-4 sm:p-5">
            <NodeModalHeader
              nodeType={node.type}
              nodeLabel={node.data.label || ''}
              onLabelChange={handleLabelChange}
              onClose={handleClose}
            />

            <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/50 dark:border-border-dark/50 bg-surface dark:bg-surface-dark shadow-inner">
              <div className="h-full overflow-y-auto p-4">
                {node.type === 'http-request' && (
                  <HTTPRequestConfigPanel
                    initialConfig={(node.data.config || {}) as NodeModalHTTPRequestConfig}
                    workingDataRef={workingDataRef}
                  />
                )}
                {node.type === 'assertion' && (
                  <AssertionConfigPanel
                    initialConfig={(node.data.config || {}) as { assertions?: Array<{ source: string; path: string; operator: string; expectedValue: string }> }}
                    workingDataRef={workingDataRef}
                  />
                )}
                {node.type === 'delay' && (
                  <DelayConfigPanel
                    initialConfig={(node.data.config || {}) as { duration?: number }}
                    workingDataRef={workingDataRef}
                  />
                )}
                {node.type === 'merge' && (
                  <MergeConfigPanel
                    initialConfig={(node.data.config || {}) as unknown as NodeModalMergeConfig}
                    workingDataRef={workingDataRef}
                  />
                )}
                {NO_CONFIG_TYPES.includes(node.type) && (
                  <div className="p-4">
                    <p className="text-sm text-text-muted dark:text-text-muted-dark">
                      No configuration needed for {node.type} nodes.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <NodeModalFooter onCancel={handleClose} onSave={handleSave} />
          </div>
        </div>

        <div className="flex h-full min-h-0 flex-col xl:basis-[44%] xl:min-w-0 bg-surface/50 dark:bg-surface-dark/50">
          <div className="flex h-full min-h-0 flex-col">
            {node.type === 'http-request' ? (
              <HttpRequestOutputPanel
                node={node}
                initialConfig={(node.data.config || {}) as NodeModalHTTPRequestConfig}
                output={(node.data?.executionResult as Record<string, unknown> | null) || null}
              />
            ) : (
              <NodeOutputPanel
                output={(node.data?.executionResult as Record<string, unknown> | null) || null}
              />
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default NodeModal;