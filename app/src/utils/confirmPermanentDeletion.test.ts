import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmPermanentDeletion } from "./confirmPermanentDeletion";

const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({ toast: { success: toastSuccessMock } }));

describe("confirmPermanentDeletion", () => {
  beforeEach(() => {
    toastSuccessMock.mockClear();
  });

  it("returns the echoed id and announces a confirmed workflow deletion", async () => {
    const workflowId = await confirmPermanentDeletion(
      Promise.resolve({ deleted: true, workflowId: "wf-1" }),
      "Workflow",
    );

    expect(workflowId).toBe("wf-1");
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Workflow deleted permanently",
    );
  });

  it("returns the echoed id for a project deletion too", async () => {
    const projectId = await confirmPermanentDeletion(
      Promise.resolve({ deleted: true, projectId: "prj-1" }),
      "Project",
    );

    expect(projectId).toBe("prj-1");
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "Project deleted permanently",
    );
  });

  it("stays quiet when nothing was deleted", async () => {
    const entityId = await confirmPermanentDeletion(
      Promise.resolve({ deleted: false }),
      "Workflow",
    );

    expect(entityId).toBeNull();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it("stays quiet when the server omits the entity id", async () => {
    const entityId = await confirmPermanentDeletion(
      Promise.resolve({ deleted: true }),
      "Project",
    );

    expect(entityId).toBeNull();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});
