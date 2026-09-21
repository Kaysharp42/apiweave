import type { TemplateEdit } from "../types/TemplateEdit";
import type { TemplateSuggestion } from "../types/TemplateSuggestion";
import type { TemplateToken } from "../types/TemplateToken";

/**
 * The `{{…}}` autocomplete, as three pure functions: what the caret is inside,
 * what matches it, and what the field says once a match is accepted.
 *
 * All of it is text in / text out so the behaviour is testable without a DOM —
 * the React hook around it only owns focus, the caret and the popover.
 */

/**
 * The longest run after `{{` still treated as a live reference. Past this the
 * user is writing prose that happens to contain braces, and a popover that
 * keeps following them is in the way.
 */
const MAX_QUERY_LENGTH = 64;

/** Most entries the list will render — more than fits on screen at once. */
const MAX_RESULTS = 40;

/**
 * The reference the caret is inside, or null.
 *
 * A brace or a newline between the `{{` and the caret means the caret is past
 * a reference rather than inside one — which is what keeps the popover shut
 * for `{{variables.a}} and |` while keeping it open for `{{variables.a|}}`,
 * where the user is editing an existing reference.
 */
export function findTemplateToken(
  text: string,
  caret: number,
): TemplateToken | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const start = before.lastIndexOf("{{");
  if (start === -1) return null;

  const query = before.slice(start + 2);
  if (query.length > MAX_QUERY_LENGTH) return null;
  if (/[{}\n]/.test(query)) return null;

  return { start, query };
}

/**
 * Suggestions that match `query`, best first.
 *
 * Three tiers: prefix, then substring, then subsequence. The subsequence tier
 * is what makes a near miss still land — a user typing `{{variable.` (no `s`)
 * is offered `variables.token`, and one typing `{{token` is offered it too.
 * Within a tier the caller's own order stands, so an empty query shows
 * workflow variables before the function catalogue.
 */
export function filterTemplateSuggestions(
  query: string,
  suggestions: readonly TemplateSuggestion[],
): readonly TemplateSuggestion[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return suggestions.slice(0, MAX_RESULTS);

  return suggestions
    .map((suggestion, order) => ({
      suggestion,
      order,
      rank: rankSuggestion(suggestion.insert.toLowerCase(), needle),
    }))
    .filter((entry) => entry.rank >= 0)
    .sort((left, right) => left.rank - right.rank || left.order - right.order)
    .slice(0, MAX_RESULTS)
    .map((entry) => entry.suggestion);
}

function rankSuggestion(haystack: string, needle: string): number {
  if (haystack.startsWith(needle)) return 0;
  if (haystack.includes(needle)) return 1;
  return isSubsequence(needle, haystack) ? 2 : -1;
}

/** `needle`'s characters appear in `haystack`, in order, gaps allowed. */
function isSubsequence(needle: string, haystack: string): boolean {
  let matched = 0;
  for (const character of haystack) {
    if (character === needle[matched]) matched += 1;
    if (matched === needle.length) return true;
  }
  return false;
}

/**
 * The field's text and caret after `suggestion` is accepted.
 *
 * A reference the user already closed is completed in place rather than
 * doubled: the `}}` immediately after the caret is consumed, so accepting
 * inside `{{var|}}` leaves one pair of braces, not two.
 */
export function applyTemplateSuggestion(
  text: string,
  caret: number,
  token: TemplateToken,
  suggestion: TemplateSuggestion,
): TemplateEdit {
  const after = text.slice(caret);
  const tail = after.startsWith("}}") ? after.slice(2) : after;
  const head = `${text.slice(0, token.start)}{{${suggestion.insert}}}`;

  return {
    text: head + tail,
    caret:
      suggestion.caretOffset === undefined
        ? head.length
        : token.start + 2 + suggestion.caretOffset,
  };
}
