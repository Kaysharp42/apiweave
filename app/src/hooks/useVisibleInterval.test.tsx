import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { act } from "react";
import { useVisibleInterval } from "./useVisibleInterval";

/** jsdom's visibilityState is read-only; override it for the length of a test. */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function Probe({ tick }: { tick: () => void }) {
  useVisibleInterval(tick, 1000);
  return null;
}

describe("useVisibleInterval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });
  afterEach(() => vi.useRealTimers());

  it("ticks immediately and then on the period while visible", () => {
    const tick = vi.fn();
    render(<Probe tick={tick} />);
    expect(tick).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(2000));
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it("stops while hidden and catches up on return", () => {
    const tick = vi.fn();
    render(<Probe tick={tick} />);
    tick.mockClear();

    act(() => setVisibility("hidden"));
    act(() => vi.advanceTimersByTime(5000));
    expect(tick).not.toHaveBeenCalled();

    // Back: one immediate catch-up tick, then the period resumes from there.
    act(() => setVisibility("visible"));
    expect(tick).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it("does not restart the interval when the callback identity changes", () => {
    const tick = vi.fn();
    const { rerender } = render(<Probe tick={() => tick()} />);
    tick.mockClear();

    act(() => vi.advanceTimersByTime(600));
    rerender(<Probe tick={() => tick()} />);
    act(() => vi.advanceTimersByTime(400));

    // One tick at 1000ms. A restart would have re-fired immediately at 600ms.
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("clears the interval on unmount", () => {
    const tick = vi.fn();
    const { unmount } = render(<Probe tick={tick} />);
    unmount();
    tick.mockClear();

    act(() => vi.advanceTimersByTime(5000));
    expect(tick).not.toHaveBeenCalled();
  });
});
