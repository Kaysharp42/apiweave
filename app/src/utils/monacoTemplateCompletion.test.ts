import { describe, expect, it } from "vitest";
import {
  registerTemplateCompletion,
  setTemplateCompletionSuggestions,
} from "./monacoTemplateCompletion";
import type { Monaco } from "@monaco-editor/react";

/**
 * The provider is exercised against a stand-in Monaco: registering it for real
 * would drag the whole editor into a unit test, and everything worth checking
 * here is the arithmetic between a caret and a replacement range.
 */

interface Range {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

interface Completion {
  label: string;
  insertText: string;
  range: Range;
  insertTextRules?: number;
}

type Provider = {
  provideCompletionItems(
    model: unknown,
    position: unknown,
  ): { suggestions: Completion[] };
};

let provider: Provider | null = null;

const fakeMonaco = {
  languages: {
    CompletionItemKind: {
      Function: 1,
      Constant: 2,
      Keyword: 3,
      Field: 4,
      Variable: 5,
    },
    CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    registerCompletionItemProvider: (_language: string, next: Provider) => {
      provider = next;
    },
  },
} as unknown as Monaco;

registerTemplateCompletion(fakeMonaco);

setTemplateCompletionSuggestions([
  { insert: "variables.orderId", kind: "variable", detail: "42" },
  { insert: "secrets.API_KEY", kind: "secret" },
  { insert: "randomString()", kind: "function", caretOffset: 13 },
]);

/** One line, the caret at `|`. */
function complete(lineWithCaret: string): Completion[] {
  const column = lineWithCaret.indexOf("|") + 1;
  const line = lineWithCaret.replace("|", "");
  const model = {
    getValueInRange: (range: Range) =>
      line.slice(range.startColumn - 1, range.endColumn - 1),
    getLineMaxColumn: () => line.length + 1,
  };
  return provider!.provideCompletionItems(model, { lineNumber: 1, column })
    .suggestions;
}

describe("monaco template completion", () => {
  it("offers nothing in ordinary JSON", () => {
    expect(complete('  "name": "BMW Paris|"')).toEqual([]);
  });

  it("offers matches once a reference is open", () => {
    const labels = complete('  "order": "{{order|"').map((item) => item.label);
    expect(labels).toEqual(["variables.orderId"]);
  });

  it("replaces the braces along with the query", () => {
    const [item] = complete('  "order": "{{order|"');
    // `{{` starts at index 12, so column 13; the caret is at column 20.
    expect(item!.range).toMatchObject({ startColumn: 13, endColumn: 20 });
    expect(item!.insertText).toBe("{{variables.orderId}}");
  });

  it("swallows a closing pair it is editing inside of", () => {
    const [item] = complete('  "order": "{{order|}}"');
    expect(item!.range.endColumn).toBe(22);
  });

  it("puts the caret inside a function's parens", () => {
    const [item] = complete('"x": "{{randomStr|"');
    expect(item!.insertText).toBe("{{randomString($0)}}");
    expect(item!.insertTextRules).toBe(4);
  });
});
