import type { MergeBodyNoticeProps } from "../../types";

/** What the merge view says instead of its panes: reading, or nothing left to ask. */
export function MergeBodyNotice({ text }: MergeBodyNoticeProps) {
  return (
    <div className="flex flex-1 items-center justify-center px-5 text-sm text-text-secondary dark:text-text-secondary-dark">
      {text}
    </div>
  );
}
