import { useCallback } from 'react';

/**
 * Default node configuration by type.
 */
function getDefaultConfig(type) {
  switch (type) {
    case 'http-request':
      return {
        method: 'GET',
        url: '',
        queryParams: '',
        pathVariables: '',
        headers: '',
        cookies: '',
        body: '',
        timeout: 30,
      };
    case 'assertion':
      return { assertions: [] };
    case 'delay':
      return { duration: 1000 };
    case 'merge':
      return { mergeStrategy: 'all', conditions: [] };
    default:
      return {};
  }
}

/**
 * useCanvasDrop — drag-and-drop handler for the ReactFlow canvas.
 *
 * Extracted from WorkflowCanvas to reduce complexity.
 *
 * @param {Object} params
 * @param {Object|null} params.reactFlowInstance
 * @param {Function}    params.setNodes
 * @returns {{ onDrop: Function, onDragOver: Function }}
 */
export default function useCanvasDrop({ reactFlowInstance, setNodes }) {
  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      const method = event.dataTransfer.getData('application/reactflow-method');
      const templateJson = event.dataTransfer.getData('application/reactflow-node-template');

      if (!type) {
        console.error('No type data in drop event');
        return;
      }
      if (!reactFlowInstance) {
        console.error('ReactFlow instance not initialized');
        return;
      }

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      let config = getDefaultConfig(type);
      let labelFromTemplate = null;
      if (templateJson) {
        try {
          const parsed = JSON.parse(templateJson);
          if (parsed && parsed.type === type && parsed.config) {
            config = { ...config, ...parsed.config };
            if (parsed.label) labelFromTemplate = parsed.label;
          }
        } catch {
          // ignore bad template
        }
      }

      // Override method if provided (for HTTP request nodes)
      if (method && type === 'http-request') {
        config.method = method;
      }

      const newNode = {
        id: `${type}-${Date.now()}`,
        type,
        position,
        data: {
          label:
            labelFromTemplate ||
            type
              .replace('-', ' ')
              .replace(/\b\w/g, (l) => l.toUpperCase()),
          config,
        },
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [reactFlowInstance, setNodes],
  );

  return { onDrop, onDragOver };
}
