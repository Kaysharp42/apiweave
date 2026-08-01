/**
 * One line of node copy, split into an emphasised operation and a muted
 * argument: `POST` + `api.shop.dev/auth/login`, `200` + `OK`, `2 passed`.
 *
 * The split is supplied by the caller rather than inferred from the string,
 * because no rule holds across the vocabulary — `200 OK` splits after the
 * status code, `checking 2 assertions` does not split at all, and a URL
 * containing a space would break any whitespace heuristic.
 */
export interface NodeRunLine {
  /** Emphasised leading text, in `--aw-text-primary`. */
  operation: string;
  /** Muted remainder, in `--aw-text-secondary`. Omit for a single-part line. */
  argument?: string;
}
