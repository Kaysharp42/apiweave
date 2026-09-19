import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { TutorialCompanionHost } from "./TutorialCompanionHost";
import useTutorialStore from "../stores/TutorialStore";
import useTutorialCompanionStore from "../stores/TutorialCompanionStore";
import { useElementWidth } from "../hooks/useElementWidth";

vi.mock("../hooks/useElementWidth", () => ({
  useElementWidth: vi.fn(),
}));

const mockedUseElementWidth = vi.mocked(useElementWidth);

/** Content width drives wide vs compact companion presentation. */
function setContentWidth(width: number | null) {
  mockedUseElementWidth.mockReturnValue([() => undefined, width]);
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

/** A stand-in for the workspace region the host makes inert when covered. */
function Harness({ path }: { readonly path: string }) {
  const contentRef = useRef<HTMLElement>(null);
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <div ref={contentRef as unknown as React.RefObject<HTMLDivElement>}>
                <button type="button">canvas action</button>
              </div>
              <TutorialCompanionHost contentRef={contentRef} />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  useTutorialStore.getState().resetProgress();
  useTutorialCompanionStore.getState().closeCompanion();
  localStorage.clear();
  setContentWidth(1200);
});

describe("TutorialCompanionHost", () => {
  it("renders nothing when no exercise is active", () => {
    render(<Harness path="/personal/personal/workflows" />);
    expect(
      screen.queryByRole("complementary", { name: "Follow along" }),
    ).not.toBeInTheDocument();
  });

  it("renders the floating panel on a wide content region", () => {
    useTutorialStore.getState().startPractice("first-workflow");
    useTutorialCompanionStore.getState().openCompanion("/personal/personal/workflows");
    render(<Harness path="/personal/personal/workflows" />);

    expect(
      screen.getByRole("complementary", { name: "Follow along" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 9")).toBeInTheDocument();
  });

  it("advances and bounds the step within the lesson", async () => {
    const user = userEvent.setup();
    useTutorialStore.getState().startPractice("first-workflow");
    useTutorialCompanionStore.getState().openCompanion("/personal/personal/workflows");
    render(<Harness path="/personal/personal/workflows" />);

    await user.click(screen.getByRole("button", { name: /Next/ }));
    expect(useTutorialStore.getState().practiceStep).toBe(1);
    expect(screen.getByText("Step 2 of 9")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Previous/ }));
    expect(useTutorialStore.getState().practiceStep).toBe(0);
    expect(screen.getByRole("button", { name: /Previous/ })).toBeDisabled();
  });

  it("keeps the last step reachable and marks complete explicitly", async () => {
    const user = userEvent.setup();
    const lesson = useTutorialStore;
    lesson.getState().startPractice("first-workflow");
    const stepCount =
      useTutorialStore.getState().practiceLessonId !== null ? 9 : 0;
    lesson.getState().setPracticeStep(stepCount - 1);
    useTutorialCompanionStore.getState().openCompanion("/personal/personal/workflows");
    render(<Harness path="/personal/personal/workflows" />);

    await user.click(
      screen.getByRole("button", { name: /Mark lesson complete/ }),
    );
    expect(useTutorialStore.getState().completedLessonIds).toContain(
      "first-workflow",
    );
    expect(
      screen.getByRole("button", { name: /Next lesson/ }),
    ).toBeInTheDocument();
  });

  it("suppresses the companion on the tutorial route but keeps practice", () => {
    useTutorialStore.getState().startPractice("first-workflow");
    useTutorialCompanionStore.getState().openCompanion("/personal/personal/workflows");
    render(<Harness path="/personal/personal/tutorials/canvas" />);

    expect(
      screen.queryByRole("complementary", { name: "Follow along" }),
    ).not.toBeInTheDocument();
    expect(useTutorialStore.getState().practiceLessonId).toBe("first-workflow");
  });

  it("starts compact as a strip and expands over the content", async () => {
    const user = userEvent.setup();
    setContentWidth(600);
    useTutorialStore.getState().startPractice("first-workflow");
    useTutorialCompanionStore.getState().openCompanion("/personal/personal/workflows");
    const { container } = render(
      <Harness path="/personal/personal/workflows" />,
    );

    // Compact starts collapsed as a strip.
    expect(
      screen.queryByRole("complementary", { name: "Follow along" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "canvas action" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Resume" }));

    // Expanded: the panel covers the content, which becomes inert — so the
    // workspace button is no longer reachable in the accessibility tree.
    expect(
      screen.getByRole("complementary", { name: "Follow along" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "canvas action" }),
    ).not.toBeInTheDocument();
    expect(container.querySelector("[inert]")).not.toBeNull();
  });

  it("collapses rather than covering when the region shrinks with workspace focus", async () => {
    useTutorialStore.getState().startPractice("first-workflow");
    useTutorialCompanionStore.getState().openCompanion("/personal/personal/workflows");
    const { rerender } = render(
      <Harness path="/personal/personal/workflows" />,
    );

    // Wide and expanded.
    expect(
      screen.getByRole("complementary", { name: "Follow along" }),
    ).toBeInTheDocument();

    // Shrink to compact with focus in the workspace, not the companion.
    setContentWidth(600);
    rerender(<Harness path="/personal/personal/workflows" />);

    await waitFor(() =>
      expect(
        useTutorialCompanionStore.getState().isCollapsed,
      ).toBe(true),
    );
  });

  it("returns to the workspace without ending practice", async () => {
    const user = userEvent.setup();
    useTutorialStore.getState().startPractice("first-workflow");
    useTutorialCompanionStore.getState().openCompanion("/personal/personal/workflows");
    render(<Harness path="/personal/personal/workflows" />);

    await user.click(
      screen.getByRole("button", { name: "Return to workspace" }),
    );
    expect(screen.getByTestId("location-probe").textContent).toBe(
      "/personal/personal/workflows",
    );
    expect(useTutorialStore.getState().practiceLessonId).toBe("first-workflow");
  });

  it("navigates to the full lesson in-app", async () => {
    const user = userEvent.setup();
    useTutorialStore.getState().startPractice("first-workflow");
    useTutorialCompanionStore.getState().openCompanion("/personal/personal/workflows");
    render(<Harness path="/personal/personal/workflows" />);

    await user.click(screen.getByRole("button", { name: "Full lesson" }));
    expect(screen.getByTestId("location-probe").textContent).toBe(
      "/personal/personal/tutorials/first-workflow",
    );
  });

  it("does not create or mutate workflows when opened or stepped", async () => {
    const user = userEvent.setup();
    useTutorialStore.getState().startPractice("first-workflow");
    useTutorialCompanionStore.getState().openCompanion("/personal/personal/workflows");
    render(<Harness path="/personal/personal/workflows" />);

    await user.click(screen.getByRole("button", { name: /Next/ }));
    await user.click(screen.getByRole("button", { name: /Previous/ }));

    // Only progress state changed; no domain call was made. The setup IPC mock
    // records invocations, so a tutorial action that touched workflows would
    // show up here.
    const ipc = (window as unknown as {
      __APIWEAVE_IPC__?: { invoke: { mock: { calls: unknown[] } } };
    }).__APIWEAVE_IPC__;
    const calls = ipc?.invoke.mock.calls ?? [];
    const domainCalls = calls.filter((call) => {
      const channel = (call as [string])[0];
      return channel.startsWith("workflows.") || channel.startsWith("runs.");
    });
    expect(domainCalls).toHaveLength(0);
  });
});
