import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MainFooter } from "./MainFooter";
import useAboutStore from "../../stores/AboutStore";

const footerStatus = vi.hoisted(() => vi.fn());

vi.mock("../../hooks/useFooterStatus", () => ({
  useFooterStatus: footerStatus,
}));

beforeEach(() => {
  useAboutStore.setState({ isOpen: false });
});

describe("MainFooter", () => {
  it("says nothing rather than claiming the app is Ready", () => {
    footerStatus.mockReturnValue(null);
    render(<MainFooter />);

    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sidebar/i })).not.toBeInTheDocument();
  });

  it("announces a run in progress politely", () => {
    footerStatus.mockReturnValue({ phase: "running", label: "Running…" });
    render(<MainFooter />);

    const label = screen.getByText("Running…");
    expect(label.closest("[aria-live='polite']")).not.toBeNull();
    expect(label.parentElement).toHaveClass("text-status-info");
  });

  it("paints the last run's outcome with its status token", () => {
    footerStatus.mockReturnValue({ phase: "failed", label: "Last run failed" });
    render(<MainFooter />);

    expect(screen.getByText("Last run failed").parentElement).toHaveClass(
      "text-status-error",
    );
  });

  it("keeps the version and opens About from it", async () => {
    const user = userEvent.setup();
    footerStatus.mockReturnValue(null);
    render(<MainFooter />);

    expect(screen.getByText(/^v\d/)).toBeInTheDocument();
    // The project's GitHub link moved into About.
    expect(
      screen.queryByRole("link", { name: "View on GitHub" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "About APIWeave" }));

    expect(useAboutStore.getState().isOpen).toBe(true);
  });
});
