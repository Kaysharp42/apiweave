import { useState } from "react";
import { describe, expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssertionRulesEditor } from "./AssertionRulesEditor";
import type { AssertionItem } from "../../types";

function Harness({ initial, onRules }: { initial: AssertionItem[]; onRules: (rules: AssertionItem[]) => void }) {
  const [rules, setRules] = useState(initial);
  return (
    <AssertionRulesEditor
      rules={rules}
      onChange={(next) => {
        setRules(next);
        onRules(next);
      }}
    />
  );
}

const bodyRule: AssertionItem = { source: "prev", path: "response.body.id", operator: "equals", expectedValue: "" };

describe("AssertionRulesEditor new operators", () => {
  test("offers matches, notMatches, type and matchesSchema", () => {
    render(<Harness initial={[bodyRule]} onRules={() => {}} />);
    for (const operator of ["matches", "notMatches", "type", "matchesSchema"]) {
      expect(screen.getByRole("button", { name: operator })).toBeInTheDocument();
    }
  });

  test("a regex is typed into the expected value, keystroke by keystroke", async () => {
    let latest: AssertionItem[] = [];
    render(<Harness initial={[bodyRule]} onRules={(rules) => (latest = rules)} />);
    fireEvent.click(screen.getByRole("button", { name: "matches" }));
    await userEvent.type(screen.getByPlaceholderText("^ord_\\d+$"), "^ord_");
    expect(latest[0]).toMatchObject({ operator: "matches", expectedValue: "^ord_" });
  });

  test("type picks one of the JSON types", () => {
    let latest: AssertionItem[] = [];
    render(<Harness initial={[bodyRule]} onRules={(rules) => (latest = rules)} />);
    fireEvent.click(screen.getByRole("button", { name: "type" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose a type" }));
    fireEvent.click(screen.getByRole("option", { name: "integer" }));
    expect(latest[0]).toMatchObject({ operator: "type", expectedValue: "integer" });
  });

  test("matchesSchema edits a JSON Schema, and shows one an agent stored as an object", async () => {
    let latest: AssertionItem[] = [];
    const stored = { ...bodyRule, path: "response.body", operator: "matchesSchema", expectedValue: { type: "object" } } as unknown as AssertionItem;
    render(<Harness initial={[stored]} onRules={(rules) => (latest = rules)} />);
    const editor = screen.getByLabelText("JSON Schema");
    expect(editor).toHaveValue('{\n  "type": "object"\n}');
    await userEvent.clear(editor);
    await userEvent.type(editor, '{{"type": "array"}');
    expect(latest[0]).toMatchObject({ operator: "matchesSchema", expectedValue: '{"type": "array"}' });
  });
});
