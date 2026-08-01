import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ReactFlowProvider } from "reactflow";
import { BaseNode } from "./BaseNode";
import { NodeRunStrip } from "./NodeRunStrip";
import type { NodeStatus } from "../../../types/NodeStatus";

/**
 * The node shell's state matrix.
 *
 * These assertions are deliberately semantic — status is read from the
 * container's aria-label, the glow from a `data-node-glow` contract, progress
 * from `role="progressbar"`. Nothing here asserts on a Tailwind class, so a
 * restyle does not break the suite.
 */

function renderNode(ui: ReactElement) {
  return render(createElement(ReactFlowProvider, null, ui));
}

const ALL_STATES: NodeStatus[] = [
  "idle",
  "running",
  "success",
  "error",
  "warning",
  "skipped",
];

const EXPECTED_LABEL: Record<NodeStatus, string> = {
  idle: "Idle",
  running: "Running",
  success: "Success",
  error: "Error",
  warning: "Warning",
  skipped: "Skipped",
};

/** States that carry a glow. Idle and skipped are flat — that is the point. */
const LIT_STATES: NodeStatus[] = ["running", "success", "error", "warning"];

describe("BaseNode state matrix", () => {
  it.each(ALL_STATES)("exposes %s via the container aria-label", (status) => {
    renderNode(
      <BaseNode title="Login" status={status}>
        body
      </BaseNode>,
    );
    expect(
      screen.getByLabelText(`Node status: ${EXPECTED_LABEL[status]}`),
    ).toBeInTheDocument();
  });

  it.each(LIT_STATES)("renders a glow layer for %s", (status) => {
    const { container } = renderNode(
      <BaseNode title="Login" status={status}>
        body
      </BaseNode>,
    );
    expect(container.querySelector("[data-node-glow]")).not.toBeNull();
  });

  it("renders no glow layer at all when idle", () => {
    const { container } = renderNode(<BaseNode title="Login">body</BaseNode>);
    expect(container.querySelector("[data-node-glow]")).toBeNull();
  });

  it("renders no glow layer when skipped", () => {
    const { container } = renderNode(
      <BaseNode title="Login" status="skipped">
        body
      </BaseNode>,
    );
    expect(container.querySelector("[data-node-glow]")).toBeNull();
  });

  it("says skipped rather than showing a success affordance", () => {
    renderNode(<BaseNode title="Login" status="skipped" />);
    expect(screen.getByText("skipped")).toBeInTheDocument();
    expect(screen.queryByLabelText("Node status: Success")).toBeNull();
  });
});

describe("BaseNode rest line", () => {
  it("shows the rest line when the node has not run", () => {
    renderNode(
      <BaseNode
        title="Login"
        restLine={{ operation: "POST", argument: "api.shop.dev/auth/login" }}
      />,
    );
    expect(screen.getByText("POST")).toBeInTheDocument();
    expect(screen.getByText("api.shop.dev/auth/login")).toBeInTheDocument();
  });

  it("replaces the rest line with the run strip once running", () => {
    renderNode(
      <BaseNode
        title="Login"
        status="running"
        restLine={{ operation: "POST", argument: "api.shop.dev/auth/login" }}
        activityLine={{ operation: "POST", argument: "sending request" }}
      />,
    );
    expect(screen.getByText("sending request")).toBeInTheDocument();
    expect(screen.queryByText("api.shop.dev/auth/login")).toBeNull();
  });

  it("prefers the result summary over the activity line once finished", () => {
    renderNode(
      <BaseNode
        title="Login"
        status="success"
        activityLine={{ operation: "POST", argument: "sending request" }}
        resultSummary={{ operation: "200", argument: "OK" }}
      />,
    );
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.queryByText("sending request")).toBeNull();
  });
});

describe("BaseNode accessible shell", () => {
  it("renders the title as text", () => {
    renderNode(<BaseNode title="HTTP Request">body</BaseNode>);
    expect(screen.getByText("HTTP Request")).toBeInTheDocument();
  });

  it("does not render a collapse button without a title", () => {
    renderNode(<BaseNode>body</BaseNode>);
    expect(
      screen.queryByRole("button", { name: /expand|collapse/i }),
    ).toBeNull();
  });
});

describe("NodeRunStrip", () => {
  it("renders nothing when there is nothing to report", () => {
    const { container } = render(<NodeRunStrip status="idle" />);
    expect(container.firstChild).toBeNull();
  });

  it("holds the metrics row shape with an em dash for a missing value", () => {
    render(
      <NodeRunStrip
        status="success"
        metrics={[
          { label: "status", value: "200 OK" },
          { label: "duration", value: "831ms" },
          { label: "size", value: null },
        ]}
      />,
    );
    const row = screen.getByRole("group", { name: "Node metrics" });
    expect(row).toBeInTheDocument();
    expect(screen.getByLabelText("size: —")).toBeInTheDocument();
    expect(screen.getByLabelText("status: 200 OK")).toBeInTheDocument();
  });

  it("exposes a determinate rail as a progressbar with a value", () => {
    render(<NodeRunStrip status="running" progress={0.5} />);
    const rail = screen.getByRole("progressbar", { name: "Node progress" });
    expect(rail).toHaveAttribute("aria-valuenow", "50");
  });

  it("omits the value on an indeterminate rail", () => {
    render(<NodeRunStrip status="running" progress="indeterminate" />);
    const rail = screen.getByRole("progressbar", { name: "Node progress" });
    expect(rail).not.toHaveAttribute("aria-valuenow");
  });

  it("renders no rail once the node has finished", () => {
    render(
      <NodeRunStrip
        status="success"
        progress={1}
        resultSummary={{ operation: "200", argument: "OK" }}
      />,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

describe("node layer motion is reduced-motion safe", () => {
  /**
   * A source-level guard rather than a runtime one: jsdom cannot evaluate
   * `prefers-reduced-motion`, and the failure this protects against — shipping a
   * looping animation with no reduced-motion escape — is invisible until someone
   * with the setting enabled opens the canvas.
   */
  const FLOW_DIR = join("src", "components", "atoms", "flow");

  it.each(["BaseNode.tsx", "NodeRunStrip.tsx"])(
    "pairs every animation in %s with a reduced-motion escape",
    (fileName) => {
      const source = readFileSync(join(FLOW_DIR, fileName), "utf-8");
      const animations = source.match(/\banimate-(?!none\b)[a-z-]+/g) ?? [];

      expect(animations.length).toBeGreaterThan(0);

      for (const animation of animations) {
        const index = source.indexOf(animation);
        // The escape must sit in the same class string, which in this codebase
        // means within a short distance of the animation class itself.
        const window = source.slice(index, index + animation.length + 80);
        expect(
          window.includes("motion-reduce:animate-none"),
          `${animation} in ${fileName} has no motion-reduce:animate-none`,
        ).toBe(true);
      }
    },
  );

  it("keeps a prefers-reduced-motion block next to the node keyframes", () => {
    const css = readFileSync(join("src", "styles", "node-motion.css"), "utf-8");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    // The rail and the travelling dot need more than `animation: none` — a
    // clamped animation lands on its final keyframe and reports state that
    // isn't there.
    expect(css).toContain("aw-node-rail__fill--indeterminate");
    expect(css).toContain("aw-edge-flow-dot");
  });
});
