import {
  filterTemplateSuggestions,
  findTemplateToken,
} from "./templateAutocomplete";
import type { Monaco } from "@monaco-editor/react";
import type { languages } from "monaco-editor";
import type { TemplateSuggestion } from "../types/TemplateSuggestion";

/**
 * The same `{{…}}` completion the plain fields have, inside the JSON body
 * editor.
 *
 * Monaco hangs completion providers off a global language registry rather than
 * off an editor instance, so the provider is registered once and reads the live
 * list through the box below, which the panel refills as the workflow's
 * variables change.
 *
 * ponytail: one box, because one JSON editor is open at a time. If two body
 * editors ever share a screen, key it by model URI.
 */

let suggestions: readonly TemplateSuggestion[] = [];
let registered = false;

export function setTemplateCompletionSuggestions(
  next: readonly TemplateSuggestion[],
): void {
  suggestions = next;
}

/** `$` and `\` start snippet syntax; a variable's name is literal text. */
function escapeSnippet(text: string): string {
  return text.replace(/[\\$]/g, (character) => `\\${character}`);
}

function completionKind(
  monaco: Monaco,
  kind: TemplateSuggestion["kind"],
): languages.CompletionItemKind {
  const kinds = monaco.languages.CompletionItemKind;
  switch (kind) {
    case "function":
      return kinds.Function;
    case "env":
      return kinds.Constant;
    case "secret":
      return kinds.Keyword;
    case "response":
      return kinds.Field;
    default:
      return kinds.Variable;
  }
}

export function registerTemplateCompletion(monaco: Monaco): void {
  if (registered) return;
  registered = true;

  const provider: languages.CompletionItemProvider = {
    // A body's references are typed inside strings, where Monaco offers
    // nothing by itself. These are what open the list.
    triggerCharacters: ["{", "."],
    provideCompletionItems(model, position) {
      const before = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const token = findTemplateToken(before, before.length);
      if (!token) return { suggestions: [] };

      const after = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: model.getLineMaxColumn(position.lineNumber),
      });
      // The braces are part of what gets replaced, and a closing pair already
      // on the line is swallowed rather than doubled — the same rule the
      // plain-field insertion follows.
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: token.start + 1,
        endColumn: position.column + (after.startsWith("}}") ? 2 : 0),
      };

      return {
        // Re-queried on every keystroke rather than filtered by Monaco against
        // a list it already has: the ranking here is not Monaco's, and a
        // workflow with more variables than the result cap would otherwise
        // never show the ones the first keystroke did not reach.
        incomplete: true,
        suggestions: filterTemplateSuggestions(token.query, suggestions).map(
          (suggestion, index) => {
            const caret = suggestion.caretOffset;
            const insertText =
              caret === undefined
                ? `{{${escapeSnippet(suggestion.insert)}}}`
                : `{{${escapeSnippet(suggestion.insert.slice(0, caret))}$0${escapeSnippet(suggestion.insert.slice(caret))}}}`;
            return {
              label: suggestion.insert,
              kind: completionKind(monaco, suggestion.kind),
              ...(suggestion.detail ? { detail: suggestion.detail } : {}),
              insertText,
              ...(caret === undefined
                ? {}
                : {
                    insertTextRules:
                      monaco.languages.CompletionItemInsertTextRule
                        .InsertAsSnippet,
                  }),
              range,
              // Monaco re-filters and re-sorts what a provider returns, against
              // the text in `range` — which starts at the braces. Both fields
              // therefore carry them, or our ranking is thrown away and the
              // looser matches are dropped.
              filterText: `{{${suggestion.insert}}}`,
              sortText: String(index).padStart(3, "0"),
            };
          },
        ),
      };
    },
  };

  monaco.languages.registerCompletionItemProvider("json", provider);
}
