import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LoadRunDialog } from "../LoadRunDialog";

function setup() {
  const onStart = vi.fn();
  const onClose = vi.fn();
  render(<LoadRunDialog isOpen onClose={onClose} onStart={onStart} />);
  return { onStart, onClose };
}

describe("LoadRunDialog", () => {
  it("starts with the typed settings, converting seconds to milliseconds and splitting thresholds", async () => {
    const { onStart, onClose } = setup();

    await userEvent.clear(screen.getByRole("spinbutton", { name: "Iterations" }));
    await userEvent.type(screen.getByRole("spinbutton", { name: "Iterations" }), "50");
    await userEvent.clear(screen.getByRole("spinbutton", { name: "Concurrency" }));
    await userEvent.type(screen.getByRole("spinbutton", { name: "Concurrency" }), "5");
    await userEvent.type(screen.getByRole("spinbutton", { name: "Duration (s)" }), "30");
    await userEvent.type(screen.getByRole("spinbutton", { name: "Ramp-up (s)" }), "2.5");
    await userEvent.type(screen.getByRole("textbox", { name: "Thresholds" }), "p95<500\n\n errors<1% ");
    await userEvent.click(screen.getByRole("button", { name: "Start load run" }));

    expect(onStart).toHaveBeenCalledWith({
      iterations: 50,
      concurrency: 5,
      durationMs: 30000,
      rampUpMs: 2500,
      thresholds: ["p95<500", "errors<1%"],
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("refuses a bad concurrency and starts nothing", async () => {
    const { onStart } = setup();

    await userEvent.clear(screen.getByRole("spinbutton", { name: "Concurrency" }));
    await userEvent.type(screen.getByRole("spinbutton", { name: "Concurrency" }), "0");
    await userEvent.click(screen.getByRole("button", { name: "Start load run" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Concurrency must be");
    expect(onStart).not.toHaveBeenCalled();
  });

  it("takes the iteration count and rows from a data file", async () => {
    const { onStart } = setup();
    const file = new File(["user\nann\nbob\n"], "users.csv", { type: "text/csv" });

    fireEvent.change(screen.getByLabelText("Data file for the load run"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole("spinbutton", { name: "Iterations" })).toHaveValue(2));
    await userEvent.click(screen.getByRole("button", { name: "Start load run" }));

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ iterations: 2, rows: [{ user: "ann" }, { user: "bob" }] }),
    );
  });
});
