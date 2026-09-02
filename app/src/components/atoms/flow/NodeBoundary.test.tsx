import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { withNodeBoundary } from "./NodeBoundary";

/** A node that throws on its first render and succeeds after that, so one
 * component covers both the catch and the retry. */
function makeFlakyNode() {
  let throwOnRender = true;
  const Node = ({ id }: { id: string }) => {
    if (throwOnRender) throw new Error("bad config");
    return <div>rendered {id}</div>;
  };
  return { Node, heal: () => (throwOnRender = false) };
}

describe("withNodeBoundary", () => {
  // React logs the caught error itself; the boundary's own log line is the
  // thing under test, not console noise.
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeAll(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterAll(() => consoleError.mockRestore());

  it("draws the failure in place of the node instead of rethrowing", () => {
    const { Node } = makeFlakyNode();
    const Wrapped = withNodeBoundary(Node, "http-request");

    expect(() => render(<Wrapped id="n1" />)).not.toThrow();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "http-request failed to render",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("bad config");
  });

  it("re-renders the node when retried", async () => {
    const { Node, heal } = makeFlakyNode();
    const Wrapped = withNodeBoundary(Node, "delay");
    render(<Wrapped id="n2" />);

    heal();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(screen.getByText("rendered n2")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
