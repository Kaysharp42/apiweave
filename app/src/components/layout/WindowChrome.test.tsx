import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TitleBar } from "./TitleBar";
import useWindowChromeStore, {
  useOwnWindowChrome,
} from "../../stores/WindowChromeStore";

type DesktopWindow = {
  __APIWEAVE_IPC__?: unknown;
  __APIWEAVE_DESKTOP__?: unknown;
};

// The suite's setup.ts stubs __APIWEAVE_IPC__ globally, so tests run as the
// desktop shell by default; the web cases opt out and afterEach restores it.
const stubbedIpc = (window as unknown as DesktopWindow).__APIWEAVE_IPC__;

function enterDesktopShell() {
  const w = window as unknown as DesktopWindow;
  w.__APIWEAVE_IPC__ = stubbedIpc ?? {};
  w.__APIWEAVE_DESKTOP__ = {
    minimize: () => undefined,
    toggleMaximize: () => undefined,
    close: () => undefined,
    onMaximizeChange: () => () => undefined,
  };
}

function leaveDesktopShell() {
  delete (window as unknown as DesktopWindow).__APIWEAVE_IPC__;
}

afterEach(() => {
  const w = window as unknown as DesktopWindow;
  w.__APIWEAVE_IPC__ = stubbedIpc;
  delete w.__APIWEAVE_DESKTOP__;
  useWindowChromeStore.setState({ headerOwnsChrome: false });
  document.documentElement.classList.remove("chrome-merged");
});

describe("TitleBar", () => {
  it("renders nothing outside the desktop shell", () => {
    leaveDesktopShell();

    const { container } = render(<TitleBar />);

    expect(container).toBeEmptyDOMElement();
  });

  it("draws the brand and the window buttons in the desktop shell", () => {
    enterDesktopShell();

    const { container } = render(<TitleBar />);

    expect(screen.getByText("APIWeave")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Minimize" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Maximize" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    // Same height token as MainHeader, so boot/setup/404 wear matching chrome.
    expect(container.firstElementChild).toHaveClass("h-header");
  });

  it("stands down once a routed header owns the chrome", () => {
    enterDesktopShell();
    useWindowChromeStore.setState({ headerOwnsChrome: true });

    const { container } = render(<TitleBar />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("useOwnWindowChrome", () => {
  function Probe() {
    useOwnWindowChrome();
    return null;
  }

  it("claims the chrome and reclaims the title bar's reserved height", () => {
    enterDesktopShell();

    const { unmount } = render(<Probe />);

    expect(useWindowChromeStore.getState().headerOwnsChrome).toBe(true);
    expect(document.documentElement).toHaveClass("chrome-merged");

    // Leaving a header-bearing route must hand the chrome back, or routes
    // without a header (setup, 404) would lose their window buttons.
    unmount();

    expect(useWindowChromeStore.getState().headerOwnsChrome).toBe(false);
    expect(document.documentElement).not.toHaveClass("chrome-merged");
  });

  it("is a no-op on the web build, which has no custom chrome", () => {
    leaveDesktopShell();

    render(<Probe />);

    expect(useWindowChromeStore.getState().headerOwnsChrome).toBe(false);
    expect(document.documentElement).not.toHaveClass("chrome-merged");
  });
});
