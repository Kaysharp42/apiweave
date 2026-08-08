import { describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResponseInspector } from "./ResponseInspector";
import type { ApiResponse } from "../../types";

const response: ApiResponse = {
  status: 200,
  headers: { "content-type": "application/json" },
  body: {
    id: "0cf9987a",
    breed: "Labrador",
    tags: ["good", "boy"],
  },
  responseTime: 15,
};

const renderTree = (
  overrides: Partial<Parameters<typeof ResponseInspector>[0]> = {},
) =>
  render(
    <ResponseInspector
      response={response}
      onAddExtractor={vi.fn()}
      onRemoveExtractor={vi.fn()}
      {...overrides}
    />,
  );

describe("ResponseInspector save-as-variable", () => {
  test("offers a save action on every tree row", () => {
    renderTree();
    expect(screen.getAllByTitle("Save as variable").length).toBeGreaterThan(0);
  });

  test("names the variable from the clicked path and stores the full path", async () => {
    const user = userEvent.setup();
    const onAddExtractor = vi.fn();
    renderTree({ onAddExtractor });

    // Row order follows the body: the root object, then its keys.
    await user.click(screen.getAllByTitle("Save as variable")[1]!);

    const nameInput = await screen.findByLabelText("Variable name");
    expect(nameInput).toHaveValue("id");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onAddExtractor).toHaveBeenCalledWith("id", "response.body.id");
  });

  test("can store the whole body from the root row", async () => {
    const user = userEvent.setup();
    const onAddExtractor = vi.fn();
    renderTree({ onAddExtractor });

    await user.click(screen.getAllByTitle("Save as variable")[0]!);
    expect(await screen.findByLabelText("Variable name")).toHaveValue("body");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onAddExtractor).toHaveBeenCalledWith("body", "response.body");
  });

  test("keeps array indices true to the data while a filter is applied", async () => {
    const user = userEvent.setup();
    const onAddExtractor = vi.fn();
    renderTree({ onAddExtractor, filterQuery: "boy" });

    await waitFor(() => {
      expect(screen.getAllByTitle("Save as variable").length).toBeGreaterThan(0);
    });

    // "boy" is tags[1]; a filter that renumbered the array would yield tags[0].
    const saveButtons = screen.getAllByTitle("Save as variable");
    await user.click(saveButtons[saveButtons.length - 1]!);
    await user.click(await screen.findByRole("button", { name: "Save" }));

    expect(onAddExtractor).toHaveBeenCalledWith(
      expect.any(String),
      "response.body.tags[1]",
    );
  });

  test("rejects a name the {{variables.x}} syntax cannot reference", async () => {
    const user = userEvent.setup();
    const onAddExtractor = vi.fn();
    renderTree({ onAddExtractor });

    await user.click(screen.getAllByTitle("Save as variable")[0]!);
    const nameInput = await screen.findByLabelText("Variable name");
    await user.clear(nameInput);
    await user.type(nameInput, "dog-id");

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(onAddExtractor).not.toHaveBeenCalled();
  });

  test("marks stored values in the tree and removes them from the chip", async () => {
    const user = userEvent.setup();
    const onRemoveExtractor = vi.fn();
    renderTree({
      extractors: { dogId: "response.body.id" },
      onRemoveExtractor,
    });

    const chip = await screen.findByTitle("Remove {{variables.dogId}}");
    expect(chip).toHaveTextContent("{{dogId}}");

    await user.click(chip);
    expect(onRemoveExtractor).toHaveBeenCalledWith("dogId");
  });

  test("stays read-only when no extractor handler is supplied", () => {
    render(<ResponseInspector response={response} />);
    expect(screen.queryByTitle("Save as variable")).toBeNull();
  });

  test("marks the root row when the whole body is stored, without hiding its children", async () => {
    const onRemoveExtractor = vi.fn();
    renderTree({
      extractors: { body: "response.body" },
      onRemoveExtractor,
    });

    expect(await screen.findByTitle("Remove {{variables.body}}")).toHaveTextContent(
      "{{body}}",
    );
    // The chip wraps the collection's own rendered children rather than
    // replacing them.
    expect(screen.getByText("breed")).toBeInTheDocument();
    expect(screen.getByText('"Labrador"')).toBeInTheDocument();
  });
});
