export interface CanvasInteractionProps {
  selectionOnDrag: boolean;
  panOnDrag: boolean | number[];
  panOnScroll: boolean;
  zoomOnScroll: boolean;
  zoomOnPinch: boolean;
  snapToGrid: boolean;
  snapGrid: [number, number];
}
