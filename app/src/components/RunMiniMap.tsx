import { useEffect, useRef } from "react";
import { zoom, type D3ZoomEvent } from "d3-zoom";
import { select } from "d3-selection";
import { Panel, useStore, useStoreApi, type Node } from "@xyflow/react";
import type { RunMiniMapProps } from "../types/RunMiniMapProps";
import type { MinimapTransformView } from "../types/MinimapTransformView";
import {
  legibleNodeRect,
  minimapBoundingRect,
  minimapTransformView,
  sameTransformView,
} from "../utils/minimapView";

/**
 * The minimap, forked from ReactFlow's `MiniMap` with one difference: it reads
 * the graph from the canvas's node state and can be frozen while the run camera
 * moves.
 *
 * Why it is not the stock component: the stock one computes its whole picture —
 * bounds over every node, viewport rectangle, viewBox — from the store, so each
 * of the camera's sixty viewport writes a second re-runs that computation and
 * repaints it. While the camera is moving nobody is reading the minimap, so the
 * right cost is zero: `frozen` swaps the live transform for a snapshot taken
 * when the motion began, the selector's answer stops changing, and the
 * component does not render again until the camera comes to rest. The node
 * layer is a plain prop for the same reason — it repaints when the graph
 * changes, not when the viewport does.
 *
 * Everything else — the scaled layout, the mask, wheel-zoom and drag-pan — is
 * the stock component's behaviour, because those parts were not broken. The
 * freeze itself lives in `utils/minimapView`, where a selector can be tested
 * without a canvas.
 */

const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 150;
const OFFSET_SCALE = 5;
const ZOOM_STEP = 10;
const NODE_RADIUS = 5;
const DEFAULT_NODE_COLOR = "var(--aw-text-muted)";
const DEFAULT_MASK_COLOR = "color-mix(in srgb, var(--aw-surface) 60%, transparent)";

/** d3 reports delta in lines or pages as well as pixels; normalise to pixels. */
function wheelDeltaPx(event: WheelEvent): number {
  const multiplier = event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002;
  return event.deltaY * multiplier;
}

/** A colour knob is either one colour or one per node; the renderer only wants
 * the second form. */
function colorFn<TData extends Record<string, unknown>>(
  colour: string | ((node: Node<TData>) => string) | undefined,
  fallback: string,
): (node: Node<TData>) => string {
  if (typeof colour === "function") return colour;
  const fixed = colour ?? fallback;
  return () => fixed;
}

/** Chrome draws the node rects faster with crisp edges, and at this scale the
 * difference is invisible; everything else looks better without it. */
function shapeRenderingFor(): "crispEdges" | "geometricPrecision" {
  const chromium = typeof window === "undefined" || "chrome" in window;
  return chromium ? "crispEdges" : "geometricPrecision";
}

export function RunMiniMap<TData extends Record<string, unknown>>({
  nodes,
  frozen,
  paint = {},
  position = "bottom-right",
  style,
  zoomable = false,
  pannable = false,
}: RunMiniMapProps<TData>) {
  const store = useStoreApi();
  const svg = useRef<SVGSVGElement | null>(null);
  const snapshotRef = useRef<MinimapTransformView | null>(null);
  const viewScaleRef = useRef(0);

  const view = useStore(
    (state) => minimapTransformView(state, frozen, snapshotRef.current),
    sameTransformView,
  );
  const { transform, width, height } = view;

  // Captured when a burst of motion begins: what was on screen the moment the
  // minimap stopped having to care. Only refreshed while unfrozen, which is
  // exactly when the camera is not writing viewports.
  useEffect(() => {
    if (frozen) {
      const state = store.getState();
      snapshotRef.current = {
        transform: state.transform,
        width: state.width,
        height: state.height,
      };
    }
  }, [frozen, store]);

  // One rect per node, index-aligned with `nodes`, so the colour functions get
  // their node back without a lookup.
  const entries = nodes.map((node) => {
    return {
      node,
      rect: {
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        width: node.measured?.width ?? node.width ?? 0,
        height: node.measured?.height ?? node.height ?? 0,
        selected: node.selected ?? false,
      },
    };
  });
  const rects = entries.map((entry) => entry.rect);

  const viewBB = {
    x: -transform[0] / transform[2],
    y: -transform[1] / transform[2],
    width: width / transform[2],
    height: height / transform[2],
  };
  const boundingRect = minimapBoundingRect(rects, viewBB);

  const elementWidth = Number(style?.width) || DEFAULT_WIDTH;
  const elementHeight = Number(style?.height) || DEFAULT_HEIGHT;
  const scaledWidth = boundingRect.width / elementWidth;
  const scaledHeight = boundingRect.height / elementHeight;
  const viewScale = Math.max(scaledWidth, scaledHeight);
  const viewWidth = viewScale * elementWidth;
  const viewHeight = viewScale * elementHeight;
  const offset = OFFSET_SCALE * viewScale;
  const x = boundingRect.x - (viewWidth - boundingRect.width) / 2 - offset;
  const y = boundingRect.y - (viewHeight - boundingRect.height) / 2 - offset;
  const viewBoxWidth = viewWidth + offset * 2;
  const viewBoxHeight = viewHeight + offset * 2;
  viewScaleRef.current = viewScale;

  // The user's gestures on the minimap move the canvas, frozen or not: they go
  // through the store's own d3 zoom, so the run camera hears them as the hand
  // on the canvas they are and hands over. Copied from the stock component.
  useEffect(() => {
    if (!svg.current) return;

    const selection = select(svg.current);
    const zoomHandler = (
      event: D3ZoomEvent<SVGSVGElement, unknown>,
    ): void => {
      const state = store.getState();
      if ((event.sourceEvent as WheelEvent).type !== "wheel" || !state.panZoom) {
        return;
      }
      const pinchDelta = -wheelDeltaPx(event.sourceEvent as WheelEvent) * ZOOM_STEP;
      const nextZoom = state.transform[2] * Math.pow(2, pinchDelta);
      void state.panZoom.scaleTo(nextZoom);
    };
    const panHandler = (event: D3ZoomEvent<SVGSVGElement, unknown>): void => {
      const state = store.getState();
      if ((event.sourceEvent as MouseEvent).type !== "mousemove" || !state.panZoom) {
        return;
      }
      const sourceEvent = event.sourceEvent as MouseEvent;
      const moveScale = viewScaleRef.current * Math.max(1, state.transform[2]);
      const extent: [[number, number], [number, number]] = [
        [0, 0],
        [state.width, state.height],
      ];
      void state.panZoom.setViewportConstrained(
        {
          x: state.transform[0] - sourceEvent.movementX * moveScale,
          y: state.transform[1] - sourceEvent.movementY * moveScale,
          zoom: state.transform[2],
        },
        extent,
        state.translateExtent,
      );
    };

    const zoomAndPan = zoom<SVGSVGElement, unknown>();
    if (pannable) zoomAndPan.on("zoom", panHandler);
    if (zoomable) zoomAndPan.on("zoom.wheel", zoomHandler);
    selection.call(zoomAndPan);

    return () => {
      selection.on("zoom", null);
    };
  }, [pannable, zoomable, store]);

  const nodeColorFn = colorFn(paint.nodeColor, DEFAULT_NODE_COLOR);
  const nodeStrokeColorFn = colorFn(paint.nodeStrokeColor, "transparent");
  const shapeRendering = shapeRenderingFor();

  return (
    <Panel
      position={position}
      style={style}
      className="react-flow__minimap"
      data-testid="rf__minimap"
    >
      <svg
        width={elementWidth}
        height={elementHeight}
        viewBox={`${x} ${y} ${viewBoxWidth} ${viewBoxHeight}`}
        role="img"
        aria-label="Mini map"
        ref={svg}
      >
        {entries.map(({ node, rect }) => {
          // Drawn at a floor of a few pixels, because a graph long enough sets
          // a scale that would otherwise render every node sub-pixel — see
          // `legibleNodeRect`. The stroke is in the same world units as the
          // rect, so it needs the scale applied to be the pixel width asked
          // for rather than a fraction of one.
          const drawn = legibleNodeRect(rect, viewScale);
          return (
            <rect
              key={rect.id}
              className={`react-flow__minimap-node${rect.selected ? " selected" : ""}`}
              x={drawn.x}
              y={drawn.y}
              rx={NODE_RADIUS}
              ry={NODE_RADIUS}
              width={drawn.width}
              height={drawn.height}
              fill={nodeColorFn(node)}
              stroke={nodeStrokeColorFn(node)}
              strokeWidth={(paint.nodeStrokeWidth ?? 2) * viewScale}
              shapeRendering={shapeRendering}
            />
          );
        })}
        <path
          className="react-flow__minimap-mask"
          d={`M${x - offset},${y - offset}h${viewBoxWidth + offset * 2}v${viewBoxHeight + offset * 2}h${-(viewBoxWidth + offset * 2)}z
M${viewBB.x},${viewBB.y}h${viewBB.width}v${viewBB.height}h${-viewBB.width}z`}
          fill={paint.maskColor ?? DEFAULT_MASK_COLOR}
          fillRule="evenodd"
          stroke="none"
          strokeWidth={1}
          pointerEvents="none"
        />
      </svg>
    </Panel>
  );
}
