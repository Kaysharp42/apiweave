import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TutorialCompanion } from "./TutorialCompanion";
import { findTutorialLesson } from "../constants/tutorials/curriculum";
import { CanvasControlsClearance } from "../constants/CanvasChrome";
import type { TutorialCompanionProps } from "../types";

const LESSON =
  findTutorialLesson("first-workflow") ??
  (() => {
    throw new Error("first-workflow lesson must exist");
  })();

function renderCompanion(overrides: Partial<TutorialCompanionProps> = {}) {
  const handlers = {
    onCollapse: vi.fn(),
    onExpand: vi.fn(),
    onClose: vi.fn(),
    onPreviousStep: vi.fn(),
    onNextStep: vi.fn(),
    onOpenLesson: vi.fn(),
    onMarkComplete: vi.fn(),
    onNextLesson: vi.fn(),
    onReturnToWorkspace: vi.fn(),
  };
  const props: TutorialCompanionProps = {
    lesson: LESSON,
    stepIndex: 0,
    isCollapsed: false,
    isExpandedOverContent: false,
    isLessonComplete: false,
    returnPath: "/personal/personal/workflows",
    onCollapse: handlers.onCollapse,
    onExpand: handlers.onExpand,
    onClose: handlers.onClose,
    onPreviousStep: handlers.onPreviousStep,
    onNextStep: handlers.onNextStep,
    onOpenLesson: handlers.onOpenLesson,
    onMarkComplete: handlers.onMarkComplete,
    onNextLesson: handlers.onNextLesson,
    onReturnToWorkspace: handlers.onReturnToWorkspace,
    ...overrides,
  };
  render(
    <MemoryRouter>
      <TutorialCompanion {...props} />
    </MemoryRouter>,
  );
  return handlers;
}

describe("TutorialCompanion", () => {
  // The ReactFlow control column (zoom, fit view, auto-layout) owns the
  // bottom-left corner, and lessons tell the reader to press those buttons
  // while the companion is open. Both presentations have to clear it.
  it.each([
    ["panel", false],
    ["strip", true],
  ])("keeps the %s clear of the canvas controls", (_name, isCollapsed) => {
    renderCompanion({ isCollapsed });
    const floating = document.querySelector<HTMLElement>(".absolute.z-30");
    expect(floating).not.toBeNull();
    expect(floating?.style.left).toBe(`${CanvasControlsClearance}px`);
  });

  it("shows the lesson, step count and instruction", () => {
    renderCompanion();
    expect(
      screen.getByRole("complementary", { name: "Follow along" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 9")).toBeInTheDocument();
    expect(screen.getByText("Create a new workflow")).toBeInTheDocument();
  });

  it("labels the lesson-wide expectation as Lesson result", () => {
    renderCompanion();
    expect(screen.getByText("Lesson result")).toBeInTheDocument();
    expect(screen.queryByText(/expected result/i)).not.toBeInTheDocument();
  });

  it("disables Previous on the first step and advances with Next", async () => {
    const user = userEvent.setup();
    const handlers = renderCompanion();

    expect(screen.getByRole("button", { name: /Previous/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Next/ }));
    expect(handlers.onNextStep).toHaveBeenCalledTimes(1);
  });

  it("calls onPreviousStep from a later step", async () => {
    const user = userEvent.setup();
    const handlers = renderCompanion({ stepIndex: 2 });
    await user.click(screen.getByRole("button", { name: /Previous/ }));
    expect(handlers.onPreviousStep).toHaveBeenCalledTimes(1);
  });

  it("shows Mark lesson complete on the final step", () => {
    renderCompanion({ stepIndex: LESSON.steps.length - 1 });
    expect(
      screen.getByRole("button", { name: /Mark lesson complete/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Next$/ })).not.toBeInTheDocument();
  });

  it("offers Next lesson once the final step is complete", () => {
    renderCompanion({
      stepIndex: LESSON.steps.length - 1,
      isLessonComplete: true,
    });
    expect(
      screen.getByRole("button", { name: /Next lesson/ }),
    ).toBeInTheDocument();
  });

  it("exposes Full lesson, Return to workspace and Close", async () => {
    const user = userEvent.setup();
    const handlers = renderCompanion();

    await user.click(screen.getByRole("button", { name: "Full lesson" }));
    await user.click(
      screen.getByRole("button", { name: "Return to workspace" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Close follow-along" }),
    );

    expect(handlers.onOpenLesson).toHaveBeenCalledTimes(1);
    expect(handlers.onReturnToWorkspace).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the collapsed strip with a Resume action", async () => {
    const user = userEvent.setup();
    const handlers = renderCompanion({ isCollapsed: true });

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByText(/step 1 of 9/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(handlers.onExpand).toHaveBeenCalledTimes(1);
  });

  it("shows Back to workspace when expanded over content", () => {
    renderCompanion({ isExpandedOverContent: true, isCollapsed: false });
    expect(
      screen.getByRole("button", { name: "Back to workspace" }),
    ).toBeInTheDocument();
  });

  it("collapses on Escape from inside the companion", async () => {
    const user = userEvent.setup();
    const handlers = renderCompanion();

    await user.click(screen.getByRole("button", { name: "Full lesson" }));
    await user.keyboard("{Escape}");
    expect(handlers.onCollapse).toHaveBeenCalled();
  });
});
