import React from 'react';
import { Handle, Position } from 'reactflow';
import { MdMergeType, MdCheckCircle, MdCheckBox, MdFilterAlt, MdWarning, MdSchedule, MdContentCopy, MdControlPointDuplicate } from 'react-icons/md';
import { HiMiniArrowRight, HiMiniSparkles } from 'react-icons/hi2';

/**
 * MergeNode - Merges multiple parallel branches
 * Strategies: 
 * - all: Wait for all incoming branches
 * - any: Continue when any branch completes
 * - first: Continue with first completed branch
 * - conditional: Merge only branches matching conditions
 */
const MergeNode = ({ id, data, selected }) => {
  const { label, config = {}, executionStatus, executionResult } = data;
  const mergeStrategy = config.mergeStrategy || 'all';
  
  // Use executionStatus for status, fallback to deprecated 'status' for backward compatibility
  const status = executionStatus || data.status || 'idle';
  const result = executionResult || data.result; // executionResult is the correct property
  
  // Debug: Log result to see what we're getting
  if (result) {
    console.log('MergeNode result:', result);
  }

  // Status-based styling
  const getStatusColor = () => {
    switch (status) {
      case 'running':
        return 'border-yellow-400 dark:border-yellow-500';
      case 'success':
        return 'border-green-500 dark:border-green-400';
      case 'error':
        return 'border-red-500 dark:border-red-400';
      case 'warning':
        return 'border-orange-500 dark:border-orange-400';
      default:
        return 'border-gray-300 dark:border-gray-600';
    }
  };

  const getStatusBadge = () => {
    if (status === 'idle') return null;
    
    const badges = {
      running: { text: 'Running', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' },
      success: { text: 'Success', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
      error: { text: 'Error', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
      warning: { text: 'Warning', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200' },
    };

    const badge = badges[status];
    if (!badge) return null;

    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded ${badge.color}`}>
        {badge.text}
      </span>
    );
  };

  const handleStrategyChange = (e) => {
    // MergeNode config is updated through NodeModal only
    // Prevent inline changes - user should double-click to open modal
    e.preventDefault();
    console.log('To change merge strategy, double-click the node to open configuration modal');
  };

  return (
    <div
      className={`px-4 py-3 shadow-md rounded-md bg-white dark:bg-gray-800 border-2 ${
        selected ? 'border-cyan-400 dark:border-cyan-500' : getStatusColor()
      } min-w-[200px] transition-all ${
        status === 'running' ? 'animate-pulse' : ''
      }`}
    >
      {/* Multiple input handles for merging branches */}
      <Handle 
        type="target" 
        position={Position.Left} 
        className="w-3 h-3 !bg-purple-500 dark:!bg-purple-400" 
      />

      <div className="flex flex-col gap-2">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MdMergeType className="text-lg w-5 h-5" />
            <div className="font-bold text-gray-700 dark:text-gray-200 text-sm">
              {label || 'Merge'}
            </div>
            {/* Incoming branch count badge */}
            {data.incomingBranchCount > 1 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200 font-semibold" title={`Merging ${data.incomingBranchCount} branches`}>
                ⬅ {data.incomingBranchCount}x
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(
                  new CustomEvent('duplicateNode', { detail: { nodeId: id } })
                );
              }}
              className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 nodrag focus:outline-none focus:ring-0 active:bg-transparent select-none bg-transparent hover:bg-transparent"
              style={{ background: 'transparent', border: 'none', padding: 0, boxShadow: 'none', outline: 'none', WebkitTapHighlightColor: 'transparent' }}
              title="Duplicate node"
            >
              <MdControlPointDuplicate className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(
                  new CustomEvent('copyNode', { detail: { nodeId: id } })
                );
              }}
              className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 nodrag focus:outline-none focus:ring-0 active:bg-transparent select-none bg-transparent hover:bg-transparent"
              style={{ background: 'transparent', border: 'none', padding: 0, boxShadow: 'none', outline: 'none', WebkitTapHighlightColor: 'transparent' }}
              title="Copy node"
            >
              <MdContentCopy className="w-4 h-4" />
            </button>
            {getStatusBadge()}
          </div>
        </div>

        {/* Strategy Configuration (Display Only - Edit in Modal) */}
        <div className="text-xs text-gray-600 dark:text-gray-400">
          <label className="block mb-1 font-medium">Merge Strategy:</label>
          <select
            value={mergeStrategy}
            onChange={handleStrategyChange}
            disabled
            title="Double-click node to change strategy"
            className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 cursor-not-allowed"
          >
            <option value="all">Wait for All (AND)</option>
            <option value="any">Wait for Any (OR)</option>
            <option value="first">First Completes</option>
            <option value="conditional">Conditional Merge</option>
          </select>
          <p className="text-[9px] text-gray-400 dark:text-gray-500 mt-1 italic">
            💡 Double-click node to configure
          </p>
        </div>

        {/* Strategy Description */}
        <div className="text-xs text-gray-500 dark:text-gray-500 italic flex items-center gap-2">
          {mergeStrategy === 'all' && (
            <>
              <MdSchedule className="w-4 h-4 flex-shrink-0" />
              <span>Waits for all branches</span>
            </>
          )}
          {mergeStrategy === 'any' && (
            <>
              <HiMiniSparkles className="w-4 h-4 flex-shrink-0" />
              <span>Continues when any branch completes</span>
            </>
          )}
          {mergeStrategy === 'first' && (
            <>
              <HiMiniArrowRight className="w-4 h-4 flex-shrink-0" />
              <span>Uses first completed branch</span>
            </>
          )}
          {mergeStrategy === 'conditional' && (
            <>
              <MdFilterAlt className="w-4 h-4 flex-shrink-0" />
              <span>Merges branches matching conditions</span>
            </>
          )}
        </div>

        {/* Result Info */}
        {result && (
          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 p-2 bg-gray-50 dark:bg-gray-900 rounded">
            <div className="font-medium mb-1 flex items-center gap-2">
              <MdCheckCircle className="w-4 h-4 text-green-600" />
              <span>{result.mergeStrategy === 'conditional' ? 'Conditions Passed:' : 'Merged Branches:'}</span>
            </div>
            {result.branchCount !== undefined && (
              <div className="flex items-center gap-2">
                <MdCheckBox className="w-4 h-4 text-blue-600" />
                <span>{result.branchCount} branch(es) {result.mergeStrategy === 'conditional' ? 'passed' : 'merged'}</span>
              </div>
            )}
            
            {/* Warning for ANY/FIRST strategies */}
            {result.warning && (
              <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded">
                <div className="text-[10px] text-yellow-800 dark:text-yellow-200 flex items-center gap-1">
                  <MdWarning className="w-3 h-3 flex-shrink-0" />
                  <span className="font-semibold">Strategy Warning:</span>
                </div>
                <div className="text-[9px] text-yellow-700 dark:text-yellow-300 mt-1">
                  {result.warning}
                </div>
              </div>
            )}
            
            {/* Branch Reference Helper - shows which prev[index] maps to which node */}
            {result.branches && result.branches.length > 0 && (
              <div className="mt-2 space-y-1">
                <div className="text-[10px] font-semibold text-purple-600 dark:text-purple-400">
                  Branch → Variable Mapping:
                </div>
                {result.branches.map((branch) => (
                  <div key={branch.index} className="text-[10px] bg-white dark:bg-gray-800 p-1.5 rounded border border-gray-200 dark:border-gray-700">
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      Branch {branch.index}
                    </span>
                    <span className="text-gray-500 dark:text-gray-500 mx-1">→</span>
                    <code className="text-purple-600 dark:text-purple-400 font-mono">
                      prev[{branch.index}]
                    </code>
                    <span className="text-gray-500 dark:text-gray-500 mx-1">→</span>
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {branch.nodeId}
                    </span>
                    {branch.statusCode && branch.statusCode !== 'N/A' && (
                      <span className="ml-1 text-gray-500">
                        ({branch.statusCode})
                      </span>
                    )}
                  </div>
                ))}
                <div className="text-[9px] text-gray-500 dark:text-gray-500 italic mt-1">
                  Example: <code className="text-purple-600 dark:text-purple-400">{'{{prev[0].response.body.id}}'}</code>
                </div>
              </div>
            )}
            
            {result.mergedAt && (
              <div className="text-gray-500 dark:text-gray-500 text-[10px] mt-2">
                {new Date(result.mergedAt).toLocaleTimeString()}
              </div>
            )}
          </div>
        )}
        
        {/* Branch Reference Guide - Always show for user guidance (even before execution) */}
        {data.incomingBranchCount > 1 && !result && (
          <div className="text-xs bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded p-2 mt-2">
            <div className="font-semibold text-purple-700 dark:text-purple-300 mb-1 text-[10px] flex items-center gap-1">
              <MdMergeType className="w-3 h-3" />
              <span>Branch → Variable Mapping:</span>
            </div>
            
            {/* Show incoming branches if available */}
            {data.incomingBranches && data.incomingBranches.length > 0 ? (
              <div className="space-y-1">
                {data.incomingBranches.map((branch) => (
                  <div key={branch.index} className="text-[10px] bg-white dark:bg-gray-800 p-1.5 rounded border border-gray-200 dark:border-gray-700">
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {branch.edgeLabel || `Branch ${branch.index}`}
                    </span>
                    <span className="text-gray-500 dark:text-gray-500 mx-1">→</span>
                    <code className="text-purple-600 dark:text-purple-400 font-mono">
                      prev[{branch.index}]
                    </code>
                    <span className="text-gray-500 dark:text-gray-500 mx-1">→</span>
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {branch.label}
                    </span>
                  </div>
                ))}
                <div className="text-[9px] text-gray-500 dark:text-gray-500 italic mt-1">
                  Example: <code className="text-purple-600 dark:text-purple-400">{'{{prev[0].response.body.id}}'}</code>
                </div>
              </div>
            ) : (
              // Fallback if incoming branches not available
              <div className="text-[9px] text-gray-600 dark:text-gray-400 space-y-0.5">
                <div>This node merges {data.incomingBranchCount} branches</div>
                <div className="text-gray-500 dark:text-gray-500 italic mt-1">
                  • Branch labels show: <code className="bg-purple-100 dark:bg-purple-900/50 px-1">Branch 0</code>, <code className="bg-purple-100 dark:bg-purple-900/50 px-1">Branch 1</code>, etc.
                </div>
                <div className="text-gray-500 dark:text-gray-500 italic">
                  • To use them: <code className="text-purple-600 dark:text-purple-400">{'{{prev[0]}}'}</code>, <code className="text-purple-600 dark:text-purple-400">{'{{prev[1]}}'}</code>, etc.
                </div>
                <div className="text-gray-500 dark:text-gray-500 italic mt-1">
                  After execution, you'll see which Branch number corresponds to which source node.
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Output handle */}
      <Handle 
        type="source" 
        position={Position.Right} 
        className="w-3 h-3 !bg-purple-500 dark:!bg-purple-400" 
      />
    </div>
  );
};

export default MergeNode;
