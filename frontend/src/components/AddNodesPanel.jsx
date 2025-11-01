import React, { Fragment, useState, useRef, useEffect } from 'react';
import { MdClose, MdAdd, MdExpandMore, MdExpandLess } from 'react-icons/md';
import { BsGearFill } from 'react-icons/bs';
import { usePalette } from '../contexts/PaletteContext';

const AddNodesPanel = ({ isModalOpen = false, isPanelOpen = false, showVariablesPanel = false, onShowVariablesPanel = () => {} }) => {
  console.log('AddNodesPanel component rendered');
  const [isOpen, setIsOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState({});
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

  const { importedGroups } = usePalette();

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

  const toggleSection = (sectionKey) => {
    setExpandedSections(prev => ({
      ...prev,
      [sectionKey]: !prev[sectionKey]
    }));
  };

  const onDragStart = (event, node) => {
    console.log('Drag started for node:', node);
    event.dataTransfer.setData('application/reactflow', node.type);
    // Also pass the method if it exists (for HTTP request nodes)
    if (node.method) {
      event.dataTransfer.setData('application/reactflow-method', node.method);
    }
    // If this is a full template (from imported groups), pass full JSON template
    if (node.template) {
      try {
        event.dataTransfer.setData('application/reactflow-node-template', JSON.stringify(node.template));
      } catch (e) {
        // ignore
      }
    }
    event.dataTransfer.effectAllowed = 'move';
    console.log('Data set - type:', node.type, 'method:', node.method);
  };

  return (
    <div 
      ref={panelRef}
      className={`fixed bottom-16 right-2 z-[9999] transition-all duration-200 flex flex-col gap-3 ${isModalOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      style={{ 
        transition: 'all 0.2s ease'
      }}
    >
      {/* Add Nodes Toggle Button */}
      <button
        onClick={() => {
          console.log('AddNodesPanel toggle clicked, isOpen:', isOpen);
          setIsOpen(!isOpen);
        }}
        disabled={isModalOpen}
        className="flex items-center justify-center rounded-full border-2 border-cyan-900 bg-cyan-900 text-white hover:bg-cyan-950 focus:outline-none shadow-xl dark:border-cyan-800 dark:bg-cyan-800 dark:hover:bg-cyan-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all w-12 h-12"
        title="Add Nodes"
      >
        {isOpen ? (
          <MdClose className="w-6 h-6" />
        ) : (
          <MdAdd className="w-6 h-6" />
        )}
      </button>

      {/* Show Panel Button (when hidden) */}
      {!showVariablesPanel && (
        <button
          onClick={() => onShowVariablesPanel(true)}
          className="p-3 bg-cyan-500 dark:bg-cyan-600 hover:bg-cyan-600 dark:hover:bg-cyan-700 text-white rounded-full transition-colors shadow-lg hover:shadow-xl w-12 h-12 flex items-center justify-center"
          title="Show Panel (Variables, Functions, Settings)"
          aria-label="Show Panel"
        >
          <BsGearFill className="w-5 h-5" />
        </button>
      )}

      {/* Nodes Panel */}
      {isOpen && (
        <div className="absolute bottom-full mb-2 right-0 w-72 max-h-[60vh] overflow-y-auto transform rounded-lg bg-white dark:bg-gray-800 shadow-2xl border-2 border-cyan-900 dark:border-gray-700 z-[101]">
          <div className="p-3">
            <h3 className="py-1.5 text-sm font-bold text-center border-b-2 border-gray-200 dark:border-gray-700 text-cyan-900 dark:text-cyan-400">
              Add Nodes (Drag to Canvas)
            </h3>

            <div className="mt-2 space-y-0">
              {/* HTTP Requests Section */}
              <div className="border-t border-b dark:border-gray-700">
                <button
                  onClick={() => toggleSection('http-requests')}
                  className="flex justify-between w-full px-4 py-2 text-sm font-medium text-left bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none"
                >
                  <span>HTTP Requests</span>
                  {expandedSections['http-requests'] ? (
                    <MdExpandLess className="w-5 h-5" />
                  ) : (
                    <MdExpandMore className="w-5 h-5" />
                  )}
                </button>
                {expandedSections['http-requests'] && (
                  <div className="px-4 pt-2 pb-4 text-sm border-l border-r dark:border-gray-600 space-y-1">
                    {nodeTemplates.find(cat => cat.category === 'HTTP Requests')?.nodes.map((node, nodeIdx) => (
                      <div
                        key={nodeIdx}
                        draggable
                        onDragStart={(e) => {
                          onDragStart(e, node);
                          setTimeout(() => setIsOpen(false), 100);
                        }}
                        className="py-2 border-b dark:border-gray-600 cursor-move hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                          {node.method && (
                            <span className="inline-block px-1.5 py-0.5 mr-1.5 text-[10px] font-bold text-white bg-blue-600 dark:bg-blue-700 rounded">
                              {node.method}
                            </span>
                          )}
                          {node.label}
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{node.description}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Control Flow Section */}
              <div className="border-b dark:border-gray-700">
                <button
                  onClick={() => toggleSection('control-flow')}
                  className="flex justify-between w-full px-4 py-2 text-sm font-medium text-left bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none"
                >
                  <span>Control Flow</span>
                  {expandedSections['control-flow'] ? (
                    <MdExpandLess className="w-5 h-5" />
                  ) : (
                    <MdExpandMore className="w-5 h-5" />
                  )}
                </button>
                {expandedSections['control-flow'] && (
                  <div className="px-4 pt-2 pb-4 text-sm border-l border-r dark:border-gray-600 space-y-1">
                    {nodeTemplates.find(cat => cat.category === 'Control Flow')?.nodes.map((node, nodeIdx) => (
                      <div
                        key={nodeIdx}
                        draggable
                        onDragStart={(e) => {
                          onDragStart(e, node);
                          setTimeout(() => setIsOpen(false), 100);
                        }}
                        className="py-2 border-b dark:border-gray-600 cursor-move hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">{node.label}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{node.description}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Validation Section */}
              <div className="border-b dark:border-gray-700">
                <button
                  onClick={() => toggleSection('validation')}
                  className="flex justify-between w-full px-4 py-2 text-sm font-medium text-left bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none"
                >
                  <span>Validation</span>
                  {expandedSections['validation'] ? (
                    <MdExpandLess className="w-5 h-5" />
                  ) : (
                    <MdExpandMore className="w-5 h-5" />
                  )}
                </button>
                {expandedSections['validation'] && (
                  <div className="px-4 pt-2 pb-4 text-sm border-l border-r dark:border-gray-600 space-y-1">
                    {nodeTemplates.find(cat => cat.category === 'Validation')?.nodes.map((node, nodeIdx) => (
                      <div
                        key={nodeIdx}
                        draggable
                        onDragStart={(e) => {
                          onDragStart(e, node);
                          setTimeout(() => setIsOpen(false), 100);
                        }}
                        className="py-2 border-b dark:border-gray-600 cursor-move hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">{node.label}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{node.description}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Imported Groups */}
              {importedGroups.length > 0 && importedGroups.map((group, gIdx) => {
                const sectionKey = `imported-${group.id}`;
                const isExpanded = expandedSections[sectionKey];
                return (
                  <div key={`grp-${group.id}-${gIdx}`} className="border-b dark:border-gray-700">
                    <button
                      onClick={() => toggleSection(sectionKey)}
                      className="flex justify-between w-full px-4 py-2 text-sm font-medium text-left bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none"
                    >
                      <span>{group.title}</span>
                      {isExpanded ? (
                        <MdExpandLess className="w-5 h-5" />
                      ) : (
                        <MdExpandMore className="w-5 h-5" />
                      )}
                    </button>
                    {isExpanded && (
                      <div className="px-4 pt-2 pb-4 text-sm border-l border-r dark:border-gray-600 space-y-1 max-h-60 overflow-y-auto">
                        {(group.items || []).map((item, iIdx) => (
                          <div
                            key={`grp-item-${iIdx}`}
                            draggable
                            onDragStart={(e) => {
                              // Handle workflow nodes differently
                              if (item.method === 'WORKFLOW' && item.workflowId) {
                                onDragStart(e, {
                                  type: 'workflow',
                                  label: item.label || 'Workflow',
                                  workflowId: item.workflowId,
                                  template: {
                                    type: 'workflow',
                                    label: item.label || 'Workflow',
                                    config: {
                                      workflowId: item.workflowId,
                                      workflowName: item.label,
                                    }
                                  }
                                });
                              } else {
                                // Handle regular HTTP request nodes
                                onDragStart(e, {
                                  type: 'http-request',
                                  label: item.label || item.url || 'Request',
                                  method: item.method,
                                  template: {
                                    type: 'http-request',
                                    label: item.label || item.url || 'Request',
                                    config: {
                                      method: item.method || 'GET',
                                      url: item.url || '',
                                      queryParams: item.queryParams || '',
                                      pathVariables: item.pathVariables || '',
                                      headers: item.headers || '',
                                      cookies: item.cookies || '',
                                      body: item.body || '',
                                      timeout: item.timeout || 30,
                                    }
                                  }
                                });
                              }
                              setTimeout(() => setIsOpen(false), 100);
                            }}
                            className="py-2 border-b dark:border-gray-600 cursor-move hover:bg-gray-50 dark:hover:bg-gray-800"
                          >
                            <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                              {item.method === 'WORKFLOW' ? (
                                <span className="inline-block px-1.5 py-0.5 mr-1.5 text-[10px] font-bold text-white bg-purple-600 dark:bg-purple-700 rounded">
                                  WF
                                </span>
                              ) : (
                                item.method && (
                                  <span className="inline-block px-1.5 py-0.5 mr-1.5 text-[10px] font-bold text-white bg-blue-600 dark:bg-blue-700 rounded">
                                    {item.method}
                                  </span>
                                )
                              )}
                              {item.label || item.url || 'Request'}
                            </div>
                            {item.method === 'WORKFLOW' ? (
                              <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 truncate">Sub-workflow</div>
                            ) : (
                              <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 truncate">{item.url || ''}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AddNodesPanel;
