import React, { useState, useEffect, useRef } from 'react';
import API_BASE_URL from '../utils/api';
import { CheckCircle, XCircle, RefreshCw, Clock, Circle, History, X, ClipboardList, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Timer, Zap } from 'lucide-react';

const HistoryModal = ({ workflowId, onClose, onSelectRun }) => {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAnimating, setIsAnimating] = useState(false);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrevious: false
  });
  const modalRef = useRef(null);

  useEffect(() => {
    setIsAnimating(true);
    fetchRunHistory(1);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        handleClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const fetchRunHistory = async (page = 1) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/workflows/${workflowId}/runs?page=${page}&limit=10`);
      if (response.ok) {
        const data = await response.json();
        setRuns(data.runs);
        setPagination(data.pagination);
      } else {
        console.error('Failed to fetch run history');
      }
    } catch (error) {
      console.error('Error fetching run history:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage) => {
    fetchRunHistory(newPage);
  };

  const handleClose = () => {
    setIsAnimating(false);
    setTimeout(onClose, 200);
  };

  const handleRunClick = (run) => {
    onSelectRun(run);
    handleClose();
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'failed':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'running':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    }
  };

  const getStatusIcon = (status) => {
    const iconProps = { className: 'w-3 h-3' };
    switch (status) {
      case 'completed':
        return <CheckCircle {...iconProps} />;
      case 'failed':
        return <XCircle {...iconProps} />;
      case 'running':
        return <RefreshCw {...iconProps} className="w-3 h-3 animate-spin" />;
      case 'pending':
        return <Clock {...iconProps} />;
      default:
        return <Circle {...iconProps} />;
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const formatDuration = (duration) => {
    if (!duration) return '—';
    if (duration < 1000) return `${duration}ms`;
    return `${(duration / 1000).toFixed(2)}s`;
  };

  return (
    <div 
      className={`fixed inset-0 z-50 flex items-start justify-end pt-40 pr-4 transition-opacity duration-300 ${
        isAnimating ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)' }}
    >
      {/* Backdrop */}
      <div 
        className="absolute inset-0 cursor-pointer" 
        onClick={handleClose}
      />
      
      {/* Modal Container - Dropdown from History button */}
      <div 
        ref={modalRef}
        className="relative z-10 bg-white dark:bg-gray-800 rounded-3xl overflow-hidden shadow-2xl transition-transform duration-300 flex flex-col"
        style={{ 
          width: '500px',
          maxHeight: '600px',
          transform: isAnimating ? 'translateY(0)' : 'translateY(-20px)',
        }}
      >
        {/* Header */}
        <div className="flex-shrink-0 px-5 py-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-cyan-50 to-blue-50 dark:from-gray-900 dark:to-gray-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-cyan-600 dark:bg-cyan-700 rounded-lg">
                <History className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                  Run History
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {pagination.total} run{pagination.total !== 1 ? 's' : ''} total
                  {pagination.totalPages > 1 && (
                    <>
                      {' • '}Showing {((pagination.page - 1) * pagination.limit) + 1}-{Math.min(pagination.page * pagination.limit, pagination.total)}
                    </>
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors rounded-lg"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-3">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-cyan-600"></div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {pagination.page > 1 ? 'Loading page...' : 'Loading history...'}
                </p>
              </div>
            </div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6">
              <ClipboardList className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">No runs yet</p>
              <p className="text-xs text-gray-500 dark:text-gray-500 text-center">
                Click the Run button to execute this workflow
              </p>
            </div>
          ) : (
            <div className={`divide-y divide-gray-200 dark:divide-gray-700 transition-opacity ${loading ? 'opacity-50' : 'opacity-100'}`}>
              {runs.map((run) => (
                <button
                  key={run.runId}
                  onClick={() => handleRunClick(run)}
                  className="w-full px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Status and Time */}
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded ${getStatusColor(run.status)}`}>
                          <span>{getStatusIcon(run.status)}</span>
                          <span className="uppercase">{run.status}</span>
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {formatDate(run.createdAt)}
                        </span>
                      </div>

                      {/* Run Details */}
                      <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
                        <div className="flex items-center gap-1">
                          <Timer className="w-3.5 h-3.5" />
                          <span>{formatDuration(run.duration)}</span>
                        </div>
                        {run.trigger && (
                          <div className="flex items-center gap-1">
                            <Zap className="w-3.5 h-3.5" />
                            <span className="capitalize">{run.trigger}</span>
                          </div>
                        )}
                      </div>

                      {/* Error message if failed */}
                      {run.status === 'failed' && run.error && (
                        <div className="mt-2 text-xs">
                          {/* Check if this looks like an assertion failure */}
                          {run.error.includes('Assertion failed') ? (
                            <div className="text-red-600 dark:text-red-400">
                              <div className="font-semibold mb-1">
                                {/* Extract the assertion count from error message */}
                                {run.error.includes('/') && run.error.match(/(\d+)\/(\d+)/)?.[0] ? (
                                  `Assertion: ${run.error.match(/(\d+)\/(\d+)/)[0]} failed`
                                ) : (
                                  'Assertion failed'
                                )}
                              </div>
                              {/* Show first line or full error if truncated */}
                              <div className="truncate">{run.error.split('\n')[0]}</div>
                            </div>
                          ) : run.error.includes('branches failed') ? (
                            <div className="text-red-600 dark:text-red-400">
                              <div className="font-semibold">{run.error}</div>
                            </div>
                          ) : (
                            <div className="text-red-600 dark:text-red-400 truncate">
                              Error: {run.error}
                            </div>
                          )}
                        </div>
                      )}
                      {/* Show branch failure count if available */}
                      {run.status === 'failed' && run.failedNodes && run.failedNodes.length > 0 && (
                        <div className="mt-1 text-xs text-orange-600 dark:text-orange-400">
                          {run.failedNodes.length} node{run.failedNodes.length > 1 ? 's' : ''} failed
                        </div>
                      )}
                    </div>

                    {/* Chevron */}
                    <div className="flex-shrink-0 text-gray-400 dark:text-gray-500">
                      <ChevronRight className="w-5 h-5" />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-5 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          {/* Pagination Controls */}
          {!loading && runs.length > 0 && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={!pagination.hasPrevious || loading}
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>
              
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
              </div>

              <button
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={!pagination.hasNext || loading}
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HistoryModal;
