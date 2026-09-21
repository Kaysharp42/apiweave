import { beforeEach, describe, expect, it, vi } from "vitest";
import { HashRouter, Route, Routes, useLocation } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TutorialPage } from "./TutorialPage";
import useTutorialStore from "../stores/TutorialStore";
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

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="hash-location">{location.pathname}</div>;
}

/**
 * The desktop shell runs on `HashRouter`. A raw `<a href="/...">` in the
 * reader would leave the single-page app and attempt a full document load the
 * `app://` handler cannot serve. This renders the tutorial under a real
 * HashRouter and asserts that a destination link changes the in-app route
 * without the document navigating.
 */
function renderUnderHashRouter(entry: string) {
  window.location.hash = `#${entry}`;
  return render(
    <HashRouter>
      <Routes>
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
          path="/:orgSlug/:workspaceSlug/settings/environments"
          element={<div>environments page</div>}
        />
      </Routes>
    </HashRouter>,
  );
}

beforeEach(() => {
  useTutorialStore.getState().resetProgress();
  localStorage.clear();
  mockedUseElementWidth.mockReturnValue([() => undefined, 600]);
  window.location.hash = "";
});

describe("TutorialPage under HashRouter", () => {
  it("navigates to a destination in-app without a document reload", async () => {
    const user = userEvent.setup();
    renderUnderHashRouter("/personal/personal/tutorials/environments");

    const link = screen.getByRole("link", { name: /Manage environments/i });
    // A router Link renders an href the hash router owns; clicking must not
    // trigger a full navigation.
    await user.click(link);

    await waitFor(() =>
      expect(screen.getByText("environments page")).toBeInTheDocument(),
    );
    expect(window.location.hash).toBe(
      "#/personal/personal/settings/environments",
    );
  });

  it("uses a router link for the library, not a raw anchor", () => {
    renderUnderHashRouter("/personal/personal/tutorials/environments");
    const tutorialsLink = screen.getByRole("link", { name: "Tutorials" });
    expect(tutorialsLink).toHaveAttribute(
      "href",
      "#/personal/personal/tutorials",
    );
  });
});
