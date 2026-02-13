import React from 'react';
import { GitMerge, CheckCircle, SquareCheckBig, Filter, AlertTriangle, Clock, ArrowRight, Sparkles } from 'lucide-react';
import BaseNode from '../atoms/flow/BaseNode';

/* Reusable branch-mapping list */
const BranchMapping = ({ branches }) => (
  <div className="mt-1 space-y-1">
    {branches.map((b) => (
      <div key={b.index} className="text-[10px] bg-surface dark:bg-surface-dark-raised p-1.5 rounded border border-border dark:border-border-dark">
        <span className="font-medium text-text-primary dark:text-text-primary-dark">
          {b.edgeLabel || b.label || `Branch ${b.index}`}
        </span>
        <span className="text-text-muted dark:text-text-muted-dark mx-1">{'\u2192'}</span>
        <code className="text-purple-600 dark:text-purple-400 font-mono">prev[{b.index}]</code>
        {b.nodeId && (
          <>
            <span className="text-text-muted dark:text-text-muted-dark mx-1">{'\u2192'}</span>
            <span className="font-medium text-text-primary dark:text-text-primary-dark">{b.nodeId}</span>
          </>
        )}
        {b.statusCode && b.statusCode !== 'N/A' && (
          <span className="ml-1 text-text-muted dark:text-text-muted-dark">({b.statusCode})</span>
        )}
      </div>
    ))}
    <div className="text-[9px] text-text-muted dark:text-text-muted-dark italic mt-1">
      Example: <code className="text-purple-600 dark:text-purple-400">{'{{prev[0].response.body.id}}'}</code>
    </div>
  </div>
);


const MergeNode = ({ id, data, selected }) => {
  const { label, config = {}, executionStatus, executionResult } = data;
  const mergeStrategy = config.mergeStrategy || 'all';
  const status = executionStatus || data.status || 'idle';
  const result = executionResult || data.result;

  const strategyMeta = {
    all:         { icon: <Clock className="w-3.5 h-3.5 flex-shrink-0" />, desc: 'Waits for all branches' },
    any:         { icon: <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />, desc: 'Continues when any completes' },
    first:       { icon: <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" />, desc: 'Uses first completed branch' },
    conditional: { icon: <Filter className="w-3.5 h-3.5 flex-shrink-0" />, desc: 'Merges matching conditions' },
  };

  const { icon: stratIcon, desc: stratDesc } = strategyMeta[mergeStrategy] || strategyMeta.all;

  return (
    <BaseNode
      title={label || 'Merge'}
      icon={<GitMerge className="w-4 h-4 text-purple-600 dark:text-purple-400" />}
      status={status}
      selected={selected}
      nodeId={id}
      handleLeft={{ type: 'target', className: '!bg-purple-500 dark:!bg-purple-400 !w-2.5 !h-2.5' }}
      handleRight={{ type: 'source', className: '!bg-purple-500 dark:!bg-purple-400 !w-2.5 !h-2.5' }}
      collapsible={true}
      defaultExpanded={false}
      headerBg="bg-purple-50 dark:bg-purple-900/60"
      headerTextClass="text-purple-800 dark:text-purple-200"
      statusBadgeText={status !== 'idle' ? status.charAt(0).toUpperCase() + status.slice(1) : ''}
      titleExtra={
        data.incomingBranchCount > 1 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-200 dark:bg-purple-800 text-purple-700 dark:text-purple-200 font-semibold" title={`Merging ${data.incomingBranchCount} branches`}>
            ⬅ {data.incomingBranchCount}x
          </span>
        )
      }
      className={`min-w-[200px] ${status === 'running' ? 'animate-pulse' : ''}`}
    >
      {({ isExpanded }) => (
        <div className="p-2 space-y-2">
          {/* Strategy summary — always visible */}
          <div className="flex items-center gap-1.5 text-[10px] text-text-secondary dark:text-text-secondary-dark italic">
            {stratIcon}
            <span>{stratDesc}</span>
          </div>

          {isExpanded && (
            <div className="space-y-2">
              {/* Strategy selector (disabled — edit in modal) */}
              <div className="text-xs">
                <label className="block mb-0.5 font-medium text-text-secondary dark:text-text-secondary-dark text-[10px]">
                  Merge Strategy:
                </label>
                <select
                  value={mergeStrategy}
                  disabled
                  title="Double-click node to change strategy"
                  className="w-full px-1.5 py-0.5 text-xs border border-border dark:border-border-dark rounded
                    bg-surface dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark
                    cursor-not-allowed opacity-75"
                >
                  <option value="all">Wait for All (AND)</option>
                  <option value="any">Wait for Any (OR)</option>
                  <option value="first">First Completes</option>
                  <option value="conditional">Conditional Merge</option>
                </select>
                <p className="text-[9px] text-text-muted dark:text-text-muted-dark mt-0.5 italic">
                  💡 Double-click node to configure
                </p>
              </div>

              {/* Result Info */}
              {result && (
                <div className="text-xs text-text-secondary dark:text-text-secondary-dark p-2
                  bg-surface dark:bg-surface-dark-raised rounded border border-border dark:border-border-dark">
                  <div className="font-medium mb-1 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                    <span>{result.mergeStrategy === 'conditional' ? 'Conditions Passed:' : 'Merged Branches:'}</span>
                  </div>
                  {result.branchCount !== undefined && (
                    <div className="flex items-center gap-2">
                      <SquareCheckBig className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <span>{result.branchCount} branch(es) {result.mergeStrategy === 'conditional' ? 'passed' : 'merged'}</span>
                    </div>
                  )}

                  {/* Strategy warning */}
                  {result.warning && (
                    <div className="mt-2 p-1.5 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded">
                      <div className="text-[10px] text-yellow-800 dark:text-yellow-200 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                        <span className="font-semibold">Strategy Warning:</span>
                      </div>
                      <div className="text-[9px] text-yellow-700 dark:text-yellow-300 mt-0.5">
                        {result.warning}
                      </div>
                    </div>
                  )}

                  {/* Branch mapping */}
                  {result.branches && result.branches.length > 0 && (
                    <BranchMapping branches={result.branches} />
                  )}

                  {result.mergedAt && (
                    <div className="text-text-muted dark:text-text-muted-dark text-[10px] mt-2">
                      {new Date(result.mergedAt).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              )}

              {/* Pre-execution branch guide */}
              {data.incomingBranchCount > 1 && !result && (
                <div className="text-xs bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded p-2">
                  <div className="font-semibold text-purple-700 dark:text-purple-300 mb-1 text-[10px] flex items-center gap-1">
                    <GitMerge className="w-3 h-3" />
                    <span>Branch → Variable Mapping:</span>
                  </div>
                  {data.incomingBranches?.length > 0 ? (
                    <BranchMapping branches={data.incomingBranches} />
                  ) : (
                    <div className="text-[9px] text-text-secondary dark:text-text-secondary-dark space-y-0.5">
                      <div>This node merges {data.incomingBranchCount} branches</div>
                      <div className="text-text-muted dark:text-text-muted-dark italic mt-1">
                        Use <code className="text-purple-600 dark:text-purple-400">{'{{prev[0]}}'}</code>, <code className="text-purple-600 dark:text-purple-400">{'{{prev[1]}}'}</code>, etc.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </BaseNode>
  );
};

export default MergeNode;
