import { FileText } from 'lucide-react';
import { ResponseInspector } from '../molecules/ResponseInspector';
import { formatNodeOutputDuration, getNodeOutputStatusClass } from '../../utils/nodeOutputStatus';
import { createInspectorResponse, createInspectorMetadata, getRawBody, getNumberValue } from './nodeModalUtils';
import type { HttpRequestOutputPanelProps } from '../../types/HttpRequestOutputPanelProps';

export function HttpRequestOutputPanel({ node, initialConfig, output }: HttpRequestOutputPanelProps) {
  const response = output ? createInspectorResponse(output) : null;
  const metadata = output ? createInspectorMetadata(output, response) : undefined;
  const rawBody = output ? getRawBody(output) : undefined;
  const statusCode = response?.status;
  const statusColor = getNodeOutputStatusClass(statusCode);
  const durationLabel = formatNodeOutputDuration(metadata?.responseTimeMs ?? getNumberValue(output ?? undefined, 'duration'));

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface dark:bg-surface-dark">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border bg-surface-overlay px-5 py-3 dark:border-border-dark dark:bg-surface-dark-overlay">
        <h3 className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wide text-text-primary dark:text-text-primary-dark">
          <FileText className="w-4 h-4 text-text-muted dark:text-text-muted-dark" />
          Response Output
        </h3>
        {node.type === 'http-request' && statusCode && (
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold ${statusColor}`}>
              {statusCode}
            </span>
            {durationLabel && (
              <span className="rounded-full border border-status-info/30 bg-status-info/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-status-info dark:border-[var(--aw-status-info)]/30 dark:bg-[var(--aw-status-info)]/10 dark:text-[var(--aw-status-info)]">
                {durationLabel}
              </span>
            )}
          </div>
        )}
      </div>

      {!output && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
            <FileText className="w-16 h-16 mx-auto mb-4 text-text-muted dark:text-text-muted-dark/70" />
            <p className="text-sm text-text-muted dark:text-text-muted-dark mb-2">
              Execute this node to view data
            </p>
          </div>
        </div>
      )}

      {output && node.type === 'http-request' && (
        <>
          <div className="flex-shrink-0 border-b border-border bg-surface-raised px-5 py-3 dark:border-border-dark dark:bg-surface-dark-raised">
            <div className="flex items-center gap-3 text-xs">
              <span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary dark:border-primary-light/30 dark:bg-primary-light/10 dark:text-primary-light">
                {initialConfig.method || 'GET'}
              </span>
              <span className="text-text-primary dark:text-text-primary-dark truncate font-mono text-xs opacity-90 min-w-0">
                {initialConfig.url || '\u2014'}
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden bg-surface p-4 dark:bg-surface-dark">
            <ResponseInspector
              response={response}
              {...(metadata ? { metadata } : {})}
              {...(rawBody !== undefined ? { rawBody } : {})}
            />
          </div>
        </>
      )}
    </div>
  );
}
