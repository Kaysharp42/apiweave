/**
 * The scene contract.
 *
 * A scene owns one product state and every output composed from it. Each output
 * declares its destination size, not a source resolution: `cssWidth` is half the
 * destination width because the runner captures at `deviceScaleFactor: 2`, so
 * the crop lands at 1:1 and is never upscaled.
 *
 * `subjects` are the elements the crop must contain. `safeCrop` grows their
 * union to the destination aspect and throws if the subject cannot fit, so a
 * clipped node fails the capture instead of shipping.
 */

import type { Page } from "@playwright/test";
import type { CaptureBridgeOptions } from "./harness";

export type Placement =
  | "hero"
  | "demo"
  | "feature"
  | "step"
  | "gallery"
  | "mobile"
  | "og";

export type StillOutput = {
  readonly id: string;
  readonly placement: Placement;
  /** Destination pixels. Width must be even for the AVIF/WebP encoders. */
  readonly width: number;
  readonly height: number;
  /** Named claim this image proves — copied into the shipped manifest. */
  readonly claim: string;
  readonly alt: string;
  readonly caption: string;
  /** Selectors the crop must fully contain. */
  readonly subjects: readonly string[];
  /**
   * Per-output camera, applied just before the crop: re-fit the graph, then
   * step ReactFlow's own zoom control. This is the plan's "each output gets its
   * own camera" — one prepared product state, several framings.
   */
  readonly camera?: { readonly fit?: boolean; readonly zoom?: number };
  /**
   * Last-moment state change for this output only — expanding the subject node,
   * opening a tab. Runs after the camera and after every earlier output in the
   * scene, so a wide frame is never taken through a panel opened for a close
   * one.
   */
  readonly before?: (page: Page) => Promise<void>;
  readonly pad?: number;
  /**
   * Extra destination widths derived by downscaling this same composition —
   * responsive variants, never a different crop. A genuinely different framing
   * (every mobile crop, for instance) is its own output.
   */
  readonly alsoAt?: readonly number[];
  /** Byte ceiling for the encoded WebP. */
  readonly byteBudget: number;
};

export type Scene = {
  readonly id: string;
  /** Product state: what the renderer is given before anything is framed. */
  readonly bridge: CaptureBridgeOptions;
  /** Viewport in CSS pixels. Wider viewport → fit-view frames the graph larger. */
  readonly viewport?: { readonly width: number; readonly height: number };
  /** Puts the product into the state the outputs are composed from. */
  readonly prepare: (page: Page) => Promise<void>;
  readonly stills: readonly StillOutput[];
  /** Strings that must be present in the prepared page. */
  readonly requiredStrings: readonly string[];
};

/** ReactFlow stamps `data-id` on every node wrapper. */
export function node(nodeId: string): string {
  return `.react-flow__node[data-id="${nodeId}"]`;
}
