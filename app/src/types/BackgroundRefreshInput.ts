export interface BackgroundRefreshInput {
  /** Hydration version captured before the fetch was issued. */
  readonly hydrationVersionAtRequest: number;
  /** Hydration version now the fetch has resolved. */
  readonly hydrationVersionNow: number;
  /** The tab has unsaved changes. */
  readonly tabIsDirty: boolean;
}
