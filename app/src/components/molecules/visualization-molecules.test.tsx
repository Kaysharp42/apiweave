import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SecretResolutionIndicator } from "./SecretResolutionIndicator";
import { VariableProvenanceModal } from "./VariableProvenanceModal";

describe("SecretResolutionIndicator", () => {
  it("renders nothing when no secret refs", () => {
    const { container } = render(
      <SecretResolutionIndicator secretRefs={[]} resolvedSecrets={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a resolved badge with scope and a missing badge, never a value", () => {
    render(
      <SecretResolutionIndicator
        secretRefs={["API_KEY", "TOKEN"]}
        resolvedSecrets={[
          { name: "API_KEY", scopeType: "environment", resolved: true },
          { name: "TOKEN", scopeType: null, resolved: false },
        ]}
      />,
    );
    expect(screen.getByText("API_KEY")).toBeInTheDocument();
    expect(screen.getByText("environment")).toBeInTheDocument();
    expect(screen.getByText("TOKEN")).toBeInTheDocument();
    expect(screen.getByText("missing")).toBeInTheDocument();
    // No plaintext ever rendered.
    expect(screen.queryByText("secret-value")).not.toBeInTheDocument();
  });
});

describe("VariableProvenanceModal", () => {
  it("lists producers and consumers", () => {
    render(
      <VariableProvenanceModal
        isOpen
        onClose={() => {}}
        variableName="token"
        provenance={{
          producers: [{ nodeId: "login", nodeLabel: "Login", path: "response.body.token" }],
          consumers: [
            { nodeId: "getUser", nodeLabel: "Get User", fields: ["headers", "url"] },
          ],
        }}
      />,
    );
    expect(screen.getByText("Produced by")).toBeInTheDocument();
    expect(screen.getByText("Consumed by")).toBeInTheDocument();
    expect(screen.getByText("Login")).toBeInTheDocument();
    expect(screen.getByText("response.body.token")).toBeInTheDocument();
    expect(screen.getByText("Get User")).toBeInTheDocument();
    expect(screen.getByText("headers")).toBeInTheDocument();
    expect(screen.getByText("url")).toBeInTheDocument();
  });

  it("shows a manual-variable empty state when nothing produces or consumes", () => {
    render(
      <VariableProvenanceModal
        isOpen
        onClose={() => {}}
        variableName="manual"
        provenance={null}
      />,
    );
    expect(screen.getByRole("heading", { name: "Manual variable" })).toBeInTheDocument();
  });
});