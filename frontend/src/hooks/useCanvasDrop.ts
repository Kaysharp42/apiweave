import { useCallback } from 'react';
import type { Node, XYPosition } from 'reactflow';

interface NodeConfig {
  method?: string;
  url?: string;
  queryParams?: string;
  pathVariables?: string;
  headers?: string;
  cookies?: string;
  body?: string;
  timeout?: number;
  assertions?: unknown[];
  duration?: number;
  mergeStrategy?: string;
  conditions?: unknown[];
}

function getDefaultConfig(type: string): NodeConfig {
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

interface UseCanvasDropParams {
  reactFlowInstanceRef: React.MutableRefObject<{ screenToFlowPosition: (coords: { x: number; y: number }) => XYPosition } | null> | null;
  setNodes: (updater: (nds: Node[]) => Node[]) => void;
}

interface UseCanvasDropResult {
  onDrop: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
}

export default function useCanvasDrop({ reactFlowInstanceRef, setNodes }: UseCanvasDropParams): UseCanvasDropResult {
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      const method = event.dataTransfer.getData('application/reactflow-method');
      const templateJson = event.dataTransfer.getData('application/reactflow-node-template');

      if (!type) {
        return;
      }
      const instance = reactFlowInstanceRef?.current;
      if (!instance) {
        return;
      }

      const position = instance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      let config = getDefaultConfig(type);
      let labelFromTemplate: string | null = null;
      if (templateJson) {
        try {
          const parsed = JSON.parse(templateJson) as { type?: string; config?: NodeConfig; label?: string };
          if (parsed && parsed.type === type && parsed.config) {
            config = { ...config, ...parsed.config };
            if (parsed.label) labelFromTemplate = parsed.label;
          }
        } catch {
          // ignore bad template
        }
      }

      if (method && type === 'http-request') {
        config.method = method;
      }

      const newNode: Node = {
        id: `${type}-${Date.now()}`,
        type,
        position,
        data: {
          label:
            labelFromTemplate ??
            type
              .replace('-', ' ')
              .replace(/\b\w/g, (l) => l.toUpperCase()),
          config,
        },
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [reactFlowInstanceRef, setNodes],
  );

  return { onDrop, onDragOver };
}
