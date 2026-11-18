import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NodeOutputPanel } from "./NodeOutputPanel";

describe("NodeOutputPanel", () => {
  it("shows the review a node type's result offers, above the output", () => {
    render(
      <NodeOutputPanel
        output={{ statusCode: 200 }}
        executionStatus="success"
        review={<p>Rule review</p>}
      />,
    );

    const panel = screen.getByText("Rule review");
    expect(panel).toBeInTheDocument();
    expect(screen.getByText("Output tree")).toBeInTheDocument();
  });

  it("shows no review when the node type offers none", () => {
    render(<NodeOutputPanel output={{ statusCode: 200 }} executionStatus="success" />);

    expect(screen.queryByText("Rule review")).toBeNull();
  });

  it("holds the review back while there is no output to review", () => {
    render(<NodeOutputPanel output={null} review={<p>Rule review</p>} />);

    expect(screen.queryByText("Rule review")).toBeNull();
    expect(screen.getByText("No output yet")).toBeInTheDocument();
  });
});
