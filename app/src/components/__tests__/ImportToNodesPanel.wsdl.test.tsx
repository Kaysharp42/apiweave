import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../hooks/useScopeContext", () => ({
  useScopeContext: () => ({
    workspaceId: "ws-1",
    workspaceSlug: "ws-one",
    orgId: null,
    orgSlug: null,
    isReady: true,
  }),
}));
vi.mock("../../contexts/PaletteContext", () => ({
  usePalette: () => ({ addImportedGroup: vi.fn() }),
}));
vi.mock("../../utils/apiweaveClient", () => ({
  apiweave: { workflows: {} },
}));

const { ImportToNodesPanel } = await import("../ImportToNodesPanel");

describe("ImportToNodesPanel WSDL tab", () => {
  it("imports a chosen file: the file fills the WSDL box and enables Add to Nodes", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ImportToNodesPanel isOpen onClose={() => {}} workflowId="wf-1" onTemplatesSaved={() => {}} />,
    );
    await user.click(screen.getByRole("tab", { name: "WSDL" }));
    const addButton = screen.getByRole("button", { name: "Add to Nodes" });
    expect(addButton).toBeDisabled();

    const wsdl = '<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"/>';
    const input = container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error("file input missing");
    await user.upload(input, new File([wsdl], "carrier.wsdl", { type: "text/xml" }));

    await waitFor(() => expect(screen.getByRole("textbox", { name: "WSDL" })).toHaveValue(wsdl));
    expect(addButton).toBeEnabled();
  });
});
