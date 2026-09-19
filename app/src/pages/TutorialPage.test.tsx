import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TutorialPage } from "./TutorialPage";
import useTutorialStore from "../stores/TutorialStore";
import { TUTORIAL_LESSONS } from "../constants/tutorials/curriculum";
import { useElementWidth } from "../hooks/useElementWidth";

vi.mock("../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    currentOrg: { slug: "personal" },
    currentWorkspace: { slug: "personal" },
  }),
}));

vi.mock("../hooks/useElementWidth", () => ({
  useElementWidth: vi.fn(),
}));

const mockedUseElementWidth = vi.mocked(useElementWidth);

/** The two-column layout is chosen from the measured container width. */
function setContainerWidth(width: number | null) {
  mockedUseElementWidth.mockReturnValue([() => undefined, width]);
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

function renderTutorialAt(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/:orgSlug/:workspaceSlug/tutorials"
          element={
            <>
              <TutorialPage />
              <LocationProbe />
            </>
          }
        />
        <Route
          path="/:orgSlug/:workspaceSlug/tutorials/:lessonId"
          element={
            <>
              <TutorialPage />
              <LocationProbe />
            </>
          }
        />
        <Route
          path="/:orgSlug/:workspaceSlug/workflows"
          element={<LocationProbe />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useTutorialStore.getState().resetProgress();
  localStorage.clear();
  setContainerWidth(1024);
});

describe("TutorialPage library", () => {
  it("lists every lesson grouped by chapter", () => {
    renderTutorialAt("/personal/personal/tutorials");
    expect(
      screen.getByRole("heading", { name: "Tutorials", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`0 of ${TUTORIAL_LESSONS.length} completed`),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Build and run your first workflow/i }),
    ).toBeInTheDocument();
  });

  it("filters by search and reports no results", async () => {
    const user = userEvent.setup();
    renderTutorialAt("/personal/personal/tutorials");

    await user.type(screen.getByLabelText("Search lessons"), "finish trigger");
    expect(
      screen.getByRole("button", { name: /Listen to an SSE stream/i }),
    ).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Search lessons"));
    await user.type(screen.getByLabelText("Search lessons"), "zzzznotathing");
    expect(screen.getByText("No lessons match")).toBeInTheDocument();
    await user.click(
      within(screen.getByText("No lessons match").parentElement as HTMLElement).getByRole(
        "button",
        { name: "Clear search" },
      ),
    );
    expect(
      screen.getByRole("button", { name: /Build and run your first workflow/i }),
    ).toBeInTheDocument();
  });

  it("shows a start-here card for a fresh reader", () => {
    renderTutorialAt("/personal/personal/tutorials");
    expect(screen.getByText("Start here")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start lesson" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Continue" }),
    ).not.toBeInTheDocument();
  });

  it("says Continue once a lesson has been opened", () => {
    useTutorialStore.getState().setLastLesson("canvas");
    renderTutorialAt("/personal/personal/tutorials");
    expect(screen.getByText("Continue where you left off")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Continue" }),
    ).toBeInTheDocument();
  });

  it("offers a revisit once everything is complete", () => {
    useTutorialStore.setState({
      completedLessonIds: TUTORIAL_LESSONS.map((l) => l.id),
      lastLessonId: "sse",
    });
    renderTutorialAt("/personal/personal/tutorials");
    expect(
      screen.getByText("You've finished every lesson"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Revisit lesson" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `${TUTORIAL_LESSONS.length} of ${TUTORIAL_LESSONS.length} completed`,
      ),
    ).toBeInTheDocument();
  });
});

describe("TutorialPage reader", () => {
  it("renders the lesson outcome, steps and example", () => {
    renderTutorialAt("/personal/personal/tutorials/first-workflow");
    expect(
      screen.getByRole("heading", {
        name: "Build and run your first workflow",
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Outcome")).toBeInTheDocument();
    expect(screen.getByText("Steps")).toBeInTheDocument();
    expect(screen.getByText("Expected result")).toBeInTheDocument();
    expect(
      screen.getByText("If something goes wrong"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/httpbin\.org\/get/).length).toBeGreaterThan(0);
  });
  it("marks a lesson complete and reverses it", async () => {
    const user = userEvent.setup();
    renderTutorialAt("/personal/personal/tutorials/first-workflow");

    await user.click(screen.getByRole("button", { name: "Mark complete" }));
    await waitFor(() =>
      expect(
        useTutorialStore.getState().completedLessonIds,
      ).toContain("first-workflow"),
    );
    expect(screen.getByText("Completed")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Mark not complete" }),
    );
    await waitFor(() =>
      expect(
        useTutorialStore.getState().completedLessonIds,
      ).not.toContain("first-workflow"),
    );
  });

  it("navigates to a related lesson by title", async () => {
    const user = userEvent.setup();
    renderTutorialAt("/personal/personal/tutorials/first-workflow");

    const related = screen.getByText("Related lessons").parentElement;
    expect(related).not.toBeNull();
    await user.click(
      within(related as HTMLElement).getByRole("button", {
        name: /The canvas, tabs and shortcuts/i,
      }),
    );

    expect(screen.getByTestId("location-probe").textContent).toBe(
      "/personal/personal/tutorials/canvas",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: "The canvas, tabs and shortcuts",
          level: 1,
        }),
      ).toBeInTheDocument(),
    );
  });

  it("offers a Back to workspace action", async () => {
    const user = userEvent.setup();
    renderTutorialAt("/personal/personal/tutorials/first-workflow");

    await user.click(screen.getByRole("button", { name: "Back to workspace" }));
    expect(screen.getByTestId("location-probe").textContent).toBe(
      "/personal/personal/workflows",
    );
  });

  it("moves focus to the lesson heading on open", () => {
    renderTutorialAt("/personal/personal/tutorials/first-workflow");
    expect(document.activeElement).toBe(
      screen.getByRole("heading", {
        name: "Build and run your first workflow",
        level: 1,
      }),
    );
  });

  it("shows a not-found state for an unknown lesson and recovers", async () => {
    const user = userEvent.setup();
    renderTutorialAt("/personal/personal/tutorials/not-a-lesson");

    expect(
      screen.getByRole("heading", { name: "Lesson not found" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All lessons" }));
    expect(screen.getByTestId("location-probe").textContent).toBe(
      "/personal/personal/tutorials",
    );
  });

  it("records the last lesson for resume", () => {
    renderTutorialAt("/personal/personal/tutorials/sse");
    expect(useTutorialStore.getState().lastLessonId).toBe("sse");
  });
});

describe("TutorialPage layout", () => {
  it("shows the library beside the article on a wide container", () => {
    setContainerWidth(1024);
    renderTutorialAt("/personal/personal/tutorials/first-workflow");
    expect(screen.getByRole("navigation", { name: "Lessons" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "All lessons" }),
    ).not.toBeInTheDocument();
  });

  it("shows the article alone with an All lessons action on a narrow container", () => {
    setContainerWidth(600);
    renderTutorialAt("/personal/personal/tutorials/first-workflow");
    expect(
      screen.queryByRole("navigation", { name: "Lessons" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "All lessons" }),
    ).toBeInTheDocument();
  });

  it("returns from the narrow article to the library", async () => {
    const user = userEvent.setup();
    setContainerWidth(600);
    renderTutorialAt("/personal/personal/tutorials/first-workflow");

    await user.click(screen.getByRole("button", { name: "All lessons" }));
    expect(screen.getByTestId("location-probe").textContent).toBe(
      "/personal/personal/tutorials",
    );
  });

  it("keeps the search query across a compact result round trip", async () => {
    const user = userEvent.setup();
    setContainerWidth(600);
    renderTutorialAt("/personal/personal/tutorials");

    await user.type(screen.getByLabelText("Search lessons"), "finish trigger");
    await user.click(
      screen.getByRole("button", { name: /Listen to an SSE stream/i }),
    );

    // The reader is now shown; going back must not clear the query.
    await user.click(screen.getByRole("button", { name: "All lessons" }));
    expect(screen.getByLabelText("Search lessons")).toHaveValue(
      "finish trigger",
    );
  });

  it("marks the last opened lesson in progress, not not-started", () => {
    useTutorialStore.getState().setLastLesson("canvas");
    renderTutorialAt("/personal/personal/tutorials");
    expect(screen.getAllByText(/In progress/).length).toBeGreaterThan(0);
  });
});

describe("TutorialPage reset", () => {
  it("resets progress only after confirmation", async () => {
    const user = userEvent.setup();
    useTutorialStore.getState().markComplete("canvas");
    renderTutorialAt("/personal/personal/tutorials/first-workflow");

    await user.click(screen.getByRole("button", { name: "Reset progress" }));
    expect(
      screen.getByRole("heading", { name: "Reset tutorial progress?" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useTutorialStore.getState().completedLessonIds).toContain("canvas");

    await user.click(screen.getByRole("button", { name: "Reset progress" }));
    await user.click(
      screen.getByRole("button", { name: "Reset" }),
    );
    await waitFor(() =>
      expect(useTutorialStore.getState().completedLessonIds).toEqual([]),
    );
  });
});
