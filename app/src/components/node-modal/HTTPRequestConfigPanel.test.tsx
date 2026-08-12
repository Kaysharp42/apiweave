import { useRef } from "react";
import { describe, expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HTTPRequestConfigPanel } from "./HTTPRequestConfigPanel";
import type { NodeModalHTTPRequestConfig } from "../../types";

const config: NodeModalHTTPRequestConfig = {
  url: "https://api.example.com/dogs",
  method: "GET",
  extractors: { dogId: "response.body.id" },
};

function Harness({
  lastResult,
  initialConfig = config,
  onConfigChange,
}: {
  lastResult?: Record<string, unknown> | null;
  initialConfig?: NodeModalHTTPRequestConfig;
  onConfigChange?: (config: NodeModalHTTPRequestConfig) => void;
}) {
  const workingDataRef = useRef<Record<string, unknown>>({});
  return (
    <HTTPRequestConfigPanel
      initialConfig={initialConfig}
      config={initialConfig}
      workingDataRef={workingDataRef}
      activeTab="settings"
      {...(lastResult !== undefined ? { lastResult } : {})}
      {...(onConfigChange ? { onConfigChange } : {})}
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

describe("HTTPRequestConfigPanel expected status", () => {
  test("shows a blank field by default", () => {
    render(<Harness />);
    expect(screen.getByPlaceholderText("e.g. 409 or 409, 422")).toHaveValue("");
  });

  test("pre-fills an existing expectedStatus value", () => {
    render(<Harness initialConfig={{ ...config, expectedStatus: 409 }} />);
    expect(screen.getByPlaceholderText("e.g. 409 or 409, 422")).toHaveValue("409");
  });

  test("typing a valid single status code updates the config", () => {
    let latest: NodeModalHTTPRequestConfig | undefined;
    render(<Harness onConfigChange={(next) => { latest = next; }} />);
    fireEvent.change(screen.getByPlaceholderText("e.g. 409 or 409, 422"), {
      target: { value: "409" },
    });
    expect(latest?.expectedStatus).toBe(409);
    expect(screen.queryByText(/between 100 and 599/)).not.toBeInTheDocument();
  });

  test("typing a comma-separated list updates the config with an array", () => {
    let latest: NodeModalHTTPRequestConfig | undefined;
    render(<Harness onConfigChange={(next) => { latest = next; }} />);
    fireEvent.change(screen.getByPlaceholderText("e.g. 409 or 409, 422"), {
      target: { value: "409, 422" },
    });
    expect(latest?.expectedStatus).toEqual([409, 422]);
  });

  test("an out-of-range code shows an error and leaves the config unchanged", () => {
    let calls = 0;
    render(<Harness onConfigChange={() => { calls += 1; }} />);
    fireEvent.change(screen.getByPlaceholderText("e.g. 409 or 409, 422"), {
      target: { value: "42" },
    });
    expect(screen.getByText(/between 100 and 599/)).toBeInTheDocument();
    expect(calls).toBe(0);
  });

  test("clearing the field drops expectedStatus from the config", () => {
    let latest: NodeModalHTTPRequestConfig | undefined;
    render(
      <Harness
        initialConfig={{ ...config, expectedStatus: 409 }}
        onConfigChange={(next) => { latest = next; }}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("e.g. 409 or 409, 422"), {
      target: { value: "" },
    });
    expect(latest?.expectedStatus).toBeUndefined();
  });
});
