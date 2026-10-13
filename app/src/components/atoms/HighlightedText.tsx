import type { HighlightedTextProps } from "../../types";

/** `text` with every case-insensitive occurrence of `query` wrapped in `<mark>`. */
export function HighlightedText({ text, query }: HighlightedTextProps) {
  const needle = query.trim().toLowerCase();
  if (!needle) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const haystack = text.toLowerCase();
  let from = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark
        key={at}
        className="rounded-sm bg-primary/20 text-inherit dark:bg-primary-light/25"
      >
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}
