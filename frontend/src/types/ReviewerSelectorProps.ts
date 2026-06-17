export interface ReviewerSelectorProps {
  /** Currently selected reviewer IDs (user IDs or team IDs). */
  value: string[];
  /** Called when selection changes. */
  onChange: (ids: string[]) => void;
  /** Available reviewers to choose from. */
  options: ReviewerOption[];
  /** Label for the selector. */
  label?: string;
  /** Disable the selector. */
  disabled?: boolean;
  className?: string;
}

export interface ReviewerOption {
  id: string;
  name: string;
  type: 'user' | 'team';
  avatarUrl?: string;
}
