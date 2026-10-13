import { useRef } from "react";
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HTTPRequestConfigPanel } from "./HTTPRequestConfigPanel";
import { ScriptOutcomes } from "./ScriptOutcomes";
import type { NodeModalHTTPRequestConfig } from "../../types";

// Monaco does not run in jsdom: a textarea stands in for it, named by the editor's ariaLabel.
vi.mock("./lazyMonaco", () => ({
  loadMonaco: () => Promise.resolve(),
  MonacoEditor: ({
    value,
    language,
    onChange,
    options,
  }: {
    value: string;
    language: string;
    onChange: (value: string | undefined) => void;
    options: { ariaLabel: string };
  }) => (
    <textarea
      aria-label={options.ariaLabel}
      data-language={language}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

function Harness({
  initialConfig,
  onConfigChange,
}: {
  initialConfig: NodeModalHTTPRequestConfig;
  onConfigChange: (config: NodeModalHTTPRequestConfig) => void;
}) {
  const workingDataRef = useRef<Record<string, unknown>>({});
  return (
    <HTTPRequestConfigPanel
      initialConfig={initialConfig}
      config={initialConfig}
      workingDataRef={workingDataRef}
      activeTab="scripts"
      onConfigChange={onConfigChange}
    />
  );
}

const config: NodeModalHTTPRequestConfig = { url: "https://api.example.com/orders", method: "POST" };

describe("HTTP request scripts tab", () => {
  test("edits both scripts in JavaScript editors, with the aw API listed beside them", () => {
    let latest: NodeModalHTTPRequestConfig | undefined;
    render(<Harness initialConfig={config} onConfigChange={(next) => { latest = next; }} />);

    const pre = screen.getByLabelText("Pre-request script");
    expect(pre).toHaveAttribute("data-language", "javascript");
    fireEvent.change(pre, { target: { value: 'aw.request.headers["X-Sig"] = "1"' } });
    expect(latest?.scripts).toEqual({ preRequest: 'aw.request.headers["X-Sig"] = "1"' });

    fireEvent.change(screen.getByLabelText("Post-response script"), { target: { value: "aw.test('ok', () => {})" } });
    expect(latest?.scripts).toEqual({ preRequest: 'aw.request.headers["X-Sig"] = "1"', postResponse: "aw.test('ok', () => {})" });

    expect(screen.getByText("aw.variables.get(name) / .set(name, value)")).toBeInTheDocument();
    expect(screen.getByText("Sign the request")).toBeInTheDocument();
  });

  test("clamps the time limit and drops scripts once both editors are empty", () => {
    let latest: NodeModalHTTPRequestConfig | undefined;
    render(
      <Harness
        initialConfig={{ ...config, scripts: { postResponse: "console.log(1)" } }}
        onConfigChange={(next) => { latest = next; }}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "99999" } });
    expect(latest?.scripts).toEqual({ postResponse: "console.log(1)", timeoutMs: 30000 });

    fireEvent.change(screen.getByLabelText("Post-response script"), { target: { value: "" } });
    expect(latest?.scripts).toBeUndefined();
  });
});

describe("ScriptOutcomes", () => {
  test("shows each script's error, tests and console output", () => {
    render(
      <ScriptOutcomes
        scripts={[
          { phase: "preRequest", duration: 2, logs: ["signed"], tests: [] },
          {
            phase: "postResponse",
            duration: 3,
            logs: [],
            tests: [
              { name: "is ok", passed: true },
              { name: "has id", passed: false, error: "AssertionError: expected undefined to be defined" },
            ],
            error: "TypeError: boom (line 2, column 1)",
          },
        ]}
      />,
    );
    expect(screen.getByRole("region", { name: "Pre-request script" })).toHaveTextContent("signed");
    const post = screen.getByRole("region", { name: "Post-response script" });
    expect(post).toHaveTextContent("1/2 tests passed");
    expect(post).toHaveTextContent("AssertionError: expected undefined to be defined");
    expect(post).toHaveTextContent("TypeError: boom (line 2, column 1)");
  });
});
