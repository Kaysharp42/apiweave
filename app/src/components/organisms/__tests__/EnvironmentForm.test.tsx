import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EnvironmentForm } from "../EnvironmentForm";
import type { ScopedEnvironment } from "../../../types/ScopedEnvironment";

/**
 * The base-environment picker's option set is computed by
 * `getValidBaseEnvironmentOptions`, which has its own unit tests. What those
 * can't catch is a wiring mistake between the util and the form — the wrong
 * argument order, a stale `form.baseEnvironmentId`, or a submit that drops the
 * field. These tests render the real form and assert the dropdown.
 */

// The form always mounts SecretsPanel (closed unless asked for). It reaches
// IPC, and nothing under test here goes near secrets.
vi.mock("../../SecretsPanel", () => ({ default: () => null }));

function env(overrides: Partial<ScopedEnvironment> = {}): ScopedEnvironment {
  return {
    environmentId: "env-dev",
    name: "Development",
    variables: {},
    scopeType: "workspace",
    scopeId: "ws-1",
    isDefault: false,
    allowedWorkspaceIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const dev = env();
const staging = env({ environmentId: "env-staging", name: "Staging" });
const prod = env({ environmentId: "env-prod", name: "Production" });

function renderForm(props: {
  environment?: ScopedEnvironment;
  availableEnvironments: ScopedEnvironment[];
}) {
  const onSubmit = vi.fn();
  render(
    <EnvironmentForm
      {...(props.environment ? { environment: props.environment } : {})}
      availableEnvironments={props.availableEnvironments}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />,
  );
  return { onSubmit };
}

function baseSelect(): HTMLSelectElement {
  const select = screen.getByLabelText("Base Environment");
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error("Base Environment picker is not a select");
  }
  return select;
}

function optionNames(): string[] {
  return Array.from(baseSelect().options).map((o) => o.textContent ?? "");
}

describe("EnvironmentForm — base environment picker", () => {
  it("offers the workspace's other environments and never itself", () => {
    renderForm({
      environment: staging,
      availableEnvironments: [dev, staging, prod],
    });

    expect(optionNames()).toEqual(["None", "Development", "Production"]);
  });

  it("excludes an environment whose base chain already reaches this one", () => {
    // Production extends Staging, so offering it to Staging would close a cycle.
    renderForm({
      environment: staging,
      availableEnvironments: [
        dev,
        staging,
        env({ ...prod, baseEnvironmentId: "env-staging" }),
      ],
    });

    expect(optionNames()).toEqual(["None", "Development"]);
  });

  it("offers every environment in create mode, where there is no self to exclude", () => {
    renderForm({ availableEnvironments: [dev, staging, prod] });

    expect(optionNames()).toEqual([
      "None",
      "Development",
      "Staging",
      "Production",
    ]);
    expect(baseSelect().value).toBe("");
  });

  it("preselects the saved base and submits the id the user picks", async () => {
    const { onSubmit } = renderForm({
      environment: env({ ...staging, baseEnvironmentId: "env-dev" }),
      availableEnvironments: [dev, staging, prod],
    });

    expect(baseSelect().value).toBe("env-dev");

    await userEvent.selectOptions(baseSelect(), "env-prod");
    await userEvent.click(screen.getByText("Save Changes"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ baseEnvironmentId: "env-prod" }),
    );
  });

  it("submits null when the base is cleared back to None", async () => {
    const { onSubmit } = renderForm({
      environment: env({ ...staging, baseEnvironmentId: "env-dev" }),
      availableEnvironments: [dev, staging, prod],
    });

    await userEvent.selectOptions(baseSelect(), "");
    await userEvent.click(screen.getByText("Save Changes"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ baseEnvironmentId: null }),
    );
  });

  it("previews inherited variables by source, marking the ones overridden locally", () => {
    renderForm({
      environment: env({
        ...staging,
        baseEnvironmentId: "env-dev",
        variables: { host: "staging.local" },
      }),
      availableEnvironments: [
        env({ ...dev, variables: { host: "dev.local", region: "eu" } }),
        staging,
        prod,
      ],
    });

    expect(screen.getByText("Inherited Variables")).toBeInTheDocument();
    expect(screen.getByText("from Development")).toBeInTheDocument();
    expect(screen.getByText("dev.local")).toBeInTheDocument();
    expect(screen.getByText("eu")).toBeInTheDocument();
    // `host` is set on this environment too, so the inherited row is marked.
    expect(screen.getByText("overridden below")).toBeInTheDocument();
  });

  it("shows no inherited section when there is no base", () => {
    renderForm({
      environment: staging,
      availableEnvironments: [dev, staging, prod],
    });

    expect(screen.queryByText("Inherited Variables")).not.toBeInTheDocument();
  });
});
