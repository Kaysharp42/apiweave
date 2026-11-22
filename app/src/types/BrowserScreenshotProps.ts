export interface BrowserScreenshotProps {
  /** The workspace the run belongs to: artifacts are read through it. */
  workspaceId: string;
  /** `BrowserStepResult.screenshotArtifactId`. */
  artifactId: string;
  /**
   * Clicking the screenshot opens it full size in a dialog. Off where the
   * screenshot is itself a control, such as on the canvas node.
   */
  expandable?: boolean;
  className?: string;
}
