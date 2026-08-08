export interface TabItem {
  key: string;
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  label: string;
  /** Count pill shown after the label, e.g. how many extractors a tab holds. */
  badge?: number;
}
