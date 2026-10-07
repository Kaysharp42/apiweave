import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

vi.mock("../../hooks/useScopeContext", () => ({
  useScopeContext: () => ({
    workspaceId: "ws-1",
    workspaceSlug: "ws-one",
    orgId: null,
    orgSlug: null,
    userId: "user-1",
    isReady: true,
  }),
}));
vi.mock("../../contexts/PaletteContext", () => ({
  usePalette: () => ({ addImportedGroup: vi.fn() }),
}));
vi.mock("../../utils/apiweaveClient", () => ({
  apiweave: {
    workflows: { list: vi.fn().mockResolvedValue({ items: [] }) },
    runs: { history: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) },
  },
}));

const { CurlImport } = await import("../CurlImport");
const { HARImport } = await import("../HARImport");
const { OpenAPIImport } = await import("../OpenAPIImport");
const { ImportToNodesPanel } = await import("../ImportToNodesPanel");
const { default: HistoryModal } = await import("../HistoryModal");

const dialogs: Array<[string, (onClose: () => void) => ReactElement]> = [
  ["Import curl Commands", (onClose) => <CurlImport onClose={onClose} />],
  ["Import HAR File", (onClose) => <HARImport onClose={onClose} />],
  ["Import OpenAPI/Swagger", (onClose) => <OpenAPIImport onClose={onClose} />],
  [
    "Import to Add Nodes",
    (onClose) => <ImportToNodesPanel isOpen onClose={onClose} workflowId="wf-1" />,
  ],
  [
    "Run History",
    (onClose) => (
      <HistoryModal workflowId="wf-1" workspaceId="ws-1" onClose={onClose} onSelectRun={vi.fn()} />
    ),
  ],
];

describe.each(dialogs)("%s dialog", (title, renderDialog) => {
  it("is a labelled modal dialog that traps focus and closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(renderDialog(onClose));

    const dialog = await screen.findByRole("dialog", { name: title });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // Focus moves into the dialog and Tab cannot leave it.
    for (let i = 0; i < 12; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
