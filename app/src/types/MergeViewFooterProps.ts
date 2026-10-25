/** The merge view's footer: abandon, move between what is left, and finish. */
export interface MergeViewFooterProps {
  readonly busy: boolean;
  readonly resolved: number;
  readonly total: number;
  readonly canFinish: boolean;
  readonly onAbandon: () => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onFinish: () => void;
}
