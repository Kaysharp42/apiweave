import { useRef } from "react";
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { HTTPRequestConfigPanel } from "./HTTPRequestConfigPanel";
import type { NodeModalHTTPRequestConfig } from "../../types";

const config: NodeModalHTTPRequestConfig = {
  url: "https://api.example.com/dogs",
  method: "GET",
  extractors: { dogId: "response.body.id" },
};

function Harness({
  lastResult,
}: {
  lastResult?: Record<string, unknown> | null;
}) {
  const workingDataRef = useRef<Record<string, unknown>>({});
  return (
    <HTTPRequestConfigPanel
      initialConfig={config}
      config={config}
      workingDataRef={workingDataRef}
      activeTab="settings"
      {...(lastResult !== undefined ? { lastResult } : {})}
    />
  );
}

describe("HTTPRequestConfigPanel extractor rows", () => {
  // NodeModal casts node.data?.executionResult blindly, so lastResult can be
  // any shape at runtime even though the prop type promises an object.
  test("does not throw when lastResult is not an object", () => {
    expect(() =>
      render(<Harness lastResult={"not-an-object" as unknown as null} />),
    ).not.toThrow();
    expect(screen.getByText("dogId")).toBeInTheDocument();
  });

  test("still resolves a preview when lastResult is a real result object", () => {
    render(
      <Harness lastResult={{ response: { body: { id: "abc123" } } }} />,
    );
    expect(screen.getByText(/Last response:/)).toBeInTheDocument();
  });
});
