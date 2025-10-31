import React, { Fragment, useState, useRef, useEffect } from 'react';
import { MdClose, MdAdd } from 'react-icons/md';

const AddNodesPanel = ({ isModalOpen = false, isPanelOpen = false }) => {
  console.log('AddNodesPanel component rendered');
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef(null);

  // Close panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (panelRef.current && !panelRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const nodeTemplates = [
    {
      category: 'HTTP Requests',
      nodes: [
        { type: 'http-request', label: 'GET Request', description: 'Make a GET request', method: 'GET' },
        { type: 'http-request', label: 'POST Request', description: 'Make a POST request', method: 'POST' },
        { type: 'http-request', label: 'PUT Request', description: 'Make a PUT request', method: 'PUT' },
        { type: 'http-request', label: 'DELETE Request', description: 'Make a DELETE request', method: 'DELETE' },
        { type: 'http-request', label: 'PATCH Request', description: 'Make a PATCH request', method: 'PATCH' },
      ],
    },
    {
      category: 'Control Flow',
      nodes: [
        { type: 'delay', label: 'Delay', description: 'Add a delay before next step' },
        { type: 'merge', label: 'Merge', description: 'Merge parallel branches' },
        { type: 'end', label: 'End', description: 'Mark the end of workflow' },
      ],
    },
    {
      category: 'Validation',
      nodes: [
        { type: 'assertion', label: 'Assertion', description: 'Assert on conditional expressions' },
      ],
    },
  ];

  const onDragStart = (event, node) => {
    console.log('Drag started for node:', node);
    event.dataTransfer.setData('application/reactflow', node.type);
    // Also pass the method if it exists (for HTTP request nodes)
    if (node.method) {
      event.dataTransfer.setData('application/reactflow-method', node.method);
    }
    event.dataTransfer.effectAllowed = 'move';
    console.log('Data set - type:', node.type, 'method:', node.method);
  };

  return (
    <div 
      ref={panelRef}
      className={`fixed bottom-24 z-[9999] transition-all duration-200 ${isModalOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      style={{ 
        position: 'fixed', 
        bottom: '96px', 
        right: isPanelOpen ? 'calc(100% - calc(100vw - 300px) + 16px)' : '16px', 
        zIndex: 9999,
        transition: 'all 0.2s ease'
      }}
    >
      {/* Toggle Button */}
      <button
        onClick={() => {
          console.log('AddNodesPanel toggle clicked, isOpen:', isOpen);
          setIsOpen(!isOpen);
        }}
        disabled={isModalOpen}
        className="flex items-center justify-center rounded-full border-2 border-cyan-900 bg-cyan-900 text-white hover:bg-cyan-950 focus:outline-none shadow-xl dark:border-cyan-800 dark:bg-cyan-800 dark:hover:bg-cyan-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        title="Add Nodes"
        style={{ 
          width: '48px',
          height: '48px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {isOpen ? (
          <MdClose className="w-6 h-6" />
        ) : (
          <MdAdd className="w-6 h-6" />
        )}
      </button>

      {/* Nodes Panel */}
      {isOpen && (
        <div className="absolute bottom-full mb-2 right-0 w-72 max-h-[60vh] overflow-y-auto transform rounded-lg bg-white dark:bg-gray-800 shadow-2xl border-2 border-cyan-900 dark:border-gray-700 z-[101]">
          <div className="p-3">
            <h3 className="py-1.5 text-sm font-bold text-center border-b-2 border-gray-200 dark:border-gray-700 text-cyan-900 dark:text-cyan-400">
              Add Nodes (Drag to Canvas)
            </h3>

            <div className="mt-2 space-y-2">
              {nodeTemplates.map((category, idx) => (
                <div key={idx} className="border-b dark:border-gray-700 pb-2 last:border-b-0">
                  <h4 className="font-semibold text-xs text-gray-700 dark:text-gray-300 mb-1.5 px-1">
                    {category.category}
                  </h4>
                  <div className="space-y-1">
                    {category.nodes.map((node, nodeIdx) => (
                      <div
                        key={nodeIdx}
                        draggable
                        onDragStart={(e) => {
                          onDragStart(e, node);
                          // Auto-close panel when dragging starts
                          setTimeout(() => setIsOpen(false), 100);
                        }}
                        className="p-2 border border-gray-200 dark:border-gray-600 rounded cursor-move hover:border-cyan-600 dark:hover:border-cyan-500 hover:bg-cyan-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        <div className="font-semibold text-xs text-cyan-900 dark:text-cyan-400">
                          {node.method && (
                            <span className="inline-block px-1.5 py-0.5 mr-1.5 text-[10px] font-bold text-white bg-blue-600 dark:bg-blue-700 rounded">
                              {node.method}
                            </span>
                          )}
                          {node.label}
                        </div>
                        <div className="text-[10px] text-gray-600 dark:text-gray-400 mt-0.5">{node.description}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AddNodesPanel;
